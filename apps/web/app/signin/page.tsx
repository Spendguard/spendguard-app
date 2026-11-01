"use client";

import React, { useState } from "react";
import { useAccount } from "@/context/AccountContext";
import { DEMO_IDENTITIES } from "@/lib/auth/demo-identities";

/**
 * Sign-in screen.
 *
 * With DEMO_AUTH=true this trades an email for a session so reviewers can see
 * RBAC actually change underneath them — sign in as Viewer and the write
 * controls disappear, because the server refuses them, not because the UI hid
 * them. Real deployments put an IdP in front; /api/auth/session returns 501
 * when DEMO_AUTH is off.
 */

export default function SignInPage() {
  const { signIn } = useAccount();
  const [email, setEmail] = useState("owner@spendguard.io");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(value.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Sign in to SpendGuard</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Treasury data is scoped to your memberships. Your role is resolved per account on every
          request.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(email);
        }}
      >
        <label className="text-xs font-medium text-zinc-400" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          placeholder="you@organisation.io"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Demo identities
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Available while the seeded demo runs with DEMO_AUTH=true.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {DEMO_IDENTITIES.map((identity) => (
            <button
              key={identity.email}
              onClick={() => {
                setEmail(identity.email);
                void attempt(identity.email);
              }}
              disabled={busy}
              className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:border-emerald-700 hover:bg-zinc-800/60 disabled:opacity-60"
            >
              <span className="font-medium">{identity.label}</span>
              <span className="text-zinc-500">{identity.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
