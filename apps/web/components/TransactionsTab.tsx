"use client";

import React, { useEffect, useState } from "react";
import { FeedUnavailableError, throwIfFeedUnavailable } from "@/lib/feed";
import type { SpendAlert } from "@spendguard/sdk";

interface Transaction {
  id: string;
  ledger: number;
  sourceContractId: string;
  amountSpent: string;
  contextRuleId: number;
  reference: string | null;
  timestamp: string;
  flag: "ON-CHAIN" | "BREACH_EVENT" | "NEAR_MISS_EVENT" | null;
}

export function TransactionsTab({ address }: { address: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        // Primary source: live ingested settlement events from the indexer
        const eventsRes = await fetch(
          `/api/accounts?address=${encodeURIComponent(address)}&events=true`,
        );
        await throwIfFeedUnavailable(eventsRes, "Transaction feed");
        if (eventsRes.ok) {
          const events = (await eventsRes.json()) as Transaction[];
          if (events.length > 0) {
            setTransactions(
              events.map((e) => ({ ...e, flag: "ON-CHAIN" as const })),
            );
            setUnavailable(null);
            return;
          }
        }

        // Fallback: alert events (breach / near-miss spend history)
        const res = await fetch(
          `/api/accounts?address=${encodeURIComponent(address)}&alerts=true`,
        );
        await throwIfFeedUnavailable(res, "Transaction feed");
        if (res.ok) {
          const alerts = (await res.json()) as SpendAlert[];
          const txs: Transaction[] = alerts.map((a) => ({
            id: a.id,
            ledger: a.triggerLedger,
            sourceContractId: a.account,
            amountSpent: String(a.eventAmount),
            contextRuleId: a.contextRuleId,
            reference: null,
            flag:
              a.level === "breach"
                ? "BREACH_EVENT"
                : "NEAR_MISS_EVENT",
            timestamp: a.raisedAt,
          }));
          setTransactions(txs);
          setUnavailable(null);
        }
      } catch (err) {
        console.error("Failed to load transactions:", err);
        if (err instanceof FeedUnavailableError) {
          setTransactions([]);
          setUnavailable(err.message);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        <div className="h-10 rounded-lg bg-zinc-900" />
        <div className="h-10 rounded-lg bg-zinc-900" />
        <div className="h-10 rounded-lg bg-zinc-900" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-dashed border-amber-800/60 bg-amber-950/20 px-6 py-8 text-center"
      >
        <p className="text-sm font-semibold text-amber-300">{unavailable}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Settlement events for address {address.slice(0, 8)}... are unknown while the indexer
          database is unreachable — an empty list here means the query failed, not that no
          transfers happened.
        </p>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
        <svg className="h-10 w-10 text-zinc-600 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5m-16.5-7.5h16.5" />
        </svg>
        <h3 className="text-sm font-semibold text-zinc-300">No transactions recorded</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-sm">
          Settlement events ingested by the indexer for address {address.slice(0, 8)}... will appear here in real-time.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-zinc-800 bg-zinc-900 text-zinc-400 font-semibold uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Event ID</th>
            <th className="px-4 py-3">Ledger</th>
            <th className="px-4 py-3">Amount (Stroops)</th>
            <th className="px-4 py-3">Rule ID</th>
            <th className="px-4 py-3">Reference / Flag</th>
            <th className="px-4 py-3">Timestamp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 font-mono text-zinc-300">
          {transactions.map((tx) => (
            <tr key={tx.id} className="hover:bg-zinc-800/40 transition-colors">
              <td className="px-4 py-3 font-semibold text-emerald-400">{tx.id.slice(0, 16)}...</td>
              <td className="px-4 py-3">#{tx.ledger}</td>
              <td className="px-4 py-3 font-bold text-white">{(Number(tx.amountSpent) / 1e7).toFixed(2)} XLM / USDC</td>
              <td className="px-4 py-3">Rule #{tx.contextRuleId}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    tx.flag === "BREACH_EVENT"
                      ? "bg-red-950 text-red-400 border border-red-800/50"
                      : tx.flag === "NEAR_MISS_EVENT"
                        ? "bg-amber-950 text-amber-400 border border-amber-800/50"
                        : "bg-blue-950 text-blue-400 border border-blue-800/50"
                  }`}
                >
                  {tx.flag ?? tx.reference ?? "—"}
                </span>
              </td>
              <td className="px-4 py-3 text-zinc-400 font-sans">{new Date(tx.timestamp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
