import React, { Suspense } from "react";
import { act, render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import { AccountProvider } from "@/context/AccountContext";
import type { AccountRole, SpendAlert, TreasuryAccount } from "@spendguard/sdk";

// ── Fixtures ──────────────────────────────────────────────────────────

export const ADDRESS_MAIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const ADDRESS_OPS = "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export function treasuryAccount(overrides: Partial<TreasuryAccount> = {}): TreasuryAccount {
  return {
    id: "acc-main-treasury",
    name: "Main Treasury",
    description: "Primary x402 settlement account",
    address: ADDRESS_MAIN,
    type: "Business",
    status: "Active",
    contextRuleId: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Stroops are 10^7 per unit, so 1_500_000_000n renders as "15.00 XLM". */
export function spendAlert(overrides: Partial<SpendAlert> = {}): SpendAlert {
  return {
    id: "alert-1",
    account: ADDRESS_MAIN,
    contextRuleId: 1,
    level: "breach",
    eventAmount: 1_500_000_000n,
    totalSpentInWindow: 9_000_000_000n,
    cap: 10_000_000_000n,
    triggerLedger: 52_000_001,
    raisedAt: "2026-06-01T10:00:00.000Z",
    webhookDelivered: true,
    ...overrides,
  };
}

/** Shape returned by `/api/accounts?events=true` (amount already a string). */
export function settlementEvent(overrides: Partial<{
  id: string;
  ledger: number;
  account: string;
  sourceContractId: string;
  amountSpent: string;
  contextRuleId: number;
  timestamp: string;
}> = {}) {
  return {
    id: "evt-1",
    ledger: 52_000_000,
    account: ADDRESS_MAIN,
    sourceContractId: "CCAM4NRAUB6SO3XLL2SRZQEHSOUYQGDKGNPCUIQ5KKI2S6QKWC2VN6NX",
    amountSpent: "250000000",
    contextRuleId: 1,
    reference: null,
    timestamp: "2026-06-01T09:55:00.000Z",
    ...overrides,
  };
}

export function membership(accountId: string, role: AccountRole) {
  return { accountId, name: `${role} account`, role, memberName: `${role} Person` };
}

export function sessionPayload(email: string, memberships: ReturnType<typeof membership>[]) {
  return { email, memberships };
}

// ── fetch stub ────────────────────────────────────────────────────────

export type FetchStub = {
  /** Matched against the request URL. Order matters: first match wins. */
  match: RegExp;
  status?: number;
  body?: unknown;
  /** Never settles — used to pin a component in its loading state. */
  hang?: boolean;
};

export type FetchHarness = {
  calls: string[];
  /** URLs the components actually asked for, for asserting lazy loads. */
  fetch: ReturnType<typeof vi.fn>;
};

export function stubFetch(stubs: FetchStub[]): FetchHarness {
  const calls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);

    const stub = stubs.find((s) => s.match.test(url));
    if (!stub) {
      throw new Error(`No fetch stub matched ${url}`);
    }
    if (stub.hang) {
      return new Promise<Response>(() => {});
    }

    const status = stub.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => stub.body ?? null,
      text: async () => JSON.stringify(stub.body ?? null),
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetch: fetchMock };
}

/**
 * The dashboard reads the active account id out of localStorage, so tests that
 * change it must not leak into the next one.
 *
 * `act` is awaited because the account pages call `use(params)`, which suspends
 * for one microtask before it can read the resolved value.
 */
export async function renderWithProviders(
  ui: React.ReactElement
): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(
      <Suspense fallback={<div data-testid="suspended">suspended</div>}>
        <AccountProvider>{ui}</AccountProvider>
      </Suspense>
    );
  });
  if (!result) {
    throw new Error("render did not complete");
  }
  return result;
}

/** KPI cards render as `<p>label</p><p>value</p>` — read the sibling. */
export function kpiValue(label: string, container: HTMLElement): string {
  const all = Array.from(container.querySelectorAll("p")).filter(
    (p) => p.textContent?.trim() === label
  );
  if (all.length !== 1) {
    throw new Error(`Expected exactly one KPI labelled "${label}", found ${all.length}`);
  }
  return all[0]!.nextElementSibling?.textContent?.trim() ?? "";
}
