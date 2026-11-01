import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PolicyReaderError,
  type SpendingLimitState,
} from "@spendguard/sdk";
import { createSessionToken, SESSION_COOKIE_NAME } from "../lib/auth/session";
import { AccountService, resetMemoryStore } from "../lib/services/account-service";
import { GET } from "../app/api/stellar/account/route";

const getSpendingLimitState = vi.fn();

vi.mock("@spendguard/sdk", async () => {
  const actual = await vi.importActual<typeof import("@spendguard/sdk")>(
    "@spendguard/sdk",
  );
  return {
    ...actual,
    SorobanClient: vi.fn().mockImplementation(() => ({
      getLatestLedger: vi.fn().mockResolvedValue(52_000_100),
    })),
    PolicyReader: vi.fn().mockImplementation(() => ({
      getSpendingLimitState,
    })),
  };
});

const OWNER = "owner@spendguard.io";
const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function request(): Request {
  return new Request(
    `https://spendguard.test/api/stellar/account?address=${ADDRESS}&ruleId=1`,
    {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(OWNER))}`,
      },
    },
  );
}

function liveState(over: Partial<SpendingLimitState> = {}): SpendingLimitState {
  return {
    account: ADDRESS,
    contextRuleId: 1,
    cap: 10_000_000_000n,
    spentInWindow: 9_000_000_000n,
    windowLedgers: 17_280,
    windowStartedLedger: 52_000_000,
    utilizationPct: 90,
    ...over,
  };
}

/**
 * The error a failed simulation produces, as the SDK classifies it. The
 * variant numbers are the wire format; `packages/sdk/test/xdr-helpers.test.ts`
 * pins them against `POLICY_VIEW_ERROR`.
 */
function contractError(variant: number): PolicyReaderError {
  return new PolicyReaderError(
    `Contract error from get_spending_limit_state: HostError: Error(Contract, #${variant})`,
    "CONTRACT_ERROR",
    undefined,
    variant,
  );
}

type Body = {
  spendingLimitState: {
    cap: string;
    spentInWindow: string;
    utilizationPct: number;
    windowLedgers: number;
    windowStartedLedger: number;
    windowSecondsEstimate: number;
    windowStartedAtEstimate: number | null;
  } | null;
  policyReadError: string | null;
  policyAmbiguous: string | null;
};

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_AUTH;
  vi.stubEnv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
  vi.stubEnv("NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
  vi.stubEnv("POLICY_VIEW_HELPER_CONTRACT_ID", "CCAM4NRAUB6SO3XLL2SRZQEHSOUYQGDKGNPCUIQ5KKI2S6QKWC2VN6NX");
  vi.stubEnv("SIMULATION_SOURCE_ACCOUNT", ADDRESS);
  resetMemoryStore();
  await AccountService.createAccount({
    name: "Treasury",
    address: ADDRESS,
    type: "DAO",
    ownerEmail: OWNER,
    ownerName: "Owner",
  });
  getSpendingLimitState.mockReset();
  // The route also probes Horizon for the XLM balance; tests stay offline.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

describe("GET /api/stellar/account", () => {
  it("passes the contract's ledger fields through and labels the derived ones", async () => {
    getSpendingLimitState.mockResolvedValue(liveState());

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.spendingLimitState).toMatchObject({
      windowLedgers: 17_280,
      windowStartedLedger: 52_000_000,
      windowSecondsEstimate: 86_400,
    });
    // 100 ledgers behind the latest, at the 5 s estimate.
    expect(body.spendingLimitState!.windowStartedAtEstimate).toBeGreaterThan(0);
    expect(body.policyReadError).toBeNull();
  });

  it("reports no estimate for an empty window instead of inventing a date", async () => {
    getSpendingLimitState.mockResolvedValue(liveState({ windowStartedLedger: 0 }));

    const body = (await (await GET(request())).json()) as Body;
    expect(body.spendingLimitState!.windowStartedAtEstimate).toBeNull();
  });

  // A contract error whose variant means "nothing to show". This is the only
  // path allowed to render an empty card.
  it("treats the absence variants as absence, not as a failure", async () => {
    // #1 no spending_limit policy, #2 the address carries no such rule,
    // #3 the rule's context cannot hold a limit — all three really are empty.
    for (const variant of [1, 2, 3]) {
      getSpendingLimitState.mockRejectedValue(contractError(variant));

      const body = (await (await GET(request())).json()) as Body;
      expect(body.spendingLimitState).toBeNull();
      expect(body.policyReadError).toBeNull();
      expect(body.policyAmbiguous).toBeNull();
    }
  });

  // Helper v2 answers #4 when a rule carries two limits. That is not an empty
  // account, and picking one of the two would put a guessed number on the
  // dashboard — the mistake this branch exists to prevent.
  it("reports #4 as ambiguity, never as an empty card", async () => {
    getSpendingLimitState.mockRejectedValue(contractError(4));

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.spendingLimitState).toBeNull();
    expect(body.policyReadError).toBeNull();
    expect(body.policyAmbiguous).toMatch(/more than one spending limit/i);
  });

  // A variant this build has never seen is treated the same way: the honest
  // answer is "I do not know", not "there is nothing".
  it("reports an unrecognised variant as ambiguity too", async () => {
    getSpendingLimitState.mockRejectedValue(contractError(7));

    const body = (await (await GET(request())).json()) as Body;
    expect(body.spendingLimitState).toBeNull();
    expect(body.policyAmbiguous).toMatch(/does not recognise/);
  });

  // The helper cross-calls into the address it is given, so passing a plain
  // `G…` account fails in the host before the contract can answer. That is a
  // wiring bug, not an empty policy, and must not render as one.
  it("surfaces a host error instead of treating it as no policy", async () => {
    getSpendingLimitState.mockRejectedValue(
      new PolicyReaderError(
        "Host error from get_spending_limit_state: HostError: Error(Object, InvalidInput)",
        "HOST_ERROR",
      ),
    );

    const body = (await (await GET(request())).json()) as Body;
    expect(body.spendingLimitState).toBeNull();
    expect(body.policyReadError).toMatch(/Error\(Object, InvalidInput\)/);
  });

  // Previously every throw took this branch, so a decoder/shape mismatch — the
  // bug that made every live read fail — looked identical to "no policy".
  it("surfaces a read failure instead of rendering it as no policy", async () => {
    getSpendingLimitState.mockRejectedValue(
      new PolicyReaderError(
        "Failed to decode SpendingLimitView from ScVal",
        "DECODE_ERROR",
      ),
    );

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.spendingLimitState).toBeNull();
    expect(body.policyReadError).toMatch(/Failed to decode SpendingLimitView/);
  });

  it("treats an unreachable RPC as a read failure too", async () => {
    getSpendingLimitState.mockRejectedValue(
      new PolicyReaderError("RPC simulation failed for get_spending_limit_state", "RPC_FAILURE"),
    );

    const body = (await (await GET(request())).json()) as Body;
    expect(body.policyReadError).toMatch(/RPC simulation failed/);
  });
});
