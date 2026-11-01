"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/context/AccountContext";
import { AccountSwitcher } from "./AccountSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const pathname = usePathname();
  const { activeAccount, userRole, session, signOut } = useAccount();

  const navItems = [
    { name: "Overview", href: activeAccount ? `/accounts/${activeAccount.id}` : "/" },
    { name: "Accounts List", href: "/accounts" },
    { name: "Members", href: activeAccount ? `/accounts/${activeAccount.id}/members` : "/accounts" },
    { name: "Settings", href: activeAccount ? `/accounts/${activeAccount.id}/settings` : "/accounts" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/30 to-emerald-600/10 border border-emerald-500/30 shadow-inner">
              <svg
                className="h-5 w-5 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white">SpendGuard</span>
              <span className="ml-1.5 rounded-full bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-800/40">
                Treasury
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Signed-in identity. The role is resolved by the server from this
              user's membership on the active account — it is displayed here,
              not chosen. */}
          {session && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1">
              <div className="flex flex-col leading-tight">
                <span className="text-[11px] font-semibold text-zinc-200">
                  {userRole ?? "No role on this account"}
                </span>
                <span className="text-[10px] text-zinc-500">{session.email}</span>
              </div>
              <button
                onClick={() => void signOut()}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Sign out
              </button>
            </div>
          )}

          {/* Account Switcher */}
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
}
