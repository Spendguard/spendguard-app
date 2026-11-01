"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/context/AccountContext";
import { AccountTypeBadge } from "@/components/AccountTypeBadge";
import { SpendChart } from "@/components/SpendChart";
import { AlertList } from "@/components/AlertList";
import { LiveSpendingCard } from "@/components/LiveSpendingCard";
import { FeedUnavailableError, throwIfFeedUnavailable } from "@/lib/feed";
import type { SpendAlert } from "@spendguard/sdk";

export default function DashboardPage() {
  const { accounts, activeAccount, setActiveAccountId, loading } = useAccount();
  const [alerts, setAlerts] = useState<SpendAlert[]>([]);
  const [alertsUnavailable, setAlertsUnavailable] = useState<string | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);

  useEffect(() => {
    async function loadAlerts() {
      if (!activeAccount) return;
      try {
        setAlertsLoading(true);
        const res = await fetch(`/api/accounts?address=${activeAccount.address}&alerts=true`);
        await throwIfFeedUnavailable(res, "Alert feed");
        if (res.ok) {
          const data = (await res.json()) as SpendAlert[];
          setAlerts(data);
          setAlertsUnavailable(null);
        }
      } catch (err) {
        console.error("Failed to load alerts:", err);
        if (err instanceof FeedUnavailableError) {
          setAlerts([]);
          setAlertsUnavailable(err.message);
        }
      } finally {
        setAlertsLoading(false);
      }
    }
    loadAlerts();
  }, [activeAccount]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 w-64 rounded bg-zinc-900" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-28 rounded-2xl bg-zinc-900" />
          <div className="h-28 rounded-2xl bg-zinc-900" />
          <div className="h-28 rounded-2xl bg-zinc-900" />
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-16 text-center backdrop-blur-md">
        <div className="mb-4 rounded-full bg-emerald-950/60 p-4 border border-emerald-800/40">
          <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">No Treasury Accounts Configured</h2>
        <p className="mt-1 max-w-sm text-xs text-zinc-400 mb-6">
          Create your first multi-account treasury to start observing real-time on-chain spending limit breaches, budgets, and multi-sig requests.
        </p>
        <Link
          href="/accounts/new"
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md"
        >
          Create Treasury Account
        </Link>
      </div>
    );
  }

  const breachCount = alerts.filter((a) => a.level === "breach").length;
  const nearMissCount = alerts.filter((a) => a.level === "near_miss").length;
  // While the alert feed is unreadable these counts are unknown, not zero.
  const alertsUnknown = alertsUnavailable !== null;

  return (
    <div className="space-y-8">
      {/* Dashboard Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Active Treasury</span>
            {activeAccount && <AccountTypeBadge type={activeAccount.type} />}
            <span className="flex items-center gap-1 rounded-full border border-blue-700/50 bg-blue-950/40 px-2 py-0.5 text-[10px] font-bold text-blue-400">
              <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
              </svg>
              STELLAR TESTNET
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            {activeAccount ? activeAccount.name : "Dashboard"}
          </h1>
          {activeAccount && (
            <p className="mt-1 font-mono text-xs text-zinc-400">{activeAccount.address}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/accounts/new"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Account
          </Link>

          {activeAccount && (
            <Link
              href={`/accounts/${activeAccount.id}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Full Account Details
            </Link>
          )}
        </div>
      </div>

      {/* KPI Cards for Active Account */}
      <div className="grid gap-4 sm:grid-cols-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Ingested Alerts</p>
          <p className="mt-1 text-3xl font-extrabold text-white">{alertsUnknown ? "—" : alerts.length}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-400">Policy Breaches</p>
          <p className="mt-1 text-3xl font-extrabold text-red-400">{alertsUnknown ? "—" : breachCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Near Misses</p>
          <p className="mt-1 text-3xl font-extrabold text-amber-400">{alertsUnknown ? "—" : nearMissCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Total Accounts</p>
          <p className="mt-1 text-3xl font-extrabold text-emerald-400">{accounts.length}</p>
        </div>
        {/* Live on-chain spending limit from Soroban testnet */}
        {activeAccount && (
          <LiveSpendingCard
            address={activeAccount.address}
            contextRuleId={activeAccount.contextRuleId}
            refreshMs={30_000}
          />
        )}
      </div>

      {/* Active Account Spend History */}
      {activeAccount && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-sm">
          <h2 className="mb-4 text-sm font-bold text-white">Active Account Spend & Limit Timeline</h2>
          <SpendChart address={activeAccount.address} />
        </div>
      )}

      {/* Account Quick Switcher Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">All Monitored Treasuries</h2>
          <Link href="/accounts" className="text-xs font-semibold text-emerald-400 hover:underline">
            View All ({accounts.length}) &rarr;
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {accounts.map((acc) => {
            const isSelected = activeAccount?.id === acc.id;

            return (
              <div
                key={acc.id}
                onClick={() => setActiveAccountId(acc.id)}
                className={`cursor-pointer rounded-2xl border p-5 transition-all ${
                  isSelected
                    ? "border-emerald-500/60 bg-gradient-to-b from-emerald-950/20 to-zinc-900 shadow-md shadow-emerald-950/20"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <AccountTypeBadge type={acc.type} />
                  {isSelected && (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold text-zinc-950">
                      ACTIVE
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-white truncate">{acc.name}</h3>
                <p className="mt-1 font-mono text-[11px] text-zinc-500 truncate">{acc.address}</p>

                <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
                  <span className="text-[11px] text-zinc-400">Rule #{acc.contextRuleId}</span>
                  <Link
                    href={`/accounts/${acc.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-semibold text-emerald-400 hover:underline"
                  >
                    View Isolated Data &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alert Timeline */}
      {activeAccount && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Alert Timeline for {activeAccount.name}</h2>
          {alertsLoading ? (
            <div className="animate-pulse h-32 rounded-2xl bg-zinc-900" />
          ) : (
            <AlertList alerts={alerts} unavailable={alertsUnavailable} />
          )}
        </div>
      )}
    </div>
  );
}
