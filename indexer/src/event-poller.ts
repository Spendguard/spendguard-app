/**
 * Continuous event polling loop.
 *
 * Polls the Soroban RPC for the on-chain events that make up x402
 * settlements, persists a ledger cursor so it can resume after restarts,
 * and decodes raw events into typed X402SettlementEvent records.
 *
 * There is NO on-chain "x402 facilitator contract" — the facilitator is an
 * off-chain service (OpenZeppelin Relayer + x402 Facilitator Plugin, see
 * https://developers.stellar.org/docs/build/agentic-payments/x402). The
 * real on-chain event sources monitored here are:
 *
 *  1. SEP-41 token `transfer` events on the monitored asset contract
 *     (testnet USDC: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA).
 *     Event schema (SEP-41, https://github.com/stellar/stellar-protocol
 *     /blob/master/ecosystem/sep-0041.md):
 *       topics: ["transfer", from: Address, to: Address, asset: string]
 *               (verified against captured testnet records — see
 *               test/fixtures/testnet-usdc-transfers.json; the 4th topic is
 *               the asset string, e.g. "USDC:GBBD47IF…")
 *       data:   amount: i128  (single-value format) or map
 *               { amount: i128, to_muxed_id: ... }
 *
 *  2. OpenZeppelin smart-account `spending_limit_enforced` events
 *     (OpenZeppelin/stellar-contracts, packages/accounts/src/policies/
 *     spending_limit.rs). Event schema:
 *       topics: ["spending_limit_enforced", smart_account: Address]
 *       data:   map { context, context_rule_id: u32, amount: i128,
 *                     total_spent_in_period: i128 }
 *     The event-name topic is the snake_case struct name, and data is a
 *     map — both confirmed from the soroban-sdk `#[contractevent]` macro.
 *
 * RPC providers have an event retention window of ~7 days. This service
 * MUST run continuously to avoid data loss from downtime exceeding the
 * retention window.
 */

import {
  SorobanClient,
  type ContractEventFilter,
  type RawContractEvent,
  type X402SettlementEvent,
} from "@spendguard/sdk";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import type { Database } from "./db.js";

// ── Logger ────────────────────────────────────────────────────────────

