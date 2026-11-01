"use client";

import { useEffect, useState, useCallback } from "react";

interface SpendingLimitState {
  cap: string;
  spentInWindow: string;
  utilizationPct: number;
  windowLedgers: number;
  windowStartedLedger: number;
  windowSecondsEstimate: number;
  windowStartedAtEstimate: number | null;
}

interface LiveAccountData {
  address: string;
  contextRuleId: number;
  latestLedger: number;
  network: string;
  xlmBalance: string | null;
  spendingLimitState: SpendingLimitState | null;
  /** Set when the contract could not be read; distinct from "no policy". */
  policyReadError: string | null;
  fetchedAt: string;
}

interface LiveSpendingCardProps {
  address: string;
  contextRuleId?: number;
  /** Auto-refresh interval in ms. Default 30 000 (30 s). */
  refreshMs?: number;
}

function formatStroops(stroops: string): string {
  const n = Number(BigInt(stroops)) / 1e7;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function LiveSpendingCard({
  address,
  contextRuleId = 1,
  refreshMs = 30_000,
}: LiveSpendingCardProps) {
  const [data, setData] = useState<LiveAccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/stellar/account?address=${encodeURIComponent(address)}&ruleId=${contextRuleId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to fetch live data");
      }
      const json = (await res.json()) as LiveAccountData;
      setData(json);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [address, contextRuleId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, refreshMs);
    return () => clearInterval(id);
  }, [fetchData, refreshMs]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm animate-pulse">
        <div className="h-4 w-24 rounded bg-zinc-800 mb-3" />
        <div className="h-8 w-32 rounded bg-zinc-800 mb-2" />
        <div className="h-3 w-full rounded bg-zinc-800 mt-4" />
      </div>
    );
  }

  const pct = data?.spendingLimitState?.utilizationPct ?? null;

  // Colour the utilisation bar
  const barColour =
    pct === null
      ? "bg-zinc-700"
      : pct >= 90
        ? "bg-red-500"
        : pct >= 70
          ? "bg-amber-400"
          : "bg-emerald-500";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          Live Spending Limit
        </p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full border border-emerald-700/60 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            TESTNET LIVE
          </span>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            title="Refresh"
            className="rounded-md p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-xs text-red-400 mt-1">{error}</div>
      ) : data?.policyReadError ? (
        <div className="mt-2">
          <p className="text-2xl font-extrabold text-amber-400">!</p>
          <p className="text-[11px] text-zinc-400 mt-1">
            Live limit unavailable — the policy read failed, so the figures
            below are not zero, they are unknown.
          </p>
          <p className="text-[10px] text-red-400/80 mt-1 font-mono break-all">
            {data.policyReadError}
          </p>
          {data.latestLedger && (
            <p className="text-[10px] text-zinc-700 mt-1 font-mono">
              Latest ledger: #{data.latestLedger.toLocaleString()}
            </p>
          )}
        </div>
      ) : data?.spendingLimitState ? (
        <>
          {/* Utilisation percentage */}
          <p className="mt-1 text-3xl font-extrabold text-white">
            {pct}
            <span className="text-base font-semibold text-zinc-400">%</span>
          </p>

          {/* Bar */}
          <div className="mt-3 h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColour}`}
              style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
            />
          </div>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
            <div>
              <span className="block text-zinc-600 uppercase tracking-wide text-[10px]">Spent</span>
              <span className="font-mono font-semibold text-white">
                {formatStroops(data.spendingLimitState.spentInWindow)} XLM
              </span>
            </div>
            <div>
              <span className="block text-zinc-600 uppercase tracking-wide text-[10px]">Cap</span>
              <span className="font-mono font-semibold text-white">
                {formatStroops(data.spendingLimitState.cap)} XLM
              </span>
            </div>
            <div>
              <span className="block text-zinc-600 uppercase tracking-wide text-[10px]">Window</span>
              <span
                className="font-mono text-zinc-300"
                title="Estimated from ledger count at ~5 s per close; the contract reports ledgers, not time."
              >
                ~{(data.spendingLimitState.windowSecondsEstimate / 3600).toFixed(0)}h
              </span>
              <span className="block text-[10px] text-zinc-600 font-mono">
                {data.spendingLimitState.windowLedgers.toLocaleString()} ledgers
                {data.spendingLimitState.windowStartedLedger > 0
                  ? ` · opened #${data.spendingLimitState.windowStartedLedger.toLocaleString()}`
                  : " · no spend yet"}
              </span>
            </div>
            <div>
              <span className="block text-zinc-600 uppercase tracking-wide text-[10px]">Ledger</span>
              <span className="font-mono text-zinc-300">#{data.latestLedger.toLocaleString()}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-2">
          <p className="text-2xl font-extrabold text-zinc-500">—</p>
          <p className="text-[11px] text-zinc-600 mt-1">
            No on-chain policy registered for this account on testnet.
          </p>
          {data?.latestLedger && (
            <p className="text-[10px] text-zinc-700 mt-1 font-mono">
              Latest ledger: #{data.latestLedger.toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* XLM balance */}
      {data?.xlmBalance && (
        <div className="mt-3 border-t border-zinc-800/60 pt-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-zinc-600">XLM Balance</span>
          <span className="font-mono text-xs font-semibold text-zinc-300">
            {Number(data.xlmBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })} XLM
          </span>
        </div>
      )}

      {/* Last refreshed */}
      {lastRefreshed && (
        <p className="mt-2 text-[10px] text-zinc-700">
          Updated {lastRefreshed.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
