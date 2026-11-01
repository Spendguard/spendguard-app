// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LiveSpendingCard } from "@/components/LiveSpendingCard";
import { ADDRESS_MAIN, stubFetch } from "./harness";

const LIVE_ROUTE = /\/api\/stellar\/account/;

function payload(over: Record<string, unknown> = {}) {
  return {
    address: ADDRESS_MAIN,
    contextRuleId: 1,
    latestLedger: 52_000_100,
    network: "testnet",
    xlmBalance: "1234.5678",
    spendingLimitState: {
      cap: "10000000000",
      spentInWindow: "9000000000",
      utilizationPct: 90,
      windowLedgers: 17_280,
      windowStartedLedger: 52_000_000,
      windowSecondsEstimate: 86_400,
      windowStartedAtEstimate: 1_780_000_000,
    },
    policyReadError: null,
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

async function renderCard(body: unknown) {
  stubFetch([{ match: LIVE_ROUTE, body }]);
  // The card talks to one endpoint and needs no session context, so it renders
  // bare — wrapping it in AccountProvider would drag in router mocks for nothing.
  await act(async () => {
    render(<LiveSpendingCard address={ADDRESS_MAIN} contextRuleId={1} />);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LiveSpendingCard", () => {
  it("shows the ledger-native window next to the wall-clock estimate", async () => {
    await renderCard(payload());

    // The ~24 h figure is derived, so it has to look derived; the ledger count
    // is what the contract actually said and stays visible underneath it.
    expect(await screen.findByText("~24h")).toBeInTheDocument();
    expect(screen.getByText(/17,280 ledgers · opened #52,000,000/)).toBeInTheDocument();
  });

  it("says so when the window has no spending history yet", async () => {
    await renderCard(
      payload({
        spendingLimitState: {
          ...payload().spendingLimitState,
          windowStartedLedger: 0,
          windowStartedAtEstimate: null,
        },
      }),
    );

    expect(await screen.findByText(/17,280 ledgers · no spend yet/)).toBeInTheDocument();
  });

  // The distinction the old code could not make: a failed read used to be
  // logged, swallowed, and rendered as "no policy registered".
  it("separates an unreadable policy from an absent one", async () => {
    await renderCard(
      payload({ spendingLimitState: null, policyReadError: "RPC simulation failed" }),
    );

    expect(await screen.findByText(/Live limit unavailable/)).toBeInTheDocument();
    expect(screen.getByText("RPC simulation failed")).toBeInTheDocument();
    expect(
      screen.queryByText(/No on-chain policy registered/),
    ).not.toBeInTheDocument();
  });

  it("reports absence only when the contract answered that there is none", async () => {
    await renderCard(payload({ spendingLimitState: null }));

    expect(
      await screen.findByText(/No on-chain policy registered for this account/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Live limit unavailable/)).not.toBeInTheDocument();
  });
});
