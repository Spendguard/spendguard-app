import { NextResponse } from "next/server";
import {
  clearedSessionCookieHeader,
  createSessionToken,
  isSecureRequest,
  readSessionToken,
  sessionCookieHeader,
  verifySessionToken,
} from "@/lib/auth/session";
import { AccountService } from "@/lib/services/account-service";

/**
 * Demo identity endpoints.
 *
 * POST /api/auth/session is a demo affordance, not authentication: it trades an
 * email address for a signed session with no credential check. It only exists
 * when DEMO_AUTH=true (the seeded, no-database experience). A real deployment
 * puts an identity provider in front and leaves this route returning 501, so
 * "who are you" is answered by the IdP and "what may you do" is answered here.
 *
 * GET    /api/auth/session — current identity, plus this user's role per account
 * POST   /api/auth/session — demo sign-in { email }
 * DELETE /api/auth/session — sign out
 */

function identityPayload(email: string) {
  return (async () => {
    const accounts = await AccountService.listAccounts();
    const memberships = await Promise.all(
      accounts.map(async (account) => {
        const members = await AccountService.getMembers(account.id);
        const member = members.find((m) => m.email.toLowerCase() === email.toLowerCase());
        return member
          ? { accountId: account.id, name: account.name, role: member.role, memberName: member.name }
          : null;
      })
    );
    const granted = memberships.filter((m): m is NonNullable<typeof m> => m !== null);
    const memberName = granted[0]?.memberName ?? null;
    return { email, memberName, memberships: granted };
  })();
}

export async function GET(request: Request): Promise<NextResponse> {
  // Whether this deployment hands out demo sessions. The UI renders from this
  // answer rather than its own guess, so a reviewer can never be shown a
  // badge the server did not grant — nor have one hidden from them.
  const demoMode = process.env.DEMO_AUTH === "true";

  const session = verifySessionToken(readSessionToken(request));
  if (!session) {
    return NextResponse.json({ authenticated: false, demoMode }, { status: 401 });
  }

  const identity = await identityPayload(session.email);
  return NextResponse.json({ authenticated: true, demoMode, expiresAt: session.expiresAt, ...identity });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.DEMO_AUTH !== "true") {
    return NextResponse.json(
      {
        error:
          "No identity provider is configured. Set DEMO_AUTH=true to enable the seeded demo sign-in, or wire a real IdP.",
      },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (body as { email?: unknown })?.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const identity = await identityPayload(email.trim().toLowerCase());
  if (identity.memberships.length === 0) {
    return NextResponse.json(
      { error: `"${email}" is not a member of any treasury account` },
      { status: 403 }
    );
  }

  const token = createSessionToken(identity.email);
  return NextResponse.json(
    { authenticated: true, ...identity },
    { status: 200, headers: { "Set-Cookie": sessionCookieHeader(token, isSecureRequest(request)) } }
  );
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return NextResponse.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearedSessionCookieHeader(isSecureRequest(request)) } }
  );
}
