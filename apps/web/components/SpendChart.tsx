"use client";

import { useEffect, useState, useCallback } from "react";
import { FeedUnavailableError, throwIfFeedUnavailable } from "@/lib/feed";

interface SpendDataPoint {
  date: string;
  amount: string;
  ledger?: number;
}

interface SpendChartProps {
  address: string;
  /** Auto-refresh interval in ms. Default 30 000 (30 s). */
  refreshMs?: number;
}

const STROOPS_PER_TOKEN = 10_000_000n;

/**
 * Load live spend history for an address.
 *
 * Primary source: ingested on-chain settlement events (the indexer's
 * Postgres event store) — every real transfer shows up here. Falls back
 * to raised alerts so the chart still renders spend history when the
 * event store returns nothing.
 *
 * A 503 from either feed means the indexer database could not be queried.
 * That is rethrown rather than answered with an empty array: a chart full
 * of bars and a chart that has never seen a transfer are different facts,
 * and the dashboard must not confuse an outage with a quiet treasury.
 */
async function fetchSpendPoints(address: string): Promise<SpendDataPoint[]> {
  const feedUrl = (query: string) =>
    `/api/accounts?address=${encodeURIComponent(address)}&${query}`;

  // Primary source: ingested on-chain settlement events. A thrown fetch or
  // an HTTP error (other than 503) both fall through to the alerts fallback.
  try {
    const res = await fetch(feedUrl("events=true"), { cache: "no-store" });
    await throwIfFeedUnavailable(res, "Spend feed");
    if (res.ok) {
      const events = (await res.json()) as {
        timestamp: string;
        amountSpent: string;
        ledger: number;
      }[];
      if (events.length > 0) {
        return events.map((e) => ({
          date: new Date(e.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          amount: (BigInt(e.amountSpent) / STROOPS_PER_TOKEN).toString(),
          ledger: e.ledger,
        }));
      }
    }
  } catch (err) {
    if (err instanceof FeedUnavailableError) throw err;
    // fall through to the alerts fallback
  }

  // Fallback: alert events (breach / near-miss spend history)
  try {
    const alertsRes = await fetch(feedUrl("alerts=true"), { cache: "no-store" });
    await throwIfFeedUnavailable(alertsRes, "Spend feed");
    if (alertsRes.ok) {
      const alerts = (await alertsRes.json()) as {
        raisedAt: string;
        eventAmount: string;
      }[];
      return alerts.map((a) => ({
        date: new Date(a.raisedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        amount: (BigInt(a.eventAmount) / STROOPS_PER_TOKEN).toString(),
      }));
    }
  } catch (err) {
    if (err instanceof FeedUnavailableError) throw err;
    // ignore — the chart renders its empty state
  }

  return [];
}

export function SpendChart({ address, refreshMs = 30_000 }: SpendChartProps) {
  const [data, setData] = useState<SpendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedDown, setFeedDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const points = await fetchSpendPoints(address);
      setData(points);
      setLastUpdated(new Date());
      setFeedDown(false);
      setError(null);
    } catch (err) {
      setFeedDown(err instanceof FeedUnavailableError);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, refreshMs);
    return () => clearInterval(id);
  }, [loadData, refreshMs]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 h-5 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="h-48 animate-pulse rounded bg-zinc-800" />
      </div>
    );
  }

  if (feedDown) {
    return (
      <div role="alert" className="rounded-xl border border-dashed border-amber-800/60 bg-amber-950/20 p-6">
        <p className="text-sm font-semibold text-amber-300">Spend history unavailable</p>
        <p className="mt-1 text-xs text-zinc-500">
          The indexer database could not be queried, so this account&apos;s spending is
          unknown — not zero. The chart will resume on the next refresh.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <p className="text-sm text-red-400">Failed to load spend data: {error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">
            Spend History (XLM / USDC)
          </h3>
        </div>
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-zinc-600">
            No spend events recorded yet for this account. Transfers the
            indexer ingests from testnet will appear here in real time.
          </p>
        </div>
      </div>
    );
  }

  // Simple bar chart using divs
  const maxAmount = Math.max(
    ...data.map((d) => Number.parseFloat(d.amount)),
    1,
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-400">
          Spend History (XLM / USDC)
        </h3>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            LIVE
          </span>
          {lastUpdated && (
            <span className="text-[10px] text-zinc-600">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      <div className="flex h-48 items-end gap-2">
        {data.map((point, i) => {
          const height = (Number.parseFloat(point.amount) / maxAmount) * 100;
          return (
            <div
              key={`${point.date}-${i}`}
              className="group relative flex flex-1 flex-col items-center"
            >
              <div
                className="w-full rounded-t bg-emerald-500/60 transition-all hover:bg-emerald-400/80"
                style={{ height: `${Math.max(height, 4)}%` }}
              >
                <div className="invisible absolute bottom-full mb-2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 shadow-lg group-hover:visible">
                  {point.amount} XLM/USDC — {point.date}
                  {point.ledger ? ` · ledger #${point.ledger}` : ""}
                </div>
              </div>
              <span className="mt-1 text-[10px] text-zinc-600">{point.date}</span>
            </div>
          );
        })}
      </div>
      {lastUpdated && (
        <p className="mt-3 text-[10px] text-zinc-700">
          {data.length} live on-chain event{data.length === 1 ? "" : "s"} · updated{" "}
          {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
