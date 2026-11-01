// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  membership,
  renderWithProviders,
  stubFetch,
  treasuryAccount,
  type FetchStub,
} from "./harness";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/context/ThemeContext";

const nav = vi.hoisted(() => ({
  pathname: "/",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useParams: () => ({}),
}));

const BADGE = /Demo mode — identity, not authentication/;

function sessionStubs(demoMode: boolean): FetchStub[] {
  return [
    {
      match: /\/api\/auth\/session(\?|$)/,
      body: {
        email: "owner@spendguard.io",
        memberName: "Alice Owner",
        memberships: [membership("acc-main-treasury", "Owner")],
        demoMode,
      },
    },
    { match: /\/api\/accounts$/, body: [treasuryAccount()] },
  ];
}

beforeEach(() => {
  localStorage.clear();
  nav.pathname = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo-mode indicator", () => {
  it("shows the badge when the server says this deployment signs in from an email", async () => {
    stubFetch(sessionStubs(true));

    await renderWithProviders(
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    );

    const badge = await screen.findByText(BADGE);
    expect(badge).toHaveAttribute("role", "status");
    // The identity chip is next to it, so a reviewer sees both together.
    expect(screen.getByText("owner@spendguard.io")).toBeInTheDocument();
  });

  it("stays out of the way when the session endpoint reports no demo mode", async () => {
    stubFetch(sessionStubs(false));

    await renderWithProviders(
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    );

    await screen.findByText("owner@spendguard.io");
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it("shows the badge to an anonymous visitor, before they reach for an email", async () => {
    // /signin is where the claim matters most: the visitor is about to be told
    // that typing an address is "signing in".
    stubFetch([
      {
        match: /\/api\/auth\/session(\?|$)/,
        status: 401,
        body: { authenticated: false, demoMode: true },
      },
      { match: /\/api\/accounts$/, body: [] },
    ]);

    await renderWithProviders(
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    );

    const badge = await screen.findByText(BADGE);
    expect(badge).toHaveAttribute("role", "status");
  });
});
