"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAccount } from "@/context/AccountContext";

interface PolicyItem {
  id: string;
  name: string;
  cap: string;
  windowSeconds: string;
  assetId: string;
  status: "Active" | "Inactive";
  createdAt: string;
}

export function PoliciesTab({ accountId }: { accountId: string }) {
  const { can } = useAccount();
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [cap, setCap] = useState("10000");
  const [windowHours, setWindowHours] = useState("24");
  const [assetId] = useState("USDC");
  const [submitting, setSubmitting] = useState(false);

  const canManage = can("policies:manage");

  const loadPolicies = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/accounts/${accountId}/policies`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      }
    } catch (err) {
      console.error("Failed to load policies:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const handleAddPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !cap) return;
    try {
      setSubmitting(true);
      const capInStroops = (BigInt(cap) * 10_000_000n).toString();
      const seconds = (BigInt(windowHours) * 3600n).toString();

      const res = await fetch(`/api/accounts/${accountId}/policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          cap: capInStroops,
          windowSeconds: seconds,
          assetId,
        }),
      });

      if (res.ok) {
        setName("");
        setShowAddModal(false);
        await loadPolicies();
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to create policy");
      }
    } catch (err) {
      console.error("Failed to create policy:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Spending Limit Policies</h2>
          <p className="text-xs text-zinc-400">
            On-chain OpenZeppelin smart account limit rules bound to this account context.
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
            Add Spending Policy
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-xl bg-zinc-900" />
          <div className="h-20 rounded-xl bg-zinc-900" />
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <p className="text-sm text-zinc-400">No active spending policies configured for this account.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {policies.map((p) => {
            const capAmount = Number(BigInt(p.cap)) / 1e7;
            const hours = Number(BigInt(p.windowSeconds)) / 3600;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-white">{p.name}</span>
                  <span className="rounded-full bg-emerald-950 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800/40">
                    {p.status}
                  </span>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-white">{capAmount.toLocaleString()}</span>
                  <span className="text-xs font-medium text-zinc-400">{p.assetId}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Window: {hours} hours ({p.windowSeconds}s)
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Policy Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Create Spending Policy</h3>
            <form onSubmit={handleAddPolicy} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Policy Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Daily Operations Cap"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Cap Amount (Token units)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Window Duration (Hours)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={windowHours}
                  onChange={(e) => setWindowHours(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
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
                  {submitting ? "Creating..." : "Save Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
