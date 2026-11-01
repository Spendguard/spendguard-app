/**
 * API route: live on-chain spending limit state for an account.
 *
 * GET /api/stellar/account?address=G...&ruleId=N
 *
 * Queries the deployed policy-view-helper contract on Stellar testnet via
 * Soroban RPC. Returns the live spending limit utilisation for the account.
 *
 * Also fetches the native XLM balance from the Horizon-compatible endpoint
 * baked into the stellar-sdk Server.
 *
 * All reads are read-only simulations — no transactions are signed or
 * submitted.
 */

import { NextResponse } from "next/server";
import { SorobanClient, PolicyReader } from "@spendguard/sdk";
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
      windowSeconds: string;
      spentInWindow: string;
      windowStartedAt: string;
      utilizationPct: number;
    } | null = null;

    try {
      const state = await reader.getSpendingLimitState(address, ruleId);
      spendingLimitState = {
        cap: state.cap.toString(),
        windowSeconds: state.windowSeconds.toString(),
        spentInWindow: state.spentInWindow.toString(),
        windowStartedAt: state.windowStartedAt.toString(),
        utilizationPct: state.utilizationPct,
      };
    } catch (err) {
      // Account may not have a policy registered on-chain — not an error
      console.info(
        `No on-chain policy for ${address} rule ${ruleId}:`,
        err instanceof Error ? err.message : String(err),
      );
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
