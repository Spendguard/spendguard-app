// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  ADDRESS_MAIN,
  ADDRESS_OPS,
  kpiValue,
  membership,
  renderWithProviders,
  sessionPayload,
  settlementEvent,
  spendAlert,
  stubFetch,
  treasuryAccount,
  type FetchStub,
} from "./harness";
import DashboardPage from "@/app/page";

const nav = vi.hoisted(() => ({
  pathname: "/",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useParams: () => ({}),
}));

// next/link needs the App Router context to prefetch; a plain anchor is enough
// to assert where a card points.
vi.mock("next/link", async () => {
  const R = await import("react");
  type Props = {
    href: string;
    children?: React.ReactNode;
    className?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  };
  return {
    default: function MockLink({ href, children, ...rest }: Props) {
      return R.createElement("a", { href, ...rest }, children);
    },
  };
});

const main = treasuryAccount();
const ops = treasuryAccount({
  id: "acc-ops-treasury",
  name: "Ops Treasury",
  description: "Day-to-day operating budget",
  address: ADDRESS_OPS,
  type: "DAO",
  contextRuleId: 2,
});

/** Alerts/events as the API serialises them: bigints arrive as strings. */
// Deliberately uneven (2 breaches, 1 near miss) so a swapped KPI counter cannot
// still satisfy the assertions by coincidence.
const alertsJson = [
  spendAlert({ id: "alert-1" }),
  spendAlert({
    id: "alert-2",
    level: "near_miss",
    eventAmount: 400_000_000n,
    totalSpentInWindow: 8_400_000_000n,
    webhookDelivered: false,
  }),
  spendAlert({ id: "alert-3", eventAmount: 7_000_000_000n }),
].map((a) => ({
  ...a,
  eventAmount: a.eventAmount.toString(),
  totalSpentInWindow: a.totalSpentInWindow.toString(),
  cap: a.cap.toString(),
}));

const eventsJson = [
  settlementEvent({ id: "evt-1", amountSpent: "250000000" }),
  settlementEvent({ id: "evt-2", ledger: 52_000_010, amountSpent: "150000000" }),
];

function signedInStubs(overrides: FetchStub[] = []): FetchStub[] {
  return [
    ...overrides,
    {
      match: /\/api\/auth\/session(\?|$)/,
      body: sessionPayload("owner@spendguard.io", [
        membership("acc-main-treasury", "Owner"),
        membership("acc-ops-treasury", "Owner"),
      ]),
    },
    { match: /\/api\/accounts\?address=.*&alerts=true/, body: alertsJson },
    { match: /\/api\/accounts\?address=.*&events=true/, body: eventsJson },
    { match: /\/api\/accounts$/, body: [main, ops] },
    {
      match: /\/api\/stellar\/account/,
      body: {
        address: ADDRESS_MAIN,
        contextRuleId: 1,
        latestLedger: 52_000_100,
        network: "testnet",
        xlmBalance: "1234.5678",
        spendingLimitState: {
          cap: "10000000000",
          windowSeconds: "86400",
          spentInWindow: "9000000000",
          windowStartedAt: "1780000000",
          utilizationPct: 90,
        },
        fetchedAt: new Date().toISOString(),
      },
    },
  ];
}

