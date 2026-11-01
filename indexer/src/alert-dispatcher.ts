/**
 * Alert dispatcher.
 *
 * For each alert that is raised, the dispatcher POSTs the alert payload
 * to each enabled webhook endpoint. Delivery is best-effort: failures are
 * logged but do not block the indexer loop.
 *
 * The webhook payload is a JSON object conforming to SpendAlert.
 *
 * Destinations are operator-supplied and the request carries a bearer secret,
 * so every target is checked before a socket is opened: scheme, port,
 * special-use hostname, and — after DNS — whether the address it resolves to
 * is routable in public. Redirects are followed manually and re-checked hop by
 * hop, because a public host that answers `302 → http://169.254.169.254` is the
 * same request as the one the policy already refused.
 */

import { promises as dns } from "node:dns";
import { checkWebhookUrlShape, findBlockedAddress, isIpAddressLike } from "@spendguard/sdk";
import type { SpendAlert } from "@spendguard/sdk";
import type { Database } from "./db.js";

// ── Logger ────────────────────────────────────────────────────────────

function log(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${ts}] [${level}] [AlertDispatcher] ${msg}${metaStr}`);
}

// ── Webhook payload ───────────────────────────────────────────────────

interface WebhookPayload {
  event: "spendguard.alert";
  id: string;
  account: string;
  contextRuleId: number;
  level: string;
  eventAmount: string; // bigint serialised as string
  totalSpentInWindow: string;
  cap: string;
  triggerLedger: number;
  raisedAt: string;
}

function buildPayload(alert: SpendAlert): WebhookPayload {
  return {
    event: "spendguard.alert",
    id: alert.id,
    account: alert.account,
    contextRuleId: alert.contextRuleId,
    level: alert.level,
    eventAmount: alert.eventAmount.toString(),
    totalSpentInWindow: alert.totalSpentInWindow.toString(),
    cap: alert.cap.toString(),
    triggerLedger: alert.triggerLedger,
    raisedAt: alert.raisedAt,
  };
}

// ── Destination guard ─────────────────────────────────────────────────

/** Hostname → every address it resolves to. */
export type AddressResolver = (host: string) => Promise<string[]>;

const systemResolver: AddressResolver = async (host) => {
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export interface DispatcherOptions {
  /** Injected in tests; defaults to the system resolver. */
  resolveAddresses?: AddressResolver;
  /** Local development only: permit loopback and RFC 1918 targets. */
  allowPrivateNetworks?: boolean;
  /** Redirects followed before giving up on a target. */
  maxRedirects?: number;
}

type DeliveryResult =
  | { status: "delivered"; responseCode: number }
  | { status: "refused"; reason: string }
  | { status: "failed"; reason: string };

// ── Dispatcher ────────────────────────────────────────────────────────

export class AlertDispatcher {
  private readonly db: Database;
  private readonly timeoutMs: number;
  private readonly resolveAddresses: AddressResolver;
  private readonly allowPrivateNetworks: boolean;
  private readonly maxRedirects: number;

  constructor(db: Database, timeoutMs: number, options: DispatcherOptions = {}) {
    this.db = db;
    this.timeoutMs = timeoutMs;
    this.resolveAddresses = options.resolveAddresses ?? systemResolver;
    this.allowPrivateNetworks = options.allowPrivateNetworks ?? false;
    this.maxRedirects = options.maxRedirects ?? 3;
  }

  /**
   * Resolve a target and refuse it if any of its addresses is not publicly
   * routable. A hostname that resolves to *both* a public and an internal
   * address is refused too: the socket could land on either.
   */
  private async guardTarget(url: URL): Promise<string | null> {
    const shape = checkWebhookUrlShape(url.toString(), {
      allowPrivateNetworks: this.allowPrivateNetworks,
    });
    if (!shape.ok) return shape.reason;

    if (this.allowPrivateNetworks) return null;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    try {
      addresses = isIpAddressLike(host) ? [host] : await this.resolveAddresses(host);
    } catch (err) {
      return `${host} could not be resolved: ${String(err)}`;
    }

    const blocked = findBlockedAddress(addresses, {
      allowPrivateNetworks: this.allowPrivateNetworks,
    });
    return blocked ? `${host} resolves to ${blocked}, which is not a public address` : null;
  }

  /**
   * POST the payload to one endpoint, following redirects manually so each hop
   * passes the same guard as the configured URL.
   */
  private async deliver(
    startUrl: URL,
    payload: WebhookPayload,
    secret: string | null,
    alertId: string
  ): Promise<DeliveryResult> {
    let target = startUrl;

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const refusal = await this.guardTarget(target);
      if (refusal) {
        log("WARN", "Refused webhook target", { alertId, url: target.toString(), refusal });
        return { status: "refused", reason: refusal };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "SpendGuard/0.1",
      };
      if (secret) headers["Authorization"] = `Bearer ${secret}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(target, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          // Manual, never "follow": the runtime would chase a redirect past any
          // check we could make.
          redirect: "manual",
        });
      } catch (err) {
        log("ERROR", "Failed to POST alert to webhook", {
          alertId,
          webhookUrl: target.toString(),
          error: String(err),
        });
        return { status: "failed", reason: String(err) };
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { status: "failed", reason: `${response.status} redirect without a Location header` };
        }
        try {
          target = new URL(location, target);
        } catch {
          return { status: "failed", reason: `unresolvable redirect target: ${location}` };
        }
        log("INFO", "Following webhook redirect", { alertId, status: response.status });
        continue;
      }

      if (response.ok) {
        log("INFO", "Alert dispatched to webhook", {
          alertId,
          webhookUrl: target.toString(),
          status: response.status,
        });
        return { status: "delivered", responseCode: response.status };
      }

      log("WARN", "Webhook returned non-2xx", {
        alertId,
        webhookUrl: target.toString(),
        status: response.status,
      });
      return { status: "failed", reason: `HTTP ${response.status}` };
    }

    return { status: "failed", reason: `more than ${this.maxRedirects} redirects` };
  }

  /**
   * Dispatch an alert to all enabled webhook endpoints.
   *
   * The `alert.webhookDelivered` field is updated to `true` only if ALL
   * configured webhooks return HTTP 2xx. At-least-once delivery is
   * achieved by retrying on the next poll cycle (the alert is re-fetched
   * from the DB).
   *
   * @returns `true` if the alert was delivered to all webhooks.
   */
  async dispatchAlert(alert: SpendAlert): Promise<boolean> {
    const webhooks = await this.db.getWebhookConfigs();

    if (webhooks.length === 0) {
      log("INFO", "No webhook configs found; alert logged but not dispatched", {
        alertId: alert.id,
      });
      return false;
    }

    const matchingWebhooks = webhooks.filter((wh) =>
      wh.alertLevels.includes(alert.level),
    );

    if (matchingWebhooks.length === 0) {
      log("INFO", "No webhooks match alert level", {
        alertId: alert.id,
        level: alert.level,
      });
      return false;
    }

    const payload = buildPayload(alert);
    let allDelivered = true;

    for (const webhook of matchingWebhooks) {
      let target: URL;
      try {
        target = new URL(webhook.url);
      } catch {
        log("ERROR", "Webhook config URL is not a valid URL", {
          alertId: alert.id,
        });
        allDelivered = false;
        continue;
      }

      const result = await this.deliver(target, payload, webhook.secret ?? null, alert.id);
      if (result.status !== "delivered") allDelivered = false;
    }

    // Update delivery status if any webhook was called
    if (matchingWebhooks.length > 0 && allDelivered) {
      await this.db.sql`
        UPDATE alerts SET webhook_delivered = true WHERE id = ${alert.id}
      `;
    }

    return allDelivered;
  }
}
