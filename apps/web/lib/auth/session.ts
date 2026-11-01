import crypto from "node:crypto";
import { AccountService } from "../services/account-service";
import type { AccountRole } from "@spendguard/sdk";

/**
 * Sessions carry identity only — never a role.
 *
 * A member's role is a property of the account they are acting on, so it is
 * resolved from the membership record on every request. Storing a role in the
 * cookie would let one session act on accounts the user is not a member of,
 * and would freeze the role while an admin changes it.
 */

export const SESSION_COOKIE_NAME = "spendguard_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * Falls back to a per-process secret when SESSION_SECRET is unset. Sessions
 * then invalidate on every cold start, which is acceptable for a demo and
 * loudly unacceptable for a deployment — hence the warning.
 */
let ephemeralSecret: string | null = null;

function getSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;

  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[auth] SESSION_SECRET is unset or shorter than 16 characters; using an ephemeral per-process secret. Sessions will not survive restarts."
    );
  }
  return ephemeralSecret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export type Session = { email: string; expiresAt: number };

/** Build a signed, URL-safe session token. */
export function createSessionToken(email: string, ttlSeconds: number = SESSION_TTL_SECONDS): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + ttlSeconds * 1000 }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify a token's signature and expiry. Returns null for anything invalid. */
export function verifySessionToken(token: string | null | undefined): Session | null {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(signature, "utf8");
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { email, exp } = parsed as { email?: unknown; exp?: unknown };
  if (typeof email !== "string" || typeof exp !== "number") return null;
  if (exp <= Date.now()) return null;

  return { email, expiresAt: exp };
}

/** Read the session token out of a request's Cookie header. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return (
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; ` +
    `HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

export function clearedSessionCookieHeader(secure: boolean): string {
  return (
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

export type Actor = { email: string; role: AccountRole; name: string };

export type AuthFailure = { status: 401 | 403; error: string };

/** True when the request is served over TLS, so cookies can be marked Secure. */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve the signed-in user for a specific treasury account.
 *
 * 401 when there is no valid session, 403 when the session is valid but the
 * user is not a member of that account — the two cases must not be collapsed,
 * or a caller could probe membership by watching status codes, which is fine to
 * prevent cheaply and worth being explicit about.
 */
export async function resolveActor(
  request: Request,
  accountId: string
): Promise<{ actor: Actor } | { failure: AuthFailure }> {
  const session = verifySessionToken(readSessionToken(request));
  if (!session) {
    return { failure: { status: 401, error: "Authentication required" } };
  }

  const members = await AccountService.getMembers(accountId);
  const member = members.find((m) => m.email.toLowerCase() === session.email.toLowerCase());
  if (!member) {
    return {
      failure: { status: 403, error: `Not a member of account "${accountId}"` },
    };
  }

  return { actor: { email: member.email, role: member.role, name: member.name } };
}

/**
 * Resolve just the signed-in identity, for routes that are not scoped to one
 * account (creating a treasury, listing the user's own accounts).
 */
export async function resolveIdentity(
  request: Request
): Promise<{ session: Session } | { failure: AuthFailure }> {
  const session = verifySessionToken(readSessionToken(request));
  if (!session) {
    return { failure: { status: 401, error: "Authentication required" } };
  }
  return { session };
}

/** Look up the role an email holds on an account, if any. */
export async function roleFor(
  accountId: string,
  email: string
): Promise<AccountRole | null> {
  const members = await AccountService.getMembers(accountId);
  return members.find((m) => m.email.toLowerCase() === email.toLowerCase())?.role ?? null;
}

/**
 * True when the signed-in user is a member of the account owning `address`.
 * Used by the routes that query by Stellar address rather than by account id.
 */
export async function canReadAddress(email: string, address: string): Promise<boolean> {
  const visible = await AccountService.listAccountsForMember(email);
  return visible.some((a) => a.address.toLowerCase() === address.toLowerCase());
}

/**
 * Gate for resources that are global rather than account-scoped — webhook
 * endpoints and their signing secrets, for instance. Requires Owner or Admin
 * somewhere, because "which URL receives our alerts" is a configuration
 * decision, not a per-treasury one.
 */
export async function resolvePrivilegedActor(
  request: Request
): Promise<{ actor: Actor } | { failure: AuthFailure }> {
  const session = verifySessionToken(readSessionToken(request));
  if (!session) {
    return { failure: { status: 401, error: "Authentication required" } };
  }

  const accounts = await AccountService.listAccountsForMember(session.email);
  const privileges: AccountRole[] = ["Owner", "Admin"];
  for (const account of accounts) {
    const role = await roleFor(account.id, session.email);
    if (role && privileges.includes(role)) {
      return { actor: { email: session.email, role, name: account.name } };
    }
  }

  return {
    failure: { status: 403, error: "Requires an Owner or Admin role on any treasury account" },
  };
}