beforeEach(() => {
  localStorage.clear();
  nav.pathname = "/";
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard (/)", () => {
  it("holds the skeleton on screen until the session and accounts land", async () => {
    stubFetch([
      { match: /\/api\/auth\/session/, hang: true },
      { match: /\/api\/accounts/, hang: true },
    ]);

    await renderWithProviders(<DashboardPage />);

    expect(document.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("Main Treasury")).toBeNull();
  });

  it("renders the active treasury, the monitored-accounts list and its alert history", async () => {
    stubFetch(signedInStubs());

    const { container } = await renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Main Treasury" })).toBeInTheDocument();
    // once in the active-treasury header, once in its card
    expect(screen.getAllByText(ADDRESS_MAIN).length).toBeGreaterThan(0);

    // KPI cards are derived from the alert feed: 3 alerts, 2 breaches, 1 near miss
    await waitFor(() => expect(kpiValue("Total Ingested Alerts", container)).toBe("3"));
    expect(kpiValue("Policy Breaches", container)).toBe("2");
    expect(kpiValue("Near Misses", container)).toBe("1");
    expect(kpiValue("Total Accounts", container)).toBe("2");

    // Every membership is listed and exactly one is marked active
    expect(await screen.findByText("All Monitored Treasuries")).toBeInTheDocument();
    expect(screen.getByText("Ops Treasury")).toBeInTheDocument();
    expect(screen.getAllByText("ACTIVE")).toHaveLength(1);

    // Alert rows carry the stroop amount converted to XLM and webhook state
    expect(screen.getAllByText("Breach")).toHaveLength(2);
    const nearMissRow = screen.getByText("Near Miss");
    expect(within(nearMissRow.closest("tr") as HTMLElement).getByText("40.00 XLM")).toBeInTheDocument();
    expect(within(nearMissRow.closest("tr") as HTMLElement).getByText("Pending")).toBeInTheDocument();
    expect(within(screen.getAllByText("Breach")[0]!.closest("tr") as HTMLElement).getByText("Delivered")).toBeInTheDocument();
  });

  it("charts ingested settlement events instead of falling back to alerts", async () => {
    const harness = stubFetch(signedInStubs());

    await renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/2 live on-chain events/)).toBeInTheDocument();
    expect(harness.calls.some((u) => u.includes("events=true"))).toBe(true);
  });

  it("labels an unreachable feed as unknown instead of a quiet treasury", async () => {
    stubFetch(
      signedInStubs([
        {
          match: /\/api\/accounts\?address=.*&alerts=true/,
          status: 503,
          body: { error: "Alert feed unavailable", detail: "The indexer database could not be queried." },
        },
        {
          match: /\/api\/accounts\?address=.*&events=true/,
          status: 503,
          body: { error: "Settlement events unavailable", detail: "The indexer database could not be queried." },
        },
      ])
    );

    const { container } = await renderWithProviders(<DashboardPage />);

    // Both feeds degrade to their own "unknown" panels — neither may render the
    // reassuring empty state it shares a code path with.
    expect(await screen.findByText("Spend history unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No spend events recorded yet/)).toBeNull();
    expect(screen.queryByText("No alerts have been raised for this account.")).toBeNull();

    const outagePanels = await screen.findAllByRole("alert");
    expect(outagePanels).toHaveLength(2);
    expect(
      outagePanels.map((panel) => panel.textContent).join(" ")
    ).toMatch(/Alert history is unknown while the indexer database is unreachable/);

    // KPIs derived from the unreadable feed refuse to claim a count.
    await waitFor(() => expect(kpiValue("Total Ingested Alerts", container)).toBe("—"));
    expect(kpiValue("Policy Breaches", container)).toBe("—");
    expect(kpiValue("Near Misses", container)).toBe("—");
    // ...while the ones read from the account store keep their real numbers.
    expect(kpiValue("Total Accounts", container)).toBe("2");
  });

  it("shows the onboarding empty state for a session with no treasuries", async () => {
    stubFetch([
      {
        match: /\/api\/auth\/session(\?|$)/,
        body: sessionPayload("stranger@spendguard.io", []),
      },
      { match: /\/api\/accounts$/, body: [] },
    ]);

    await renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("No Treasury Accounts Configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Treasury Account" })).toHaveAttribute(
      "href",
      "/accounts/new"
    );
  });

  it("sends an anonymous visitor to sign-in instead of listing treasuries", async () => {
    stubFetch([
      { match: /\/api\/auth\/session/, status: 401, body: { error: "Not signed in" } },
      { match: /\/api\/accounts$/, body: [] },
    ]);

    await renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/signin"));
    expect(screen.queryByText("Main Treasury")).toBeNull();
  });

  it("re-points the dashboard when another treasury is clicked", async () => {
    const harness = stubFetch(signedInStubs());

    await renderWithProviders(<DashboardPage />);

    const card = await screen.findByText("Ops Treasury");
    fireEvent.click(card);

    expect(await screen.findByRole("heading", { level: 1, name: "Ops Treasury" })).toBeInTheDocument();
    await waitFor(() =>
      expect(harness.calls.some((u) => u.includes(`address=${ADDRESS_OPS}`))).toBe(true)
    );
    expect(localStorage.getItem("spendguard_active_account_id")).toBe("acc-ops-treasury");
  });
});
