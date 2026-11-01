/**
 * API route: live on-chain spending limit state for an account.
 *
 * GET /api/stellar/account?address=G...&ruleId=N
 *
 * Queries the deployed policy-view-helper contract on Stellar testnet via
 * Soroban RPC. Returns the live spending limit utilisation for the account.
 *
 * `spendingLimitState` carries the contract's ledger-native window fields
 * (`windowLedgers`, `windowStartedLedger`) plus `*Estimate` values derived at
 * 5 s/ledger — labelled as estimates because the contract has no clock and the
 * RPC publishes no close time for historical ledgers.
 *
 * `spendingLimitState: null` with `policyReadError: null` means the contract
 * answered and there is nothing to show. A non-null `policyReadError` means the
 * read itself failed (RPC down, restore required, shape mismatch) — the two are
 * never collapsed into each other.
 *
 * `policyAmbiguous` is a third state: the helper answered that it will not
 * return a single number (`MultipleSpendingLimitPolicies`, or a variant this
 * build does not know). Nothing is shown for the same reason nothing is guessed.
 *
 * Also fetches the native XLM balance from the Horizon-compatible endpoint
 * baked into the stellar-sdk Server.
 *
 * All reads are read-only simulations — no transactions are signed or
 * submitted.
 */

import { NextResponse } from "next/server";
import {
  SorobanClient,
  PolicyReader,
  PolicyReaderError,
  isSpendingLimitAbsence,
  POLICY_VIEW_ERROR,
  estimateWindowSeconds,
  estimateLedgerCloseTime,
} from "@spendguard/sdk";
import { resolveIdentity, canReadAddress } from "@/lib/auth/session";

// ── Helpers ───────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ── GET ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await resolveIdentity(request);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");
    const ruleId = Number(searchParams.get("ruleId") ?? "1");

    if (!address) {
      return NextResponse.json(
        { error: "Missing required query param: address" },
        { status: 400 },
      );
    }

    // Without this gate the route is an unauthenticated proxy onto the
    // deployment's Soroban RPC endpoint for any address a caller picks.
    if (!(await canReadAddress(auth.session.email, address))) {
      return NextResponse.json({ error: "Not a member of this account" }, { status: 403 });
    }

    const rpcUrl = requireEnv("SOROBAN_RPC_URL");
    const networkPassphrase = requireEnv("NETWORK_PASSPHRASE");
    const policyContractId = requireEnv("POLICY_VIEW_HELPER_CONTRACT_ID");
    const simulationSource = requireEnv("SIMULATION_SOURCE_ACCOUNT");

    const client = new SorobanClient({ rpcUrl, networkPassphrase });
    const reader = new PolicyReader(client, policyContractId, simulationSource);

    // Fetch latest ledger (always succeeds if RPC is up)
    const latestLedger = await client.getLatestLedger();

    // Try to read spending limit state from the on-chain contract
    let spendingLimitState: {
      cap: string;
      spentInWindow: string;
      utilizationPct: number;
      windowLedgers: number;
      windowStartedLedger: number;
      /** Display estimate — see `@spendguard/sdk` ledger-window. */
      windowSecondsEstimate: number;
      /** Unix seconds, or null when the window has no history (ledger 0). */
      windowStartedAtEstimate: number | null;
    } | null = null;

    // A read that failed for a reason other than "this account has no
    // spending limit" must not be reported as absence — the card would show
    // an empty state for what is actually an outage or a decode mismatch.
    let policyReadError: string | null = null;

    // `Error(Contract, #4)` is neither. The helper refused to choose between
    // several limits, which is a statement about the account, not about the
    // reader. Picking one silently would put a made-up number on a treasury
    // dashboard, so ambiguity gets its own field and its own card state.
    let policyAmbiguous: string | null = null;

    try {
      const state = await reader.getSpendingLimitState(address, ruleId);
      spendingLimitState = {
        cap: state.cap.toString(),
        spentInWindow: state.spentInWindow.toString(),
        utilizationPct: state.utilizationPct,
        windowLedgers: state.windowLedgers,
        windowStartedLedger: state.windowStartedLedger,
        windowSecondsEstimate: estimateWindowSeconds(state.windowLedgers),
        windowStartedAtEstimate: estimateLedgerCloseTime(state.windowStartedLedger, {
          ledger: latestLedger,
          closedAtSeconds: Math.floor(Date.now() / 1000),
        }),
      };
    } catch (err) {
      if (err instanceof PolicyReaderError && err.code === "CONTRACT_ERROR") {
        if (isSpendingLimitAbsence(err.contractErrorCode)) {
          // The helper answered that there is nothing to show: no policy on
          // this rule, the address is not a smart account carrying this rule,
          // or the rule's context cannot carry a spending limit. A `HOST_ERROR`
          // — the call never ran, e.g. `Error(Object, InvalidInput)` for a
          // plain `G…` address — falls through to the failure branch instead.
          console.info(
            `No live spending limit for ${address} rule ${ruleId}:`,
            err.message,
          );
        } else {
          policyAmbiguous =
            err.contractErrorCode ===
            POLICY_VIEW_ERROR.MultipleSpendingLimitPolicies
              ? "This context rule carries more than one spending limit, and the helper refuses to pick one. Showing a single utilisation would be a guess, so none is shown."
              : `The helper answered with PolicyViewError #${err.contractErrorCode ?? "?"}, which this build does not recognise. Nothing is shown rather than something guessed.`;
          console.warn(
            `Ambiguous live spending limit for ${address} rule ${ruleId}:`,
            err.message,
          );
        }
      } else {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`Live policy read failed for ${address} rule ${ruleId}:`, reason);
        policyReadError = reason;
      }
    }

    // Try to fetch native XLM balance from Horizon. The Soroban RPC host
    // (soroban-testnet.stellar.org) does not serve a Horizon companion
    // endpoint, so rpc.Server#getAccount fails there — Horizon lives on
    // its own host (override with HORIZON_URL).
    let xlmBalance: string | null = null;
    try {
      const horizonUrl =
        process.env.HORIZON_URL?.trim() || "https://horizon-testnet.stellar.org";
      const res = await fetch(`${horizonUrl}/accounts/${address}`);
      if (res.ok) {
        const json = (await res.json()) as {
          balances?: { asset_type: string; balance: string }[];
        };
        const native = json.balances?.find((b) => b.asset_type === "native");
        if (native) xlmBalance = native.balance;
      }
    } catch {
      // Address may not be funded on testnet
    }

    return NextResponse.json({
      address,
      contextRuleId: ruleId,
      latestLedger,
      network: "testnet",
      rpcUrl,
      xlmBalance,
      spendingLimitState,
      policyReadError,
      policyAmbiguous,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/stellar/account error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
