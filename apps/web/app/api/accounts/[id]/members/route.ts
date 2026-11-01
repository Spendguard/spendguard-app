import { NextResponse } from "next/server";
import { AccountService } from "@/lib/services/account-service";
import { resolveActor } from "@/lib/auth/session";
import type { AccountRole } from "@spendguard/sdk";

/**
 * Member management for one treasury account.
 *
 * The acting role comes from the verified session, not from the request body.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveActor(request, id);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const members = await AccountService.getMembers(id);
    return NextResponse.json(members);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
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

    if (!body.email || !body.name || !body.role) {
      return NextResponse.json(
        { error: "Missing required fields: email, name, role" },
        { status: 400 }
      );
    }

    const member = await AccountService.addMember(
      id,
      { email: body.email, name: body.name, role: body.role as AccountRole },
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add member" },
      { status: 400 }
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

    if (!body.memberId || !body.newRole) {
      return NextResponse.json(
        { error: "Missing required fields: memberId, newRole" },
        { status: 400 }
      );
    }

    const updated = await AccountService.updateMemberRole(
      id,
      body.memberId,
      body.newRole as AccountRole,
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update member role" },
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
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId parameter" }, { status: 400 });
    }

    await AccountService.removeMember(id, memberId, auth.actor.role, auth.actor.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove member" },
      { status: 400 }
    );
  }
}
