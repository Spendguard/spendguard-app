import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../lib/auth/session";
import { AccountService, resetMemoryStore } from "../lib/services/account-service";
import {
  GET as accountsGET,
  POST as accountsPOST,
} from "../app/api/accounts/route";
import {
  DELETE as webhooksDELETE,
  GET as webhooksGET,
  POST as webhooksPOST,
} from "../app/api/webhooks/route";
import { GET as alertsGET } from "../app/api/alerts/route";
import { GET as sessionGET } from "../app/api/auth/session/route";

const SECRET = "test-session-secret-value";
const MAIN_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function as(email: string | null, path = "/api/accounts", init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  if (email) {
    headers.set(
      "cookie",
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(email))}`
    );
  }
  return new Request(`https://spendguard.test${path}`, { ...init, headers });
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/** Accounts the signed-in user is not a member of. */
async function foreignTreasury() {
  return AccountService.createAccount({
    name: "Someone Else's Treasury",
    address: "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFWHF",
    type: "DAO",
    ownerEmail: "someone-else@spendguard.io",
    ownerName: "Someone Else",
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  // The memory-store fallback is what these tests exercise; a real database
  // URL would send every assertion down the SQL path.
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_AUTH;
  delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
  resetMemoryStore();
});

describe("GET /api/auth/session", () => {
  it("reports demo mode to the client, signed in or not", async () => {
    process.env.DEMO_AUTH = "true";

    const signedIn = await sessionGET(as("owner@spendguard.io", "/api/auth/session"));
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { demoMode: boolean }).demoMode).toBe(true);

    // Anonymous still gets the flag: it is what the sign-in screen labels itself with.
    const anonymous = await sessionGET(as(null, "/api/auth/session"));
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { demoMode: boolean }).demoMode).toBe(true);
  });

  it("reports no demo mode when the identity provider is the only way in", async () => {
    delete process.env.DEMO_AUTH;
    const res = await sessionGET(as("owner@spendguard.io", "/api/auth/session"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { demoMode: boolean }).demoMode).toBe(false);
  });
});

