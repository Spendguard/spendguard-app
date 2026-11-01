/**
 * API route for spend alerts.
 *
 * GET /api/alerts?address=G...        — alerts for a specific account address
 * GET /api/alerts?address=G...&limit=N — paginate (default 50)
 *
 * Data source: PostgreSQL `alerts` table written by the indexer. Answers 503
 * when a database is configured and cannot be queried, and `[]` only when no
 * database is configured at all — an outage must not read as a quiet treasury.
 *
 * BigInt columns (event_amount, total_spent_in_window, cap) are returned
 * from postgres.js as strings; we pass them through as strings so JSON
 * serialisation doesn't lose precision.
 */

import { NextResponse } from "next/server";
import postgres from "postgres";
import { resolveIdentity, canReadAddress } from "@/lib/auth/session";
import { feedUnavailable } from "@/lib/api/feed";

// ── DB helper ─────────────────────────────────────────────────────────

function getDb(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    return postgres(url, { max: 2, idle_timeout: 10 });
  } catch {
    return null;
  }
}

// ── GET ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await resolveIdentity(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

    if (!address) {
      return NextResponse.json(
        { error: "Missing required query param: address" },
        { status: 400 },
      );
    }

    if (!(await canReadAddress(auth.session.email, address))) {
      return NextResponse.json({ error: "Not a member of this account" }, { status: 403 });
    }

    const db = getDb();

    if (!db && process.env.DATABASE_URL) {
      // A connection string that cannot even build a pool is an outage.
      return feedUnavailable("Alert feed");
    }

    if (db) {
      try {
        const rows = address
          ? await db`
              SELECT
                id,
                account,
                context_rule_id,
                level,
                event_amount::text        AS event_amount,
                total_spent_in_window::text AS total_spent_in_window,
                cap::text                 AS cap,
                trigger_ledger,
                raised_at,
                webhook_delivered
              FROM alerts
              WHERE account = ${address}
              ORDER BY raised_at DESC
              LIMIT ${limit}
            `
          : await db`
              SELECT
                id,
                account,
                context_rule_id,
                level,
                event_amount::text        AS event_amount,
                total_spent_in_window::text AS total_spent_in_window,
                cap::text                 AS cap,
                trigger_ledger,
                raised_at,
                webhook_delivered
              FROM alerts
              ORDER BY raised_at DESC
              LIMIT ${limit}
            `;

        await db.end({ timeout: 2 });

        const alerts = rows.map((r) => ({
          id: r.id as string,
          account: r.account as string,
          contextRuleId: r.context_rule_id as number,
          level: r.level as "near_miss" | "breach",
          eventAmount: r.event_amount as string,
          totalSpentInWindow: r.total_spent_in_window as string,
          cap: r.cap as string,
          triggerLedger: r.trigger_ledger as number,
          raisedAt: (r.raised_at as Date).toISOString(),
          webhookDelivered: r.webhook_delivered as boolean,
        }));

        return NextResponse.json(alerts);
      } catch (err) {
        console.error("GET /api/alerts: DB query failed:", err);
        await db.end({ timeout: 2 }).catch(() => {});
        return feedUnavailable("Alert feed");
      }
    }

    // No database configured (demo store) — there are no ingested alerts.
    return NextResponse.json([]);
  } catch (err) {
    console.error("GET /api/alerts error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
