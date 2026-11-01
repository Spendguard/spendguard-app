/**
 * API route for webhook configuration management.
 *
 * GET  /api/webhooks — list all webhook configs (secrets masked)
 * POST /api/webhooks — create or update a webhook config
 * DELETE /api/webhooks?id=... — delete a webhook config
 *
 * Webhook targets are global configuration — they decide where alert payloads
 * and a signing secret are delivered — so they are restricted to a session
 * holding Owner or Admin on at least one treasury, and every URL is put through
 * the shared destination policy (`@spendguard/sdk`) before it is stored.
 */

import { NextResponse } from "next/server";
import { checkWebhookUrlShape } from "@spendguard/sdk";
import { resolvePrivilegedActor } from "@/lib/auth/session";
import { getDbOrThrow } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────

function maskSecret(secret: string | null): string | null {
  if (!secret || secret.length < 8) return secret;
  return secret.slice(0, 4) + "…" + secret.slice(-4);
}

// ── GET ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await resolvePrivilegedActor(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const sql = getDbOrThrow();

    const configs = await sql`
      SELECT id, url, secret, alert_levels, enabled, created_at, updated_at
      FROM webhook_configs
      ORDER BY created_at DESC
    `;

    const mapped = configs.map((c) => ({
      id: c.id as string,
      url: c.url as string,
      secret: maskSecret((c.secret as string | null) ?? null),
      alertLevels: c.alert_levels as string[],
      enabled: c.enabled as boolean,
      createdAt: (c.created_at as Date).toISOString(),
      updatedAt: (c.updated_at as Date).toISOString(),
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    console.error("GET /api/webhooks error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await resolvePrivilegedActor(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const body = (await request.json()) as {
      id?: string;
      url: string;
      secret?: string;
      alertLevels?: string[];
      enabled?: boolean;
    };

    if (!body.url) {
      return NextResponse.json(
        { error: "Missing required field: url" },
        { status: 400 },
      );
    }

    // Destination policy, applied at write time. The dispatcher re-checks on
    // delivery (including DNS and every redirect hop), but a webhook that
    // targets a metadata endpoint or a database port should never reach the
    // table in the first place.
    const target = checkWebhookUrlShape(body.url, {
      allowPrivateNetworks: process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === "true",
    });
    if (!target.ok) {
      return NextResponse.json({ error: target.reason }, { status: 400 });
    }

    const alertLevels = body.alertLevels ?? ["near_miss", "breach"];
    const validLevels = alertLevels.every((l) =>
      ["near_miss", "breach"].includes(l),
    );
    if (!validLevels) {
      return NextResponse.json(
        { error: "Invalid alert level; must be 'near_miss' or 'breach'" },
        { status: 400 },
      );
    }

    const sql = getDbOrThrow();

    if (body.id) {
      // Update existing webhook
      const result = await sql`
        UPDATE webhook_configs SET
          url = ${body.url},
          secret = COALESCE(${body.secret ?? null}, secret),
          alert_levels = ${alertLevels},
          enabled = COALESCE(${body.enabled ?? true}, enabled),
          updated_at = now()
        WHERE id = ${body.id}
        RETURNING id, url, alert_levels, enabled, created_at, updated_at
      `;

      if (result.length === 0) {
        return NextResponse.json(
          { error: "Webhook config not found" },
          { status: 404 },
        );
      }

      const row = result[0]!;

      return NextResponse.json({
        id: row.id as string,
        url: row.url as string,
        alertLevels: row.alert_levels as string[],
        enabled: row.enabled as boolean,
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString(),
      });
    }

    // Create new webhook
    const result = await sql`
      INSERT INTO webhook_configs (url, secret, alert_levels, enabled)
      VALUES (${body.url}, ${body.secret ?? null}, ${alertLevels}, ${body.enabled ?? true})
      RETURNING id, url, alert_levels, enabled, created_at, updated_at
    `;

    const row = result[0]!;

    return NextResponse.json(
      {
        id: row.id as string,
        url: row.url as string,
        alertLevels: row.alert_levels as string[],
        enabled: row.enabled as boolean,
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/webhooks error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── DELETE ────────────────────────────────────────────────────────────

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await resolvePrivilegedActor(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing required query param: id" },
        { status: 400 },
      );
    }

    const sql = getDbOrThrow();
    await sql`DELETE FROM webhook_configs WHERE id = ${id}`;

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/webhooks error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
