"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAccount } from "@/context/AccountContext";

interface MultiSigApproval {
  id: string;
  approverEmail: string;
  decision: "Approved" | "Rejected";
  note: string | null;
  timestamp: string;
}

interface ProposalItem {
  id: string;
  title: string;
  description: string;
  amount: string;
  recipient: string;
  requiredApprovals: number;
  status: "Pending" | "Approved" | "Rejected";
  createdBy: string;
  createdAt: string;
  approvals: MultiSigApproval[];
}

export function MultiSigTab({ accountId }: { accountId: string }) {
  const { can } = useAccount();
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Proposal Creation Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("2500");
  const [recipient, setRecipient] = useState("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  const [requiredApprovals, setRequiredApprovals] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  // Approval Modal
  const [selectedProposal, setSelectedProposal] = useState<ProposalItem | null>(null);
  const [decision, setDecision] = useState<"Approved" | "Rejected">("Approved");
  const [note, setNote] = useState("");
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const canCreate = can("multisig:create");
  const canApprove = can("multisig:approve");

  const loadProposals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/accounts/${accountId}/multisig`);
      if (res.ok) {
        const data = await res.json();
        setProposals(data);
      }
    } catch (err) {
      console.error("Failed to load multi-sig proposals:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !amount || !recipient) return;
    try {
      setSubmitting(true);
      const amountStroops = (BigInt(amount) * 10_000_000n).toString();

      const res = await fetch(`/api/accounts/${accountId}/multisig`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          amount: amountStroops,
          recipient,
          requiredApprovals,
        }),
      });

      if (res.ok) {
        setTitle("");
        setDescription("");
        setShowAddModal(false);
        await loadProposals();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to create proposal");
      }
    } catch (err) {
      console.error("Failed to create proposal:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    try {
      setSubmittingDecision(true);
      const res = await fetch(`/api/accounts/${accountId}/multisig`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: selectedProposal.id,
          decision,
          note,
        }),
      });

      if (res.ok) {
        setSelectedProposal(null);
        setNote("");
        await loadProposals();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to submit decision");
      }
    } catch (err) {
      console.error("Failed to submit decision:", err);
    } finally {
      setSubmittingDecision(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Multi-Signature Approvals</h2>
          <p className="text-xs text-zinc-400">
            Isolated multi-party signature queue for high-value treasury transactions.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Multi-Sig Proposal
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-28 rounded-xl bg-zinc-900" />
          <div className="h-28 rounded-xl bg-zinc-900" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <p className="text-sm text-zinc-400">No multi-signature proposals currently pending for this account.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((p) => {
            const amountFormatted = (Number(BigInt(p.amount)) / 1e7).toLocaleString();
            const approvedCount = p.approvals.filter((a) => a.decision === "Approved").length;

            return (
              <div
                key={p.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">{p.title}</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">{p.description}</p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      p.status === "Approved"
                        ? "bg-emerald-950 text-emerald-400 border border-emerald-800/50"
                        : p.status === "Rejected"
                        ? "bg-red-950 text-red-400 border border-red-800/50"
                        : "bg-amber-950 text-amber-400 border border-amber-800/50"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs border-t border-zinc-800/60 pt-3">
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Amount</span>
                    <span className="font-bold text-white text-sm">{amountFormatted} XLM / USDC</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Recipient</span>
                    <span className="font-mono text-zinc-300 truncate block">{p.recipient.slice(0, 10)}...</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Signatures</span>
                    <span className="font-bold text-emerald-400">
                      {approvedCount} / {p.requiredApprovals} Approved
                    </span>
                  </div>
                </div>

                {/* Approvals list */}
                {p.approvals.length > 0 && (
                  <div className="mt-3 bg-zinc-950/60 rounded-lg p-3 space-y-1 text-xs">
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase">Approver History</p>
                    {p.approvals.map((app) => (
                      <div key={app.id} className="flex justify-between items-center text-zinc-300">
                        <span>{app.approverEmail}</span>
                        <span className={`font-bold ${app.decision === "Approved" ? "text-emerald-400" : "text-red-400"}`}>
                          {app.decision}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {canApprove && p.status === "Pending" && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setSelectedProposal(p)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
                    >
                      Cast Approval Vote
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Proposal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Create Multi-Sig Proposal</h3>
            <form onSubmit={handleCreateProposal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Proposal Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Audit Retainer Payment"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Description</label>
                <textarea
                  placeholder="Details regarding purpose of disbursement"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Amount (XLM / USDC)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Recipient Stellar Address</label>
                <input
                  type="text"
                  required
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Required Approvals Threshold</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={requiredApprovals}
                  onChange={(e) => setRequiredApprovals(Number(e.target.value))}
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
                  {submitting ? "Submitting..." : "Submit Proposal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve/Reject Vote Modal */}
      {selectedProposal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Cast Approval Vote</h3>
            <p className="text-xs text-zinc-400 mb-4">{selectedProposal.title}</p>
            <form onSubmit={handleSubmitDecision} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Decision</label>
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as "Approved" | "Rejected")}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="Approved">Approve Transaction</option>
                  <option value="Rejected">Reject Transaction</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Note (Optional)</label>
                <input
                  type="text"
                  placeholder="Reasoning or verification reference"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedProposal(null)}
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDecision}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {submittingDecision ? "Casting Vote..." : "Submit Vote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
