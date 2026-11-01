import { NextResponse } from "next/server";
import { FEED_UNAVAILABLE_STATUS } from "@/lib/feed";

export { FEED_UNAVAILABLE_STATUS, FeedUnavailableError, throwIfFeedUnavailable } from "@/lib/feed";

/**
 * Server-side response factory for the feed routes.
 *
 * Both used to answer `200 []`, which on a monitoring dashboard is the worst
 * possible confusion: an unreachable indexer looked exactly like a quiet
 * treasury. 503 is what the routes return when a database is configured and
 * the query failed; "no database configured" is still an honest empty list.
 */
export function feedUnavailable(what: string): NextResponse {
  return NextResponse.json(
    { error: `${what} unavailable`, detail: "The indexer database could not be queried." },
    { status: FEED_UNAVAILABLE_STATUS },
  );
}
