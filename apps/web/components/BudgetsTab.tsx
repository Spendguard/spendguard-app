"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAccount } from "@/context/AccountContext";

interface BudgetItem {
  id: string;
  name: string;
  category: string;
  allocatedAmount: string;
  spentAmount: string;
  period: "Monthly" | "Quarterly" | "Annual";
  status: "Active" | "Exceeded" | "Closed";
  createdAt: string;
}

export function BudgetsTab({ accountId }: { accountId: string }) {
  const { can } = useAccount();
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Operations");
  const [allocated, setAllocated] = useState("5000");
  const [period, setPeriod] = useState<"Monthly" | "Quarterly" | "Annual">("Monthly");
  const [submitting, setSubmitting] = useState(false);

  const canManage = can("budgets:manage");

  const loadBudgets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/accounts/${accountId}/budgets`);
      if (res.ok) {
        const data = await res.json();
        setBudgets(data);
      }
    } catch (err) {
      console.error("Failed to load budgets:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const handleAddBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !allocated) return;
    try {
      setSubmitting(true);
      const allocatedStroops = (BigInt(allocated) * 10_000_000n).toString();

      const res = await fetch(`/api/accounts/${accountId}/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          allocatedAmount: allocatedStroops,
          period,
        }),
      });

      if (res.ok) {
        setName("");
        setShowAddModal(false);
        await loadBudgets();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to create budget");
      }
    } catch (err) {
      console.error("Failed to create budget:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Account Budgets</h2>
          <p className="text-xs text-zinc-400">
            Isolated financial allocations and period tracking for this treasury account.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Budget Allocation
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-xl bg-zinc-900" />
          <div className="h-24 rounded-xl bg-zinc-900" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <p className="text-sm text-zinc-400">No budgets created yet for this treasury account.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {budgets.map((b) => {
            const alloc = Number(BigInt(b.allocatedAmount)) / 1e7;
            const spent = Number(BigInt(b.spentAmount)) / 1e7;
            const pct = Math.min(100, Math.round((spent / (alloc || 1)) * 100));

            return (
              <div
                key={b.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm text-white">{b.name}</span>
                    <span className="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 font-medium">
                      {b.category}
                    </span>
                  </div>
                  <span className="rounded-full bg-emerald-950 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800/40">
                    {b.period}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline justify-between">
                  <div className="text-xs text-zinc-400">
                    Spent: <span className="font-bold text-white">{spent.toLocaleString()} XLM</span>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Allocated: <span className="font-bold text-zinc-200">{alloc.toLocaleString()} XLM</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2.5 h-2.5 w-full rounded-full bg-zinc-950 p-0.5 border border-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-2 flex justify-between text-[11px] text-zinc-500 font-medium">
                  <span>{pct}% Used</span>
                  <span>{(alloc - spent).toLocaleString()} XLM Remaining</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Budget Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Create Budget Allocation</h3>
            <form onSubmit={handleAddBudget} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Budget Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 Security Audits"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="Operations">Operations</option>
                  <option value="Security">Security</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Grants">Grants</option>
                  <option value="Infrastructure">Infrastructure</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Allocated Amount (XLM/USDC)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={allocated}
                  onChange={(e) => setAllocated(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Period</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as "Monthly" | "Quarterly" | "Annual")}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annual">Annual</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
