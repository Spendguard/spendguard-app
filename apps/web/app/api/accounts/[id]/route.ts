/**
 * API route for individual account details, updates, and archiving/deletion.
 *
 * GET    /api/accounts/[id] — fetch details for account
 * PATCH  /api/accounts/[id] — update account
 * DELETE /api/accounts/[id] — archive or delete account
 *
 * The actor is always the signed-in session, never a field in the request: a
 * caller asserting "actorRole": "Owner" used to be enough to pass every check.
 */

import { NextResponse } from "next/server";
import { AccountService } from "@/lib/services/account-service";
import { resolveActor } from "@/lib/auth/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Members and settings (webhook URLs, thresholds) are sensitive, so reads
    // require membership too rather than running unauthenticated.
    const auth = await resolveActor(request, id);
    if ("failure" in auth) {
      return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
    }

    const account = await AccountService.getAccountById(id);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const [members, settings] = await Promise.all([
      AccountService.getMembers(account.id),
      AccountService.getSettings(account.id),
    ]);

    return NextResponse.json({ ...account, members, settings, actorRole: auth.actor.role });
  } catch (err) {
    console.error("GET /api/accounts/[id] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveActor(request, id);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const body = await request.json();

    const updated = await AccountService.updateAccount(
      id,
      {
        name: body.name,
        description: body.description,
        type: body.type,
        status: body.status,
        contextRuleId: body.contextRuleId ? Number(body.contextRuleId) : undefined,
      },
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/accounts/[id] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update account" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveActor(request, id);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") === "delete" ? "delete" : "archive";

    await AccountService.archiveOrDeleteAccount(id, action, auth.actor.role, auth.actor.email);
    return NextResponse.json({ success: true, action });
  } catch (err) {
    console.error("DELETE /api/accounts/[id] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to archive/delete account" },
      { status: 400 }
    );
  }
}