function log(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${ts}] [${level}] [EventPoller] ${msg}${metaStr}`);
}

/**
 * Serialize an unknown caught value into a readable log string.
 *
 * RPC errors from @stellar/stellar-sdk are plain objects (e.g.
 * `{ code: -32602, message: "startLedger must be positive" }`), so
 * `String(err)` yields the useless "[object Object]" — this extracts the
 * real message and, failing that, JSON-serializes the object.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    try {
      const json = JSON.stringify(err);
      if (json) return json;
    } catch {
      // fall through to String(err)
    }
  }
  return String(err);
}

// ── Topic filter constants ────────────────────────────────────────────
//
// getEvents topic filters are NOT prefix-matched: every topic position in
// the filter is compared against the event, so a short filter like
// ["transfer"] never matches a 4-topic SEP-41 transfer event
// ([transfer, from, to, asset]). Rather than hard-code topic shapes (and
// break whenever a contract changes its event schema), we filter by
// contract ID only and let decodeSettlementEvent below classify each
// event by its first topic. decodeSettlementEvent already ignores
// non-settlement events (approve, mint, burn, …).

// ── Event decoders ────────────────────────────────────────────────────

/** Decode the amount from a SEP-41 transfer event value (i128 or map). */
export function decodeTransferAmount(value: string): bigint | null {
  if (!value) return null;
  try {
    const scv = xdr.ScVal.fromXDR(value, "base64");
    if (scv.switch() === xdr.ScValType.scvI128()) {
      return BigInt(scValToNative(scv) as bigint);
    }
    if (scv.switch() === xdr.ScValType.scvMap()) {
      const map = scv.map();
      if (map) {
        const amountEntry = map.find(
          (e: xdr.ScMapEntry) => String(scValToNative(e.key())) === "amount",
        );
        if (amountEntry) {
          return BigInt(scValToNative(amountEntry.val()) as bigint);
        }
      }
    }
  } catch {
    // Decode failure is logged by the caller; treat as unparseable.
  }
  return null;
}

/** Decode an OpenZeppelin `spending_limit_enforced` event value (map). */
export function decodeSpendingLimitEnforced(
  value: string,
): { contextRuleId: number; amount: bigint } | null {
  if (!value) return null;
  try {
    const scv = xdr.ScVal.fromXDR(value, "base64");
    if (scv.switch() !== xdr.ScValType.scvMap()) {
      return null;
    }
    const map = scv.map();
    if (!map) return null;

    const ruleEntry = map.find(
      (e: xdr.ScMapEntry) => String(scValToNative(e.key())) === "context_rule_id",
    );
    const amountEntry = map.find(
      (e: xdr.ScMapEntry) => String(scValToNative(e.key())) === "amount",
    );
    if (!ruleEntry || !amountEntry) {
      return null;
    }

    const contextRuleId = Number(scValToNative(ruleEntry.val()));
    if (Number.isNaN(contextRuleId)) {
      return null;
    }
    const amount = BigInt(scValToNative(amountEntry.val()) as bigint);
    return { contextRuleId, amount };
  } catch {
    log("WARN", "Failed to decode spending_limit_enforced event value");
    return null;
  }
}

/**
 * Decode a raw Soroban contract event into a typed X402SettlementEvent.
 *
 * Handles the two real event sources:
 *  - SEP-41 `transfer` events: account = `from`; the context rule ID is
 *    resolved from the monitored-accounts table (transfer events carry no
 *    rule ID themselves). Events whose `from` is not a monitored account
 *    are skipped.
 *  - OZ `spending_limit_enforced` events: account = smart account;
 *    contextRuleId and amount come from the event data.
 *
 * @param raw           Raw event from getEvents.
 * @param ruleByAccount Map of monitored account address -> contextRuleId.
 */
export function decodeSettlementEvent(
  raw: RawContractEvent,
  ruleByAccount: Map<string, number>,
): X402SettlementEvent | null {
  const eventType = raw.topic[0];

  // SEP-41 transfer event: topics ["transfer", from, to, asset]
  if (eventType === "transfer") {
    if (raw.topic.length < 3) {
      log("WARN", "Unexpected transfer event topic length", {
        id: raw.id,
        topicCount: raw.topic.length,
      });
      return null;
    }

    const account = raw.topic[1];
    const to = raw.topic[2];
    if (!account) {
      log("WARN", "Transfer event missing `from` topic", { id: raw.id });
      return null;
    }

    // Transfer events carry no context rule ID, so they can only be
    // attributed when `from` is one of the monitored accounts. In the OZ
    // smart-account flow the `from` is the smart-account contract (C…);
    // register those addresses in monitored_accounts for attribution, or
    // rely on spending_limit_enforced events instead.
    const contextRuleId = ruleByAccount.get(account);
    if (contextRuleId === undefined) {
      log("INFO", "Skipping transfer event from unmonitored account", {
        id: raw.id,
        account,
      });
      return null;
    }

    const amountSpent = decodeTransferAmount(raw.value);
    if (amountSpent === null) {
      log("WARN", "Could not decode transfer amount; skipping", { id: raw.id });
      return null;
    }

    return {
      id: raw.id,
      ledger: raw.ledger,
      timestamp: raw.timestamp,
      account,
      sourceContractId: raw.contractId,
      amountSpent,
      contextRuleId,
      reference: to ?? null,
    };
  }

  // OZ spending-limit policy event: topics ["spending_limit_enforced", smart_account]
  if (eventType === "spending_limit_enforced") {
    if (raw.topic.length < 2) {
      log("WARN", "Unexpected spending_limit_enforced event topic length", {
        id: raw.id,
        topicCount: raw.topic.length,
      });
      return null;
    }

    const account = raw.topic[1];
    if (!account) {
      log("WARN", "spending_limit_enforced event missing smart_account topic", {
        id: raw.id,
      });
      return null;
    }
    const data = decodeSpendingLimitEnforced(raw.value);
    if (!data) {
      log("WARN", "Could not decode spending_limit_enforced data", { id: raw.id });
      return null;
    }

    return {
      id: raw.id,
      ledger: raw.ledger,
      timestamp: raw.timestamp,
      account,
      sourceContractId: raw.contractId,
      amountSpent: data.amount,
      contextRuleId: data.contextRuleId,
      reference: null,
    };
  }

  // Ignore any other events (e.g. token approve/mint/burn).
  return null;
}

// ── Poller ────────────────────────────────────────────────────────────

export class EventPoller {
  private readonly client: SorobanClient;
  private readonly db: Database;
  private readonly assetContractId: string;
  private readonly smartAccountContractIds: string[];
  private readonly pollIntervalMs: number;
  private active = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    client: SorobanClient,
    db: Database,
    assetContractId: string,
    smartAccountContractIds: string[],
    pollIntervalMs: number,
  ) {
    this.client = client;
    this.db = db;
    this.assetContractId = assetContractId;
    this.smartAccountContractIds = smartAccountContractIds;
    this.pollIntervalMs = pollIntervalMs;
  }

  get isActive(): boolean {
    return this.active;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.active) {
      log("WARN", "Poller already running");
      return;
    }
    this.active = true;
    log("INFO", "Starting event poller");

    // Schedule the first poll immediately, then recur at the configured
    // interval from the start of each poll cycle.
    await this.pollCycle();
  }

  stop(): void {
    this.active = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    log("INFO", "Event poller stopped");
  }

  // ── Poll cycle ──────────────────────────────────────────────────────

  private async pollCycle(): Promise<void> {
    if (!this.active) return;

    const cycleStart = Date.now();

    try {
      // Resume from the persisted cursor, or derive a starting ledger.
      // A seeded-but-never-updated cursor (last_ledger = 0) is treated as
      // absent: the RPC rejects startLedger=0 with "startLedger must be
      // positive", so we fall back to (latestLedger - 100), clamped to >= 1.
      const cursor = await this.db.getCursor();
      const startLedger: number =
        cursor && cursor.lastLedger > 0
          ? cursor.lastLedger
          : Math.max(1, (await this.client.getLatestLedger()) - 100);

      log("INFO", "Polling events", {
        startLedger,
        cursorEventId: cursor?.lastEventId ?? null,
        assetContract: this.assetContractId,
        smartAccountContracts: this.smartAccountContractIds,
      });

      // Monitored accounts: transfer events carry no context rule ID, so
      // we attribute them using the account's configured rule.
      const monitored = await this.db.getMonitoredAccounts();
      const ruleByAccount = new Map<string, number>(
        monitored.map((m) => [m.address, m.contextRuleId]),
      );

      const filters: ContractEventFilter[] = [
        {
          type: "contract",
          contractIds: [this.assetContractId],
        },
      ];
      if (this.smartAccountContractIds.length > 0) {
        filters.push({
          type: "contract",
          contractIds: this.smartAccountContractIds,
        });
      }

      const { events, latestLedger } = await this.client.getEvents({
        startLedger,
        filters,
        maxEvents: 100,
      });

      let decodedCount = 0;

      for (const raw of events) {
        try {
          const settlement = decodeSettlementEvent(raw, ruleByAccount);
          if (settlement) {
            await this.db.insertSettlementEvent({
              id: settlement.id,
              ledger: settlement.ledger,
              account: settlement.account,
              sourceContractId: settlement.sourceContractId,
              amountSpent: settlement.amountSpent,
              contextRuleId: settlement.contextRuleId,
              reference: settlement.reference,
            });
            decodedCount++;
          }
        } catch (err) {
          log("ERROR", "Failed to persist settlement event", {
            eventId: raw.id,
            error: String(err),
          });
        }
      }

      // Persist the cursor so we resume from the right place
      const lastEventId =
        events.length > 0 ? (events[events.length - 1]?.id ?? null) : null;
      await this.db.upsertCursor(latestLedger, lastEventId);

      log("INFO", "Poll cycle complete", {
        eventsFetched: events.length,
        decoded: decodedCount,
        newCursorLedger: latestLedger,
      });
    } catch (err) {
      log("ERROR", "Poll cycle failed", { error: errorMessage(err) });
      // Continue the loop despite errors — don't crash the indexer
    }

    // Schedule the next cycle
    const elapsed = Date.now() - cycleStart;
    const delay = Math.max(100, this.pollIntervalMs - elapsed);
    this.pollTimeout = setTimeout(() => {
      this.pollCycle().catch((err) => {
        log("ERROR", "Unhandled error in poll cycle", { error: errorMessage(err) });
      });
    }, delay);
  }
}
