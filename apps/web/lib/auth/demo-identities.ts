/**
 * The identities `DEMO_AUTH=true` hands out.
 *
 * The sign-in screen renders this list and the session route reads it, so the
 * emails offered as "demo identities" and the emails the server will start a
 * demo session for cannot drift apart.
 */
export const DEMO_IDENTITIES: Array<{ email: string; label: string }> = [
  { email: "owner@spendguard.io", label: "Alice Owner — full control" },
  { email: "admin@spendguard.io", label: "Bob Admin — members and policies" },
  { email: "finance@spendguard.io", label: "Carol Finance — budgets and proposals" },
  { email: "approver@spendguard.io", label: "Dan Approver — votes only" },
  { email: "viewer@spendguard.io", label: "Eve Viewer — read-only" },
];

const DEMO_EMAILS = new Set(DEMO_IDENTITIES.map((i) => i.email));

/** Whether this email is one of the demo identities, compared lower-cased. */
export function isDemoIdentity(email: string): boolean {
  return DEMO_EMAILS.has(email.trim().toLowerCase());
}
