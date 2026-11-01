import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "../lib/auth/session";

/**
 * The database-backed half of the account service.
 *
 * Every other route test deletes DATABASE_URL, which leaves the seeded
 * in-memory store answering — and the bug this file pins only exists once a
 * database is configured: memberships were read from the database but written
 * only to memory, so an account created against Postgres had no owner as far
 * as sign-in was concerned and the deployment could never be opened.
 *
 * The mock is a tagged-template function over two arrays, which is all the
 * service needs: `getDb()` returns it, and every query is matched by the table
 * it names.
 */
const dbState = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  members: [] as Record<string, unknown>[],
  queries: [] as string[],
  failNextWrite: false,
}));

vi.mock("../lib/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const query = strings.join("").replace(/\s+/g, " ").trim();
    dbState.queries.push(query);

    if (/^SELECT/.test(query) && /FROM treasury_accounts/.test(query)) {
      return Promise.resolve(dbState.accounts);
    }
    if (/^SELECT/.test(query) && /FROM account_members/.test(query)) {
      const accountId = values[0];
      return Promise.resolve(dbState.members.filter((m) => m.account_id === accountId));
    }
    if (/INSERT INTO treasury_accounts/.test(query)) {
      const [id, name, description, address, type, status, contextRuleId, createdAt] = values;
      // Dates, because the service reads these columns back with
      // `toISOString()`: a string here would make the query look like it
      // failed and quietly drop every assertion below onto the memory store.
      const asDate = new Date(String(createdAt));
      dbState.accounts.push({
        id, name, description, address, type, status,
        context_rule_id: contextRuleId,
        created_at: asDate,
        updated_at: asDate,
      });
      return Promise.resolve([]);
    }
    if (/INSERT INTO account_members/.test(query)) {
      const [accountId, email, name, role] = values;
      const existing = dbState.members.find(
        (m) => m.account_id === accountId && m.email === email
      );
      if (existing) {
        existing.role = role;
        existing.name = name;
      } else {
        dbState.members.push({
          id: `db-member-${dbState.members.length + 1}`,
          account_id: accountId,
          email,
          name,
          role,
          added_at: new Date(),
        });
      }
      return Promise.resolve([]);
    }
    if (/DELETE FROM account_members/.test(query)) {
      const [accountId, email] = values;
      dbState.members = dbState.members.filter(
        (m) => !(m.account_id === accountId && m.email === email)
      );
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };

  return { getDb: () => sql };
});

const { AccountService, resetMemoryStore } = await import("../lib/services/account-service");
const { POST: createSession } = await import("../app/api/auth/session/route");

const OWNER = "owner@spendguard.io";
const ADDRESS = "GBPIRIU7NF5U2EWF7B6UIN22DFG4VCWWFFXHLOQH27F47RB7SQQPC4D3";

function signInRequest(email: string): Request {
  return new Request("https://spendguard.test/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function createTreasury(email = OWNER) {
  return AccountService.createAccount({
    name: "Ops Settlement Wallet",
    address: ADDRESS,
    type: "Business",
    contextRuleId: 1,
    ownerEmail: email,
    ownerName: "Alice Owner",
  });
}

beforeEach(() => {
  dbState.accounts = [];
  dbState.members = [];
  dbState.queries = [];
  process.env.SESSION_SECRET = "test-session-secret-value";
  process.env.DEMO_AUTH = "true";
  resetMemoryStore();

  // These tests are only worth running if the database path is the one being
  // exercised. Every read falls back to the memory store when a query throws,
  // and that fallback would answer correctly no matter what this file changed.
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (/memory store/i.test(first)) {
      throw new Error(`the service fell back to the memory store: ${first}`);
    }
  });
});

describe("creating an account against a database", () => {
  it("records the owner as a membership row, not only in this process", async () => {
    const account = await createTreasury();

    expect(dbState.accounts.map((a) => a.id)).toContain(account.id);
    const owner = dbState.members.find((m) => m.email === OWNER);
    expect(owner).toBeDefined();
    expect(owner?.role).toBe("Owner");
    expect(owner?.account_id).toBe(account.id);
  });

  it("reads that membership back so the owner's role resolves", async () => {
    const account = await createTreasury();

    const members = await AccountService.getMembers(account.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe(OWNER);
    expect(members[0]?.role).toBe("Owner");
    expect(members[0]?.addedAt).toBeTypeOf("string");
  });
});

describe("sign-in with a database configured", () => {
  it("admits the owner of a treasury this process never created", async () => {
    // Another process (or an earlier boot) created it; only the database knows.
    dbState.accounts = [
      {
        id: "acc-other-process",
        name: "Shared Treasury",
        description: "",
        address: ADDRESS,
        type: "Business",
        status: "Active",
        context_rule_id: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];
    dbState.members = [
      {
        id: "db-member-1",
        account_id: "acc-other-process",
        email: OWNER,
        name: "Alice Owner",
        role: "Owner",
        added_at: new Date(),
      },
    ];

    const res = await createSession(signInRequest(OWNER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memberships: Array<{ role: string }> };
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]?.role).toBe("Owner");
    expect(res.headers.get("set-cookie")).toContain(SESSION_COOKIE_NAME);
  });

  it("still refuses an email with no membership once an account exists", async () => {
    await createTreasury();

    const res = await createSession(signInRequest("stranger@spendguard.io"));
    expect(res.status).toBe(403);
  });

  it("lets an advertised demo identity open an empty deployment", async () => {
    // The bootstrap: no accounts, no memberships, nothing else to sign in with.
    const res = await createSession(signInRequest(OWNER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memberships: unknown[] };
    expect(body.memberships).toHaveLength(0);
  });

  it("does not hand an empty deployment to an email the sign-in screen does not offer", async () => {
    const res = await createSession(signInRequest("attacker@example.com"));
    expect(res.status).toBe(403);
  });
});

describe("member management writes with a database configured", () => {
  it("persists a role change instead of reporting one memory only", async () => {
    const account = await createTreasury();
    await AccountService.addMember(
      account.id,
      { email: "viewer@spendguard.io", name: "Eve Viewer", role: "Viewer" },
      "Owner",
      OWNER
    );

    await AccountService.updateMemberRole(
      account.id,
      "viewer@spendguard.io",
      "Approver",
      "Owner",
      OWNER
    );

    const stored = dbState.members.find((m) => m.email === "viewer@spendguard.io");
    expect(stored?.role).toBe("Approver");
    const readBack = await AccountService.getMembers(account.id);
    expect(readBack.find((m) => m.email === "viewer@spendguard.io")?.role).toBe("Approver");
  });

  it("deletes the row, so the removed member does not keep their role", async () => {
    const account = await createTreasury();
    await AccountService.addMember(
      account.id,
      { email: "admin@spendguard.io", name: "Bob Admin", role: "Admin" },
      "Owner",
      OWNER
    );

    await AccountService.removeMember(account.id, "admin@spendguard.io", "Owner", OWNER);

    expect(dbState.members.some((m) => m.email === "admin@spendguard.io")).toBe(false);
    expect((await AccountService.getMembers(account.id)).map((m) => m.email)).toEqual([OWNER]);
  });

  it("refuses to remove the only Owner, and leaves the row in place", async () => {
    const account = await createTreasury();

    await expect(
      AccountService.removeMember(account.id, OWNER, "Owner", OWNER)
    ).rejects.toThrow("Cannot remove the only Owner");
    expect(dbState.members.filter((m) => m.email === OWNER)).toHaveLength(1);
  });
});
