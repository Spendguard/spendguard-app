"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { AccountRole, Permission, TreasuryAccount } from "@spendguard/sdk";
import { hasPermission } from "@spendguard/sdk";

/**
 * Session-driven account state.
 *
 * `userRole` used to be a dropdown the browser picked freely, and the value was
 * echoed back to the API as `actorRole` — so the server's RBAC checks could be
 * satisfied by any client that claimed "Owner". The role is now whatever the
 * server says this user holds on the account they are looking at.
 */

export type Membership = {
  accountId: string;
  name: string;
  role: AccountRole;
  memberName: string;
};

export type Session = {
  email: string;
  memberships: Membership[];
  demoMode?: boolean;
};

interface AccountContextType {
  accounts: TreasuryAccount[];
  activeAccount: TreasuryAccount | null;
  activeAccountId: string | null;
  setActiveAccountId: (id: string) => void;
  refreshAccounts: () => Promise<void>;
  loading: boolean;
  session: Session | null;
  userRole: AccountRole | null;
  /** True when this deployment signs people in from an email alone. */
  demoMode: boolean;
  /** False when the user holds no role on the active account. */
  can: (permission: Permission) => boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType>({
  accounts: [],
  activeAccount: null,
  activeAccountId: null,
  setActiveAccountId: () => {},
  refreshAccounts: async () => {},
  loading: true,
  session: null,
  userRole: null,
  demoMode: false,
  can: () => false,
  signIn: async () => {},
  signOut: async () => {},
});

const STORAGE_KEY = "spendguard_active_account_id";

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  const [activeAccountId, setActiveAccountIdState] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);

      const [sessionRes, accountsRes] = await Promise.all([
        fetch("/api/auth/session"),
        fetch("/api/accounts"),
      ]);

      const sessionBody = (await sessionRes.json().catch(() => ({}))) as Session & {
        authenticated?: boolean;
      };
      setDemoMode(sessionBody.demoMode === true);

      if (sessionRes.status === 401) {
        setSession(null);
        setAccounts([]);
        return;
      }

      setSession(sessionBody);

      if (accountsRes.ok) {
        const data = (await accountsRes.json()) as TreasuryAccount[];
        setAccounts(data);

        // Restore active account from localStorage or default to first
        const savedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (savedId && data.some((a) => a.id === savedId || a.address === savedId)) {
          const matched = data.find((a) => a.id === savedId || a.address === savedId);
          setActiveAccountIdState(matched ? matched.id : data[0]?.id || null);
        } else if (data.length > 0) {
          setActiveAccountIdState(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load session and treasury accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Unauthenticated users are sent to sign-in. The APIs already refuse them;
  // this is so the dashboard shows a login rather than an empty shell.
  useEffect(() => {
    if (loading) return;
    if (!session && pathname !== "/signin") {
      router.replace("/signin");
    } else if (session && pathname === "/signin") {
      router.replace("/");
    }
  }, [loading, session, pathname, router]);

  const setActiveAccountId = (id: string) => {
    setActiveAccountIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  const signIn = useCallback(async (email: string) => {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Sign-in failed");
    }
    await fetchState();
  }, [fetchState]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setSession(null);
    setAccounts([]);
    router.push("/signin");
  }, [router]);

  const activeAccount =
    accounts.find((a) => a.id === activeAccountId || a.address === activeAccountId) ||
    accounts[0] ||
    null;

  // The role is a property of this user on this account, so it changes when
  // the account changes — the same person can be Owner here and Viewer there.
  const userRole: AccountRole | null =
    session?.memberships.find((m) => m.accountId === activeAccount?.id)?.role ?? null;

  const can = useCallback(
    (permission: Permission) => (userRole ? hasPermission(userRole, permission) : false),
    [userRole]
  );

  return (
    <AccountContext.Provider
      value={{
        accounts,
        activeAccount,
        activeAccountId: activeAccount?.id ?? null,
        setActiveAccountId,
        refreshAccounts: fetchState,
        loading,
        session,
        userRole,
        demoMode,
        can,
        signIn,
        signOut,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used within an AccountProvider");
  }
  return context;
}
