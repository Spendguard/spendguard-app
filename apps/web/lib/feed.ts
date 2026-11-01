/**
 * Client-safe half of the "outage is not emptiness" contract.
 *
 * The API routes answer 503 when a database is configured and the query
 * failed, and `200 []` only when the feed is genuinely empty (or no database
 * is configured at all). Browser components import the pieces below to tell
 * those two apart — they must not pull in `next/server`, which lives in this
 * directory's sibling, `lib/api/feed.ts`.
 */

/** Status the feed routes return when the configured data source is unreadable. */
export const FEED_UNAVAILABLE_STATUS = 503;

/** Raised by clients that read the feed routes, so a UI can degrade instead of lying. */
export class FeedUnavailableError extends Error {
  constructor(what: string) {
    super(`${what} unavailable — the indexer database could not be queried`);
    this.name = "FeedUnavailableError";
  }
}

/** Convert a 503 response into a thrown error instead of an empty result set. */
export async function throwIfFeedUnavailable(res: Response, what: string): Promise<void> {
  if (res.status === FEED_UNAVAILABLE_STATUS) {
    throw new FeedUnavailableError(what);
  }
}
