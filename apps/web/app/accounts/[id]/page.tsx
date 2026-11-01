"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useAccount } from "@/context/AccountContext";
import { AccountTypeBadge } from "@/components/AccountTypeBadge";
import { TransactionsTab } from "@/components/TransactionsTab";
import { PoliciesTab } from "@/components/PoliciesTab";
import { BudgetsTab } from "@/components/BudgetsTab";
import { MultiSigTab } from "@/components/MultiSigTab";
import { AuditLogsTab } from "@/components/AuditLogsTab";
import { SpendChart } from "@/components/SpendChart";
import { AlertList } from "@/components/AlertList";
import { FeedUnavailableError, throwIfFeedUnavailable } from "@/lib/feed";
import type { TreasuryAccount, SpendAlert } from "@spendguard/sdk";

type TabType = "overview" | "transactions" | "policies" | "budgets" | "multisig" | "audit-logs";

export default function AccountOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { activeAccount, setActiveAccountId } = useAccount();

  const [account, setAccount] = useState<TreasuryAccount | null>(null);
  const [alerts, setAlerts] = useState<SpendAlert[]>([]);
  const [alertsUnavailable, setAlertsUnavailable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch(`/api/accounts/${id}`);
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = (await res.json()) as TreasuryAccount;
        setAccount(data);

        // Fetch alerts. A 503 here means the feed is unreadable — the count
        // cards must show "unknown", not a reassuring zero.
        const alertsRes = await fetch(`/api/accounts?address=${data.address}&alerts=true`);
        await throwIfFeedUnavailable(alertsRes, "Alert feed");
        if (alertsRes.ok) {
          const alertData = (await alertsRes.json()) as SpendAlert[];
          setAlerts(alertData);
          setAlertsUnavailable(null);
        }
      } catch (err) {
        console.error("Failed to load account data:", err);
        if (err instanceof FeedUnavailableError) {
          setAlerts([]);
          setAlertsUnavailable(err.message);
        }
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 w-64 rounded bg-zinc-900" />
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="h-24 rounded-xl bg-zinc-900" />
          <div className="h-24 rounded-xl bg-zinc-900" />
          <div className="h-24 rounded-xl bg-zinc-900" />
          <div className="h-24 rounded-xl bg-zinc-900" />
        </div>
        <div className="h-72 rounded-2xl bg-zinc-900" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-12 text-center">
        <h2 className="text-lg font-bold text-red-400">Account Not Found</h2>
        <p className="mt-1 text-xs text-red-300">The requested treasury account ID could not be found.</p>
        <Link href="/accounts" className="mt-4 inline-block rounded-xl bg-zinc-800 px-4 py-2 text-xs font-semibold text-white">
          Return to Accounts List
        </Link>
      </div>
    );
  }

  const isCurrentActive = activeAccount?.id === account.id;
  const breachCount = alerts.filter((a) => a.level === "breach").length;
  const nearMissCount = alerts.filter((a) => a.level === "near_miss").length;
  const alertsUnknown = alertsUnavailable !== null;

  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "transactions", label: "Transactions" },
    { key: "policies", label: "Spending Policies" },
    { key: "budgets", label: "Budgets" },
    { key: "multisig", label: "Multi-Sig Approvals" },
    { key: "audit-logs", label: "Audit Logs" },
  ];

  return (
    <div className="space-y-8">
      {/* Account Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/accounts"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Accounts
            </Link>
            <span className="text-zinc-700">/</span>
            <AccountTypeBadge type={account.type} />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                account.status === "Active"
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${account.status === "Active" ? "bg-emerald-400" : "bg-zinc-500"}`} />
              {account.status}
            </span>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-white">{account.name}</h1>
          {account.description && <p className="mt-1 text-xs text-zinc-400">{account.description}</p>}
          <p className="mt-2 font-mono text-xs text-emerald-400 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 inline-block">
            {account.address}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveAccountId(account.id)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm ${
              isCurrentActive
                ? "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                : "bg-emerald-600 text-white hover:bg-emerald-500"
            }`}
          >
            {isCurrentActive ? "Active Context" : "Switch Active Context"}
          </button>

          <Link
            href={`/accounts/${account.id}/edit`}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Edit Account
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Alerts</p>
          <p className="mt-1 text-3xl font-extrabold text-white">{alertsUnknown ? "—" : alerts.length}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-400">Breaches</p>
          <p className="mt-1 text-3xl font-extrabold text-red-400">{alertsUnknown ? "—" : breachCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Near Misses</p>
          <p className="mt-1 text-3xl font-extrabold text-amber-400">{alertsUnknown ? "—" : nearMissCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Context Rule</p>
          <p className="mt-1 text-3xl font-extrabold text-emerald-400">#{account.contextRuleId}</p>
        </div>
      </div>

      {alertsUnknown && (
        <p className="text-xs text-amber-300">
          Alert counts are unknown because the indexer database could not be queried. They are
          not zero.
        </p>
      )}

      {/* Tabs Navigation */}
      <div className="flex border-b border-zinc-800 gap-2 overflow-x-auto">        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs font-bold transition-all ${
                isActive
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-sm">
              <h3 className="mb-4 text-sm font-bold text-white">Spend History & Limit Progress</h3>
              <SpendChart address={account.address} />
            </div>

            <div>
              <h3 className="mb-4 text-sm font-bold text-white">Recent Alert Timeline</h3>
              <AlertList alerts={alerts} unavailable={alertsUnavailable} />
            </div>
          </div>
        )}

        {activeTab === "transactions" && <TransactionsTab address={account.address} />}
        {activeTab === "policies" && <PoliciesTab accountId={account.id} />}
        {activeTab === "budgets" && <BudgetsTab accountId={account.id} />}
        {activeTab === "multisig" && <MultiSigTab accountId={account.id} />}
        {activeTab === "audit-logs" && <AuditLogsTab accountId={account.id} />}
      </div>
    </div>
  );
}
