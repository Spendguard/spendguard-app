"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "@/context/AccountContext";
import { AccountType, AccountStatus } from "@spendguard/sdk";

export default function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { refreshAccounts, userRole, can } = useAccount();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<AccountType>("Business");
  const [status, setStatus] = useState<AccountStatus>("Active");
  const [address, setAddress] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = can("account:edit");

  useEffect(() => {
    async function loadAccount() {
      try {
        setLoading(true);
        const res = await fetch(`/api/accounts/${id}`);
        if (res.ok) {
          const data = await res.json();
          setName(data.name || "");
          setDescription(data.description || "");
          setType(data.type || "Business");
          setStatus(data.status || "Active");
          setAddress(data.address || "");
        } else {
          setError("Account not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load account");
      } finally {
        setLoading(false);
      }
    }
    loadAccount();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setError(`Role "${userRole}" does not have permission to edit accounts`);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          type,
          status,
        }),
      });

      if (res.ok) {
        await refreshAccounts();
        router.push(`/accounts/${id}`);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update account");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl animate-pulse space-y-4 p-8">
        <div className="h-8 w-48 rounded bg-zinc-900" />
        <div className="h-64 rounded-2xl bg-zinc-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/accounts/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to Treasury Overview
      </Link>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl backdrop-blur-md">
        <h1 className="text-2xl font-bold tracking-tight text-white">Edit Treasury Account</h1>
        <p className="mt-1 text-xs text-zinc-400 font-mono truncate">{address}</p>

        {!canEdit && (
          <div className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/40 p-4 text-xs font-medium text-amber-300">
            Warning: Your session holds the role &quot;{userRole}&quot; on this treasury, which cannot
            modify account settings. An Owner or Admin must raise your role from the Members page.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-800/60 bg-red-950/40 p-4 text-xs font-medium text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
              Account Name
            </label>
            <input
              type="text"
              required
              disabled={!canEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
              Description
            </label>
            <textarea
              rows={3}
              disabled={!canEdit}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Account Type
              </label>
              <select
                disabled={!canEdit}
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="Personal">Personal</option>
                <option value="Business">Business</option>
                <option value="DAO">DAO</option>
                <option value="NGO">NGO</option>
                <option value="Project">Project</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Account Status
              </label>
              <select
                disabled={!canEdit}
                value={status}
                onChange={(e) => setStatus(e.target.value as AccountStatus)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="Active">Active</option>
                <option value="Archived">Archived</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
            <Link
              href={`/accounts/${id}`}
              className="rounded-xl border border-zinc-800 px-5 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={!canEdit || submitting}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition-all shadow-md"
            >
              {submitting ? "Saving Changes..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
