import postgres from "postgres";

/**
 * One Postgres pool per connection string, for the whole process.
 *
 * Every API route used to build its own `postgres()` client and close it again
 * a few lines later. That is a fresh TCP + SCRAM handshake for every dashboard
 * poll, and the `end()` sat on the happy path only: a rejected query jumped
 * straight to the route's catch and left that one-shot pool behind. A shared,
 * cached pool fixes both — connections get reused, nothing is closed mid-
 * request, and exactly one place decides what "configured" means.
 *
 * The cache lives on `globalThis` so Next.js dev hot-reloads don't accumulate
 * a pool per compiled module.
 */

type PoolCache = Map<string, postgres.Sql>;

const CACHE_KEY = Symbol.for("spendguard.pg.pools");

function cache(): PoolCache {
  const g = globalThis as typeof globalThis & { [CACHE_KEY]?: PoolCache };
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = new Map();
  }
  return g[CACHE_KEY]!;
}

/**
 * Pool settings, deliberately conservative: the app is a read-heavy dashboard,
 * and the indexer holds its own (separate) connection to the same database.
 * `connect_timeout` bounds how long a request can wait on an unreachable
 * database before the route answers 503 — an outage should be fast and honest.
 */
const POOL_OPTIONS = {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
} as const;

/** The shared pool for `DATABASE_URL`, or `null` when no database is configured. */
export function getDb(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  const pools = cache();
  const existing = pools.get(url);
  if (existing) return existing;

  try {
    const created = postgres(url, { ...POOL_OPTIONS });
    pools.set(url, created);
    return created;
  } catch {
    // An unparseable connection string behaves like "not configured": callers
    // fall back to the demo store rather than crashing the route.
    return null;
  }
}

/**
 * Like `getDb`, for routes that cannot answer without a database. Throws
 * before any query runs, so the caller's error path stays a single 500.
 */
export function getDbOrThrow(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL is not usable");
  }
  return db;
}
