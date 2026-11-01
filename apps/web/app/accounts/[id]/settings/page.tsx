"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/context/AccountContext";
import { AccountSettings } from "@spendguard/sdk";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { userRole, refreshAccounts, can } = useAccount();

  const [, setSettings] = useState<AccountSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [nearMissThresholdPct, setNearMissThresholdPct] = useState("90");
  const [multisigThreshold, setMultisigThreshold] = useState("2");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [autoLockOnBreach, setAutoLockOnBreach] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const canEdit = can("account:edit");
  const canArchive = can("account:archive");

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const res = await fetch(`/api/accounts/${id}/settings`);
        if (res.ok) {
          const data = (await res.json()) as AccountSettings;
          setSettings(data);
          setWebhookUrl(data.webhookUrl || "");
          setNearMissThresholdPct(String(data.nearMissThresholdPct || 90));
          setMultisigThreshold(String(data.multisigThreshold || 2));
          setNotificationEmail(data.notificationEmail || "");
          setAutoLockOnBreach(data.autoLockOnBreach !== undefined ? data.autoLockOnBreach : true);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setMessage({ type: "error", text: `Role "${userRole}" cannot edit settings.` });
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);

      const res = await fetch(`/api/accounts/${id}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl,
          nearMissThresholdPct: Number(nearMissThresholdPct),
          multisigThreshold: Number(multisigThreshold),
          notificationEmail,
          autoLockOnBreach,
        }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Treasury settings updated successfully!" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to update settings" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "An error occurred" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!confirm("Are you sure you want to archive this treasury account?")) return;
    try {
      const res = await fetch(`/api/accounts/${id}?action=archive`, {
        method: "DELETE",
      });
      if (res.ok) {
        await refreshAccounts();
        router.push("/accounts");
      }
    } catch (err) {
      console.error("Failed to archive account:", err);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-8">
        <div className="h-8 w-48 rounded bg-zinc-900" />
        <div className="h-64 rounded-2xl bg-zinc-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Treasury Account Settings</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Configure isolated webhooks, threshold notifications, multi-sig signers count, and account lifecycle.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-xl border p-4 text-xs font-medium ${
            message.type === "success"
              ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
              : "border-red-800/60 bg-red-950/40 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl backdrop-blur-md space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400 border-b border-zinc-800 pb-2">
            Alert & Webhook Configuration
          </h2>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Webhook Endpoint URL</label>
            <input
              type="url"
              placeholder="https://your-api.com/webhooks/spendguard"
              disabled={!canEdit}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white font-mono placeholder-zinc-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Receive instant JSON HTTP POST dispatches whenever spending policy near-miss or breach events occur.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Near-Miss Threshold (% of Cap)
              </label>
              <input
                type="number"
                min="50"
                max="99"
                disabled={!canEdit}
                value={nearMissThresholdPct}
                onChange={(e) => setNearMissThresholdPct(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Required Multi-Sig Signers Count
              </label>
              <input
                type="number"
                min="1"
                max="10"
                disabled={!canEdit}
                value={multisigThreshold}
                onChange={(e) => setMultisigThreshold(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Notification Email</label>
            <input
              type="email"
              placeholder="security-alerts@spendguard.io"
              disabled={!canEdit}
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="autolock"
              disabled={!canEdit}
              checked={autoLockOnBreach}
              onChange={(e) => setAutoLockOnBreach(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-800 bg-zinc-950 text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="autolock" className="text-xs font-semibold text-zinc-300 cursor-pointer">
              Auto-lock Multi-Sig Disbursements on Policy Breach
            </label>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              disabled={!canEdit || submitting}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition-all shadow-md"
            >
              {submitting ? "Saving Settings..." : "Save Settings"}
            </button>
          </div>
        </form>

        {/* Danger Zone */}
        <div className="pt-6 border-t border-zinc-800">
          <h2 className="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">Danger Zone</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Archive this account to pause indexing and monitoring, or delete permanently.
          </p>

          <div className="flex flex-wrap gap-3">
            {canArchive && (
              <button
                type="button"
                onClick={handleArchive}
                className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-900/40 transition-colors"
              >
                Archive Treasury Account
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