describe("GET /api/accounts", () => {
  it("refuses an anonymous caller", async () => {
    const res = await accountsGET(as(null));
    expect(res.status).toBe(401);
  });

  it("lists only the treasuries the caller belongs to", async () => {
    const foreign = await foreignTreasury();

    const res = await accountsGET(as("viewer@spendguard.io"));
    expect(res.status).toBe(200);
    const listed = (await res.json()) as Array<{ id: string }>;

    expect(listed.map((a) => a.id)).toContain("acc-main-treasury");
    expect(listed.map((a) => a.id)).not.toContain(foreign.id);

    const theirs = await accountsGET(as("someone-else@spendguard.io"));
    expect(((await theirs.json()) as Array<{ id: string }>).map((a) => a.id)).toEqual([
      foreign.id,
    ]);
  });

  it("applies the status, type and search filters to the caller's slice", async () => {
    const res = await accountsGET(as("owner@spendguard.io", "/api/accounts?type=DAO"));
    const listed = (await res.json()) as Array<{ type: string }>;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((a) => a.type === "DAO")).toBe(true);

    const none = await accountsGET(as("owner@spendguard.io", "/api/accounts?type=NGO"));
    expect(((await none.json()) as unknown[]).length).toBe(0);
  });

  it("will not read alerts or events for an address the caller cannot see", async () => {
    const foreign = await foreignTreasury();

    for (const alias of ["alerts", "events"]) {
      const res = await accountsGET(
        as("viewer@spendguard.io", `/api/accounts?address=${foreign.address}&${alias}=true`)
      );
      expect(res.status).toBe(403);
    }

    const anonymous = await accountsGET(
      as(null, `/api/accounts?address=${MAIN_ADDRESS}&alerts=true`)
    );
    expect(anonymous.status).toBe(401);
  });

  it("returns an empty feed rather than invented data when no database is configured", async () => {
    const res = await accountsGET(
      as("owner@spendguard.io", `/api/accounts?address=${MAIN_ADDRESS}&alerts=true`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("feed routes when the configured database is unreachable", () => {
  /**
   * Nothing listens on port 1, so `postgres()` builds a pool that can never
   * connect. That is the outage these routes used to report as `200 []`.
   */
  const DOWN = "postgres://spendguard:correct-horse@127.0.0.1:1/spendguard";

  const feeds: { label: string; run: () => Promise<Response> }[] = [
    {
      label: "the alerts alias",
      run: () =>
        accountsGET(
          as("owner@spendguard.io", `/api/accounts?address=${MAIN_ADDRESS}&alerts=true`)
        ),
    },
    {
      label: "the events alias",
      run: () =>
        accountsGET(
          as("owner@spendguard.io", `/api/accounts?address=${MAIN_ADDRESS}&events=true`)
        ),
    },
    {
      label: "the alerts route",
      run: () => alertsGET(as("owner@spendguard.io", `/api/alerts?address=${MAIN_ADDRESS}`)),
    },
  ];

  it.each(feeds)("$label answers 503, not an empty list, when the query fails", async ({ run }) => {
    process.env.DATABASE_URL = DOWN;
    try {
      const res = await run();
      expect(res.status).toBe(503);
      const body = JSON.stringify(await res.json());
      expect(body).toMatch(/unavailable/i);
      expect(body).not.toMatch(/correct-horse/);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it("keeps authentication and ownership in front of the outage", async () => {
    process.env.DATABASE_URL = DOWN;
    try {
      const foreign = await foreignTreasury();
      const notMine = await accountsGET(
        as("viewer@spendguard.io", `/api/accounts?address=${foreign.address}&alerts=true`)
      );
      expect(notMine.status).toBe(403);

      const anonymous = await alertsGET(as(null, `/api/alerts?address=${MAIN_ADDRESS}`));
      expect(anonymous.status).toBe(401);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it("still answers 200 [] for /api/alerts when no database is configured at all", async () => {
    delete process.env.DATABASE_URL;
    const res = await alertsGET(as("owner@spendguard.io", `/api/alerts?address=${MAIN_ADDRESS}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("POST /api/accounts", () => {
  it("rejects a body missing required fields", async () => {
    const res = await accountsPOST(
      as("owner@spendguard.io", "/api/accounts", jsonInit("POST", { name: "No Address" }))
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/required fields/i);
  });

  it("rejects an unparseable cap instead of half-creating the account", async () => {
    const res = await accountsPOST(
      as(
        "owner@spendguard.io",
        "/api/accounts",
        jsonInit("POST", {
          name: "Bad Cap",
          address: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDWHF",
          ownerEmail: "cap-check@spendguard.io",
          initialCap: "not-a-number",
        })
      )
    );
    expect(res.status).toBe(400);
    expect((await AccountService.listAccounts()).some((a) => a.name === "Bad Cap")).toBe(false);
  });

  it("creates the treasury and immediately lists it for its owner", async () => {
    const res = await accountsPOST(
      as(
        "owner@spendguard.io",
        "/api/accounts",
        jsonInit("POST", {
          name: "New Grant Pool",
          address: "GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEWHF",
          ownerEmail: "grants@spendguard.io",
          type: "NGO",
          initialCap: "50000000000",
        })
      )
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; name: string };
    expect(created.name).toBe("New Grant Pool");

    const mine = await accountsGET(as("grants@spendguard.io"));
    expect(((await mine.json()) as Array<{ id: string }>).map((a) => a.id)).toContain(created.id);
  });
});

describe("/api/webhooks", () => {
  const postBodies: Array<[string, unknown]> = [
    ["missing url", { alertLevels: ["breach"] }],
    ["malformed url", { url: "not-a-url" }],
    ["an invalid alert level", { url: "https://hooks.example.test/x", alertLevels: ["warning"] }],
  ];

  it("refuses anonymous callers on every method", async () => {
    expect((await webhooksGET(as(null, "/api/webhooks"))).status).toBe(401);
    expect(
      (await webhooksPOST(as(null, "/api/webhooks", jsonInit("POST", { url: "https://x.test" }))))
        .status
    ).toBe(401);
    expect((await webhooksDELETE(as(null, "/api/webhooks?id=1"))).status).toBe(401);
  });

  it("keeps global webhook configuration away from non-privileged roles", async () => {
    for (const email of ["viewer@spendguard.io", "finance@spendguard.io", "approver@spendguard.io"]) {
      const get = await webhooksGET(as(email, "/api/webhooks"));
      expect(get.status, email).toBe(403);
      const post = await webhooksPOST(
        as(email, "/api/webhooks", jsonInit("POST", { url: "https://hooks.example.test/x" }))
      );
      expect(post.status, email).toBe(403);
    }
  });

  it.each(postBodies)("rejects %s before touching the database", async (_label, body) => {
    const res = await webhooksPOST(as("owner@spendguard.io", "/api/webhooks", jsonInit("POST", body)));
    expect(res.status).toBe(400);
  });

  const ssrfTargets: Array<[string, RegExp]> = [
    ["http://169.254.169.254/latest/meta-data/", /not a routable public address/],
    ["http://10.0.0.9/hook", /not a routable public address/],
    ["http://[::1]/hook", /not a routable public address/],
    ["http://127.0.0.1:6379/", /Redis/],
    ["https://db.internal:5432/hook", /PostgreSQL/],
    ["https://hooks.example.com:8080/hook", /port 8080 is not allowed/],
    ["http://localhost.localdomain/hook", /special-use hostname/],
    ["file:///etc/passwd", /Unsupported webhook protocol/],
    ["https://admin:hunter2@hooks.example.com/hook", /must not embed credentials/],
  ];

  it.each(ssrfTargets)(
    "refuses the SSRF-shaped destination %s with a reason",
    async (url, reason) => {
      const res = await webhooksPOST(
        as("owner@spendguard.io", "/api/webhooks", jsonInit("POST", { url, secret: "s3cr3t-value" }))
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(reason);
      expect(JSON.stringify(body)).not.toMatch(/s3cr3t-value/);
    },
  );

  it("only relaxes destination rules when the development switch is on", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = "true";

    const res = await webhooksPOST(
      as("owner@spendguard.io", "/api/webhooks", jsonInit("POST", { url: "http://127.0.0.1:3000/hook" }))
    );
    // Accepted as a destination — and then it fails like any other config write
    // with no database behind it, which is the point: the policy did not refuse it.
    expect(res.status).toBe(500);

    const stillRefused = await webhooksPOST(
      as("owner@spendguard.io", "/api/webhooks", jsonInit("POST", { url: "file:///etc/passwd" }))
    );
    expect(stillRefused.status).toBe(400);
  });

  it("requires an id to delete a webhook", async () => {
    const res = await webhooksDELETE(as("owner@spendguard.io", "/api/webhooks"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/id/);
  });

  it("fails closed with a generic 500 when no database backs the config store", async () => {
    const res = await webhooksPOST(
      as(
        "owner@spendguard.io",
        "/api/webhooks",
        jsonInit("POST", { url: "https://hooks.example.test/spendguard", secret: "s3cr3t-value" })
      )
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/s3cr3t-value/);
  });
});
