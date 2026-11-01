// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlertDispatcher } from "../src/alert-dispatcher.js";
import type { SpendAlert } from "@spendguard/sdk";
import type { Database } from "../src/db.js";

const PUBLIC = "8.8.8.8";

function alert(partial: Partial<SpendAlert> = {}): SpendAlert {
  return {
    id: "alert-1",
    account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contextRuleId: 2,
    level: "breach",
    eventAmount: 1_000_000n,
    totalSpentInWindow: 12_000_000n,
    cap: 10_000_000n,
    triggerLedger: 100,
    raisedAt: "2026-11-01T00:00:00.000Z",
    webhookDelivered: false,
    ...partial,
  };
}

interface WebhookRow {
  url: string;
  secret: string | null;
  alertLevels: string[];
  enabled: boolean;
}

function webhook(partial: Partial<WebhookRow> = {}): WebhookRow {
  return {
    url: "https://hooks.example.com/spendguard",
    secret: "s3cret",
    alertLevels: ["near_miss", "breach"],
    enabled: true,
    ...partial,
  };
}

/**
 * @param addresses hostname → addresses it answers with
 */
function setup(
  webhooks: WebhookRow[],
  addresses: Record<string, string[]> = {},
  dispatcherOptions: { allowPrivateNetworks?: boolean; maxRedirects?: number } = {},
) {
  const resolveAddresses = vi.fn(async (host: string) => {
    const found = addresses[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  });

  const sql = vi.fn().mockResolvedValue([]);
  const db = {
    getWebhookConfigs: vi.fn().mockResolvedValue(webhooks),
    sql,
  } as unknown as Database & { sql: ReturnType<typeof vi.fn> };

  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const dispatcher = new AlertDispatcher(db, 5000, {
    resolveAddresses,
    ...dispatcherOptions,
  });

  return { dispatcher, db, fetchMock, resolveAddresses, sql };
}

function okResponse() {
  return new Response("", { status: 200 });
}

function redirectResponse(location: string) {
  return new Response("", { status: 302, headers: { location } });
}

describe("AlertDispatcher destination policy", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers to a hostname that resolves to a public address", async () => {
    const { dispatcher, fetchMock, sql } = setup(
      [webhook()],
      { "hooks.example.com": [PUBLIC] },
    );
    fetchMock.mockResolvedValue(okResponse());

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://hooks.example.com/spendguard");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "SpendGuard/0.1",
        Authorization: "Bearer s3cret",
      },
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      event: "spendguard.alert",
      id: "alert-1",
      eventAmount: "1000000",
      totalSpentInWindow: "12000000",
      cap: "10000000",
    });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("refuses a webhook that resolves to the link-local metadata address before opening a socket", async () => {
    const { dispatcher, fetchMock, resolveAddresses, sql } = setup(
      [webhook({ url: "https://attacker.example/hook" })],
      { "attacker.example": ["169.254.169.254"] },
    );

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);

    expect(resolveAddresses).toHaveBeenCalledWith("attacker.example");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to both a public and an internal address", async () => {
    const { dispatcher, fetchMock } = setup(
      [webhook({ url: "https://dual.example/hook" })],
      { "dual.example": [PUBLIC, "10.0.0.9"] },
    );

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an IP-literal loopback webhook without consulting DNS", async () => {
    const { dispatcher, fetchMock, resolveAddresses } = setup(
      [webhook({ url: "http://127.0.0.1:3000/hook" })],
      {},
    );

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveAddresses).not.toHaveBeenCalled();
  });

  it("never sends the bearer secret to a refused target", async () => {
    const { dispatcher, fetchMock } = setup(
      [webhook({ url: "https://internal.example/hook", secret: "leaky-secret" })],
      { "internal.example": ["192.168.1.10"] },
    );

    await dispatcher.dispatchAlert(alert());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-checks redirect targets and stops at an internal hop", async () => {
    const { dispatcher, fetchMock, sql } = setup(
      [webhook({ url: "https://hooks.example.com/spendguard" })],
      {
        "hooks.example.com": [PUBLIC],
        "as-internal.example": ["100.64.0.1"],
      },
    );
    fetchMock
      .mockResolvedValueOnce(redirectResponse("http://as-internal.example/latest/meta-data"))
      .mockResolvedValueOnce(okResponse());

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://hooks.example.com/spendguard",
    );
    expect(sql).not.toHaveBeenCalled();
  });

  it("follows a redirect that stays public", async () => {
    const { dispatcher, fetchMock } = setup(
      [webhook({ url: "https://hooks.example.com/spendguard" })],
      {
        "hooks.example.com": [PUBLIC],
        "relay.example.net": ["1.1.1.1"],
      },
    );
    fetchMock
      .mockResolvedValueOnce(redirectResponse("https://relay.example.net/hook"))
      .mockResolvedValueOnce(okResponse());

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://relay.example.net/hook");
  });

  it("gives up instead of chasing an endless redirect chain", async () => {
    const { dispatcher, fetchMock } = setup(
      [webhook({ url: "https://hooks.example.com/spendguard" })],
      { "hooks.example.com": [PUBLIC] },
      { maxRedirects: 2 },
    );
    fetchMock.mockResolvedValue(
      redirectResponse("https://hooks.example.com/spendguard?loop=1"),
    );

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not mark delivery when a public webhook answers an error", async () => {
    const { dispatcher, fetchMock, sql } = setup(
      [webhook()],
      { "hooks.example.com": [PUBLIC] },
    );
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
  });

  it("lets loopback through only when private networks are explicitly allowed", async () => {
    const { dispatcher, fetchMock, resolveAddresses } = setup(
      [webhook({ url: "http://127.0.0.1:3000/hook" })],
      {},
      { allowPrivateNetworks: true },
    );
    fetchMock.mockResolvedValue(okResponse());

    await expect(dispatcher.dispatchAlert(alert())).resolves.toBe(true);
    expect(resolveAddresses).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips endpoints that do not subscribe to the alert level", async () => {
    const { dispatcher, fetchMock } = setup([
      webhook({ alertLevels: ["near_miss"] }),
    ]);

    await expect(dispatcher.dispatchAlert(alert({ level: "breach" }))).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
