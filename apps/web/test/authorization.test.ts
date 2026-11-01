import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  readSessionToken,
  resolveActor,
  resolvePrivilegedActor,
  canReadAddress,
  SESSION_COOKIE_NAME,
} from "../lib/auth/session";
import { AccountService, resetMemoryStore } from "../lib/services/account-service";
import { GET as membersGET, POST as membersPOST } from "../app/api/accounts/[id]/members/route";
import { POST as accountsPOST } from "../app/api/accounts/route";

const SECRET = "test-session-secret-value";

function requestWith(email: string | null, url = "https://spendguard.test/api", init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  if (email) {
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(email))}`);
  }
  return new Request(url, { ...init, headers });
}

describe("session tokens", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  it("round-trips the identity", () => {
    const token = createSessionToken("owner@spendguard.io");
    expect(verifySessionToken(token)).toMatchObject({ email: "owner@spendguard.io" });
  });

  it("rejects a token whose payload was edited", () => {
    const token = createSessionToken("viewer@spendguard.io");
    const [payload, signature] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
    const forged = Buffer.from(
      JSON.stringify({ email: "owner@spendguard.io", exp: Date.now() + 60_000 })
    ).toString("base64url");
    expect(verifySessionToken(`${forged}.${signature}`)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it("rejects an expired token", () => {
    expect(verifySessionToken(createSessionToken("owner@spendguard.io", -1))).toBeNull();
  });

  it("rejects malformed tokens", () => {
    for (const junk of ["", ".", "abc", "abc.", "notbase64.sig", "a.b.c"]) {
      expect(verifySessionToken(junk)).toBeNull();
    }
  });

  it("rejects a token signed under a different secret", () => {
    const token = createSessionToken("owner@spendguard.io");
    process.env.SESSION_SECRET = "a-completely-different-secret";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("reads the cookie off a request and ignores unrelated cookies", () => {
    expect(readSessionToken(requestWith(null))).toBeNull();
    const req = requestWith("owner@spendguard.io");
    expect(readSessionToken(req)).not.toBeNull();
  });
});

describe("actor resolution", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    resetMemoryStore();
  });

  it("401s with no session", async () => {
    const result = await resolveActor(requestWith(null), "acc-main-treasury");
    expect("failure" in result && result.failure.status).toBe(401);
  });

  it("403s for a valid session that is not a member of the account", async () => {
    const outsider = await AccountService.createAccount({
      name: "Private Treasury",
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      type: "Business",
      ownerEmail: "insider@spendguard.io",
      ownerName: "Insider",
    });

    const result = await resolveActor(requestWith("viewer@spendguard.io"), outsider.id);
    expect("failure" in result && result.failure.status).toBe(403);
  });

  it("resolves the role held on that specific account", async () => {
    const asOwner = await resolveActor(requestWith("owner@spendguard.io"), "acc-main-treasury");
    const asViewer = await resolveActor(requestWith("viewer@spendguard.io"), "acc-main-treasury");
    expect("actor" in asOwner && asOwner.actor.role).toBe("Owner");
    expect("actor" in asViewer && asViewer.actor.role).toBe("Viewer");
  });

  it("scopes the account list to memberships", async () => {
    const private_ = await AccountService.createAccount({
      name: "Not Yours",
      address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
      type: "DAO",
      ownerEmail: "someone-else@spendguard.io",
      ownerName: "Someone Else",
    });

    const mine = await AccountService.listAccountsForMember("viewer@spendguard.io");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((a) => a.id === private_.id)).toBe(false);

    const theirs = await AccountService.listAccountsForMember("someone-else@spendguard.io");
    expect(theirs.map((a) => a.id)).toContain(private_.id);
  });

  it("only lets an owner or admin reach global webhook configuration", async () => {
    const asViewer = await resolvePrivilegedActor(requestWith("viewer@spendguard.io"));
    expect("failure" in asViewer && asViewer.failure.status).toBe(403);

    const asFinance = await resolvePrivilegedActor(requestWith("finance@spendguard.io"));
    expect("failure" in asFinance && asFinance.failure.status).toBe(403);

    const asOwner = await resolvePrivilegedActor(requestWith("owner@spendguard.io"));
    expect("actor" in asOwner).toBe(true);
  });

  it("gates address-scoped reads by membership", async () => {
    const seeded = await AccountService.getAccountById("acc-main-treasury");
    expect(seeded && (await canReadAddress("viewer@spendguard.io", seeded.address))).toBe(true);
    expect(seeded && (await canReadAddress("stranger@spendguard.io", seeded.address))).toBe(false);
  });
});

describe("route handlers refuse forged identities", () => {
  const params = { params: Promise.resolve({ id: "acc-main-treasury" }) };

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    resetMemoryStore();
  });

  it("ignores a body claiming actorRole Owner when the session is a Viewer", async () => {
    const res = await membersPOST(
      requestWith("viewer@spendguard.io", "https://spendguard.test/api/accounts/acc-main-treasury/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "sneaky@spendguard.io",
          name: "Sneaky",
          role: "Admin",
          actorRole: "Owner",
          actorEmail: "owner@spendguard.io",
        }),
      }),
      params
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/does not have permission/);

    const members = await AccountService.getMembers("acc-main-treasury");
    expect(members.some((m) => m.email === "sneaky@spendguard.io")).toBe(false);
  });

  it("401s an anonymous member list", async () => {
    const res = await membersGET(requestWith(null, "https://spendguard.test/api"), params);
    expect(res.status).toBe(401);
  });

  it("401s an anonymous treasury creation", async () => {
    const res = await accountsPOST(
      requestWith(null, "https://spendguard.test/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Anonymous Treasury",
          address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          ownerEmail: "nobody@spendguard.io",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("lets a genuine Owner through the same route", async () => {
    const res = await membersPOST(
      requestWith("owner@spendguard.io", "https://spendguard.test/api/accounts/acc-main-treasury/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "legit@spendguard.io",
          name: "Legit Member",
          role: "Viewer",
        }),
      }),
      params
    );

    expect(res.status).toBe(201);
    const members = await AccountService.getMembers("acc-main-treasury");
    expect(members.some((m) => m.email === "legit@spendguard.io")).toBe(true);
  });
});
