/**
 * API route for treasury accounts management.
 *
 * GET  /api/accounts — list the treasury accounts the signed-in user belongs to
 * GET  /api/accounts?address=G...&alerts=true — alias: alerts for that address
 * GET  /api/accounts?address=G...&events=true — alias: ingested events for it
 * POST /api/accounts — create a new treasury account
 *
 * Every response is scoped to the session: previously any anonymous caller
 * could enumerate every treasury in the deployment, and read any address's
 * settlement events and alerts.
 */

import { NextResponse } from "next/server";
import { AccountService } from "@/lib/services/account-service";
import { resolveIdentity, canReadAddress } from "@/lib/auth/session";
import type { AccountType, AccountStatus } from "@spendguard/sdk";
import postgres from "postgres";

// ── Helpers ───────────────────────────────────────────────────────────

function getDb(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    return postgres(url, { max: 2, idle_timeout: 10 });
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await resolveIdentity(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }
  const email = auth.session.email;

  try {
    const { searchParams } = new URL(request.url);

    // ── Events alias: ?events=true&address=G... ───────────────────────
    // Returns the live SEP-41 / spending_limit_enforced settlement events
    // the indexer has ingested for this address (Postgres source of truth).
    const wantsEvents = searchParams.get("events") === "true";
    const wantsAlerts = searchParams.get("alerts") === "true";
    const address = searchParams.get("address");

    if ((wantsEvents || wantsAlerts) && address) {
      if (!(await canReadAddress(email, address))) {
        return NextResponse.json(
          { error: "Not a member of this account" },
          { status: 403 }
        );
      }
    }

    if (wantsEvents && address) {
      const db = getDb();
      if (db) {
        try {
          const rows = await db`
            SELECT
              id,
              ledger,
              account,
              source_contract_id,
              amount_spent::text AS amount_spent,
              context_rule_id,
              reference,
              ingested_at
            FROM settlement_events
            WHERE account = ${address}
            ORDER BY ingested_at DESC, ledger DESC
            LIMIT 200
          `;
          await db.end({ timeout: 2 });

          const events = rows.map((r) => ({
            id: r.id as string,
            // BIGINT columns come back from postgres.js as strings; coerce
            // so the JSON matches the documented number type.
            ledger: Number(r.ledger),
            account: r.account as string,
            sourceContractId: r.source_contract_id as string,
            amountSpent: r.amount_spent as string,
            contextRuleId: r.context_rule_id as number,
            reference: (r.reference as string | null) ?? null,
            timestamp: (r.ingested_at as Date).toISOString(),
          }));

          return NextResponse.json(events);
        } catch (err) {
          console.warn("GET /api/accounts events query failed:", err);
          await db.end({ timeout: 2 }).catch(() => {});
        }
      }
      // No DB or query failed — return empty events
      return NextResponse.json([]);
    }

    if (wantsAlerts && address) {
      const db = getDb();
      if (db) {
        try {
          const rows = await db`
            SELECT
              id,
              account,
              context_rule_id,
              level,
              event_amount::text          AS event_amount,
              total_spent_in_window::text AS total_spent_in_window,
              cap::text                   AS cap,
              trigger_ledger,
              raised_at,
              webhook_delivered
            FROM alerts
            WHERE account = ${address}
            ORDER BY raised_at DESC
            LIMIT 100
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
            // BIGINT columns come back from postgres.js as strings; coerce
            // so the JSON matches the documented number type.
            triggerLedger: Number(r.trigger_ledger),
            raisedAt: (r.raised_at as Date).toISOString(),
            webhookDelivered: r.webhook_delivered as boolean,
          }));

          return NextResponse.json(alerts);
        } catch (err) {
          console.warn("GET /api/accounts alerts query failed:", err);
          await db.end({ timeout: 2 }).catch(() => {});
        }
      }
      // No DB or query failed — return empty alerts
      return NextResponse.json([]);
    }

    // ── Normal account listing ─────────────────────────────────────
    const status = (searchParams.get("status") as AccountStatus) || undefined;
    const type = (searchParams.get("type") as AccountType) || undefined;
    const search = searchParams.get("search") || undefined;

    const accounts = await AccountService.listAccountsForMember(email, { status, type, search });
    return NextResponse.json(accounts);
  } catch (err) {
    console.error("GET /api/accounts error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await resolveIdentity(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const body = await request.json();

    if (!body.name || !body.address || !body.ownerEmail) {
      return NextResponse.json(
        { error: "Missing required fields: name, address, ownerEmail" },
        { status: 400 }
      );
    }

    const initialCap = body.initialCap ? BigInt(body.initialCap) : undefined;

    const account = await AccountService.createAccount({
      name: body.name,
      description: body.description,
      address: body.address,
      type: body.type || "Business",
      contextRuleId: body.contextRuleId ? Number(body.contextRuleId) : 1,
      ownerEmail: body.ownerEmail,
      ownerName: body.ownerName || "Account Owner",
      initialCap,
    });

    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounts error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create account" },
      { status: 400 }
    );
  }
}
