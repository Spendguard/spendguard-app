// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  ADDRESS_MAIN,
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
import AccountOverviewPage from "@/app/accounts/[id]/page";

const nav = vi.hoisted(() => ({
  pathname: "/accounts/acc-main-treasury",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useParams: () => ({}),
}));

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

const account = treasuryAccount();

const alertsJson = [
  spendAlert({ id: "alert-1" }),
  spendAlert({ id: "alert-2", level: "near_miss", eventAmount: 400_000_000n }),
  spendAlert({ id: "alert-3", eventAmount: 700_000_000n }),
].map((a) => ({
  ...a,
  eventAmount: a.eventAmount.toString(),
  totalSpentInWindow: a.totalSpentInWindow.toString(),
  cap: a.cap.toString(),
}));

const proposal = {
  id: "prop-1",
  title: "Vendor payout",
  description: "Q3 infrastructure invoice",
  amount: "25000000000",
  recipient: ADDRESS_MAIN,
  requiredApprovals: 2,
  status: "Pending",
  createdBy: "owner@spendguard.io",
  createdAt: "2026-06-01T09:00:00.000Z",
  approvals: [
    {
      id: "approval-1",
      approverEmail: "owner@spendguard.io",
      decision: "Approved",
      note: "Checked the invoice",
      timestamp: "2026-06-01T09:30:00.000Z",
    },
  ],
};

function detailStubs(role: "Owner" | "Viewer" = "Owner", extra: FetchStub[] = []): FetchStub[] {
  return [
    ...extra,
    {
      match: /\/api\/auth\/session(\?|$)/,
      body: sessionPayload(`${role.toLowerCase()}@spendguard.io`, [
        membership("acc-main-treasury", role),
      ]),
    },
    { match: /\/api\/accounts\/acc-main-treasury\/multisig/, body: [proposal] },
    { match: /\/api\/accounts\?address=.*&alerts=true/, body: alertsJson },
    { match: /\/api\/accounts\?address=.*&events=true/, body: [settlementEvent()] },
    { match: /\/api\/accounts$/, body: [account] },
    { match: /\/api\/accounts\/acc-main-treasury$/, body: account },
  ];
}

async function renderDetail(role: "Owner" | "Viewer" = "Owner", extra: FetchStub[] = []) {
  const harness = stubFetch(detailStubs(role, extra));
  return { harness, ...(await renderWithProviders(<AccountOverviewPage params={Promise.resolve({ id: "acc-main-treasury" })} />)) };
}

beforeEach(() => {
  localStorage.clear();
  nav.pathname = "/accounts/acc-main-treasury";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account detail (/accounts/[id])", () => {
  it("renders the treasury header, spend history and alert history", async () => {
    const { harness } = await renderDetail();

    expect(await screen.findByRole("heading", { level: 1, name: "Main Treasury" })).toBeInTheDocument();
    expect(screen.getByText("Primary x402 settlement account")).toBeInTheDocument();
    expect(screen.getByText(ADDRESS_MAIN)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();

    // Spend history comes from the ingested events for this address
    expect(await screen.findByText(/1 live on-chain event\b/)).toBeInTheDocument();
    expect(harness.calls.some((u) => u.includes("events=true"))).toBe(true);

    // Alert history: two breaches and one near miss, amounts converted from stroops
    expect(await screen.findAllByText("Breach")).toHaveLength(2);
    expect(screen.getByText("Near Miss")).toBeInTheDocument();
    expect(screen.getAllByText("150.00 XLM").length).toBeGreaterThan(0);
  });

  it("counts the alert feed in the KPI cards", async () => {
    const { container } = await renderDetail();

    expect(await screen.findAllByText("Breach")).toHaveLength(2);

    await waitFor(() => expect(kpiValue("Total Alerts", container)).toBe("3"));
    expect(kpiValue("Breaches", container)).toBe("2");
    expect(kpiValue("Near Misses", container)).toBe("1");
    expect(kpiValue("Context Rule", container)).toBe("#1");
  });

  it("reports a missing treasury instead of an empty dashboard", async () => {
    stubFetch(
      detailStubs("Owner", [
        { match: /\/api\/accounts\/acc-nope$/, status: 404, body: { error: "not found" } },
      ])
    );

    await renderWithProviders(<AccountOverviewPage params={Promise.resolve({ id: "acc-nope" })} />);

    expect(await screen.findByText("Account Not Found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Accounts List" })).toHaveAttribute(
      "href",
      "/accounts"
    );
  });

  it("keeps an unreachable feed apart from a treasury that has no history", async () => {
    const { container } = await renderDetail("Owner", [
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
    ]);

    expect(await screen.findByText("Spend history unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No spend events recorded yet/)).toBeNull();
    expect(screen.queryByText("No alerts have been raised for this account.")).toBeNull();

    await waitFor(() => expect(kpiValue("Total Alerts", container)).toBe("—"));
    expect(kpiValue("Breaches", container)).toBe("—");
    expect(kpiValue("Near Misses", container)).toBe("—");
    // The context rule comes from the account record, so it keeps its value.
    expect(kpiValue("Context Rule", container)).toBe("#1");

    // The counts are explained even while the overview tab is off-screen.
    expect(
      screen.getByText(/Alert counts are unknown because the indexer database could not be queried/)
    ).toBeInTheDocument();

    // The transactions tab reads the same feeds and degrades the same way.
    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    expect(await screen.findByText(/are unknown while the indexer database is unreachable/)).toBeInTheDocument();
    expect(screen.queryByText("No transactions recorded")).toBeNull();
  });

  it("loads the multi-sig queue only when its tab is opened", async () => {
    const { harness } = await renderDetail();

    await screen.findByRole("heading", { level: 1, name: "Main Treasury" });
    expect(harness.calls.some((u) => u.includes("/multisig"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Multi-Sig Approvals" }));

    expect(await screen.findByText("Vendor payout")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("2,500 XLM / USDC")).toBeInTheDocument();
    expect(harness.calls.some((u) => u.includes("/multisig"))).toBe(true);
  });

  it("withholds proposal creation from a Viewer", async () => {
    await renderDetail("Viewer");

    fireEvent.click(await screen.findByRole("button", { name: "Multi-Sig Approvals" }));

    expect(await screen.findByText("Vendor payout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Multi-Sig Proposal" })).toBeNull();
  });

  it("offers proposal creation to an Owner", async () => {
    await renderDetail("Owner");

    fireEvent.click(await screen.findByRole("button", { name: "Multi-Sig Approvals" }));

    expect(await screen.findByRole("button", { name: "Create Multi-Sig Proposal" })).toBeInTheDocument();
  });
});
