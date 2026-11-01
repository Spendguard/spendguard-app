"use client";

import React, { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { useAccount } from "@/context/AccountContext";
import { RoleBadge } from "@/components/RoleBadge";
import { AccountRole, AccountMember } from "@spendguard/sdk";

export default function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { userRole, can } = useAccount();

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Member Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("Viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = can("members:manage");

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/accounts/${id}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch (err) {
      console.error("Failed to load members:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name || !email) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/accounts/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          role,
        }),
      });

      if (res.ok) {
        setName("");
        setEmail("");
        setShowAddModal(false);
        await loadMembers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to add member");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: AccountRole) => {
    try {
      const res = await fetch(`/api/accounts/${id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          newRole,
        }),
      });
      if (res.ok) {
        await loadMembers();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update role");
      }
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member from the treasury account?")) return;
    try {
      const res = await fetch(`/api/accounts/${id}/members?memberId=${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await loadMembers();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to remove member");
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href={`/accounts/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to Treasury Overview
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Account Members & RBAC</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Role-based permissions management (Owner, Admin, Finance Manager, Approver, Viewer) for this treasury.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Team Member
          </button>
        )}
      </div>

      {!canManage && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/40 p-4 text-xs font-medium text-amber-300">
          Note: Your session holds the role &quot;{userRole}&quot; on this treasury, which is
          view-only for members. An Owner or Admin must change your role for these controls to open up.
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-xl bg-zinc-900" />
          <div className="h-16 rounded-xl bg-zinc-900" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Member</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">Added Date</th>
                {canManage && <th className="px-5 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-5 py-4 font-bold text-white">{m.name}</td>
                  <td className="px-5 py-4 font-mono text-zinc-300">{m.email}</td>
                  <td className="px-5 py-4">
                    {canManage ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value as AccountRole)}
                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        <option value="Owner">Owner</option>
                        <option value="Admin">Admin</option>
                        <option value="Finance Manager">Finance Manager</option>
                        <option value="Approver">Approver</option>
                        <option value="Viewer">Viewer</option>
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </td>
                  <td className="px-5 py-4 text-zinc-500">{new Date(m.addedAt).toLocaleDateString()}</td>
                  {canManage && (
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        className="rounded-lg border border-red-900/50 bg-red-950/30 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-900/50 transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Add Team Member</h3>

            {error && (
              <div className="mb-4 rounded-lg bg-red-950/50 border border-red-800 p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Carol Finance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="carol@spendguard.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Role Assignment</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as AccountRole)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="Owner">Owner (Full admin & billing control)</option>
                  <option value="Admin">Admin (Full management except ownership/deletion)</option>
                  <option value="Finance Manager">Finance Manager (Budgets, policies & multi-sig creation)</option>
                  <option value="Approver">Approver (Multi-sig vote casting)</option>
                  <option value="Viewer">Viewer (Read-only access)</option>
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
                  {submitting ? "Adding Member..." : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
