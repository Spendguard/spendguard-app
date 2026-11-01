import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every `postgres()` call in this file lands in `pools.created`, so the suite
 * can count how many clients the app builds for a request burst — the whole
 * point of the shared pool is that this stays at one per connection string.
 */
const pools = vi.hoisted(() => ({ created: [] as MockPool[] }));

type MockPool = {
  url: string;
  options: unknown;
  end: ReturnType<typeof vi.fn>;
};

vi.mock("postgres", () => ({
  default: (url: string, options: unknown) => {
    const instance = Object.assign(
      // Tagged-template use (`db\`SELECT …\``) rejects, which is what an
      // unreachable database looks like to the routes.
      () => Promise.reject(new Error(`mock pool for ${url} is not connected`)),
      { url, options, end: vi.fn(async () => {}) }
    );
    pools.created.push(instance as unknown as MockPool);
    return instance;
  },
}));

import { createSessionToken, SESSION_COOKIE_NAME } from "../lib/auth/session";
import { resetMemoryStore } from "../lib/services/account-service";
import { getDb, getDbOrThrow } from "../lib/db";
import { GET as accountsGET } from "../app/api/accounts/route";
import { GET as alertsGET } from "../app/api/alerts/route";

const SECRET = "test-session-secret-value";
const MAIN_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function as(email: string, path: string): Request {
  const headers = new Headers({
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(email))}`,
  });
  return new Request(`https://spendguard.test${path}`, { headers });
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  resetMemoryStore();
  pools.created.length = 0;
});

describe("shared Postgres pool", () => {
  it("builds one client per connection string and hands out that same client", () => {
    process.env.DATABASE_URL = "postgres://pool.test/first";

    const a = getDb();
    const b = getDb();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(pools.created).toHaveLength(1);

    // A different database is a different pool — the cache is keyed by the
    // connection string, not by "whatever was configured last".
    process.env.DATABASE_URL = "postgres://pool.test/second";
    const c = getDb();
    expect(c).not.toBe(a);
    expect(pools.created).toHaveLength(2);
  });

  it("answers null when no database is configured and throws only when forced", () => {
    delete process.env.DATABASE_URL;
    expect(getDb()).toBeNull();
    expect(() => getDbOrThrow()).toThrow(/DATABASE_URL is not configured/);
  });

  it("reuses the pool across a burst of feed requests instead of opening one each time", async () => {
    process.env.DATABASE_URL = "postgres://pool.test/burst";

    const feeds = [
      `/api/accounts?address=${MAIN_ADDRESS}&alerts=true`,
      `/api/accounts?address=${MAIN_ADDRESS}&events=true`,
      `/api/alerts?address=${MAIN_ADDRESS}`,
    ];
    const responses = await Promise.all(feeds.map((path) => run(path)));

    // Every feed degrades honestly while the pool cannot connect…
    expect(responses.every((res) => res.status === 503)).toBe(true);
    // …and none of them paid for a new client or closed the shared one.
    expect(pools.created).toHaveLength(1);
    expect(pools.created[0]!.end).not.toHaveBeenCalled();

    // A second burst on the same connection string reuses the same client.
    await run(feeds[0]!);
    expect(pools.created).toHaveLength(1);
  });

  it("keeps one pool even when the membership lookup and the feed query both fail", async () => {
    process.env.DATABASE_URL = "postgres://pool.test/mixed";

    const accounts = await accountsGET(as("owner@spendguard.io", "/api/accounts"));
    expect(accounts.status).toBe(200);
    const alerts = await alertsGET(as("owner@spendguard.io", `/api/alerts?address=${MAIN_ADDRESS}`));
    expect(alerts.status).toBe(503);

    expect(pools.created).toHaveLength(1);
    expect(pools.created[0]!.end).not.toHaveBeenCalled();
  });
});

/**
 * The memory-store fallback seeds these demo treasuries, so a signed-in owner
 * reaches the feed routes without a database behind them.
 */
async function run(path: string): Promise<Response> {
  const request = as("owner@spendguard.io", path);
  return path.startsWith("/api/alerts")
    ? alertsGET(request)
    : accountsGET(request);
}
