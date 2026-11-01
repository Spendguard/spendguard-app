import { describe, it, expect, vi } from "vitest";
import { BreachDetector } from "../src/breach-detector.js";
import type { PolicyReader } from "@spendguard/sdk";
import type { Database } from "../src/db.js";
import type { SpendingLimitState } from "@spendguard/sdk";

const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RULE = 2;
const LEDGER = 100;

function state(partial: Partial<SpendingLimitState> = {}): SpendingLimitState {
  return {
    account: ACCOUNT,
    contextRuleId: RULE,
    cap: 10_000_000n,
    spentInWindow: 0n,
    windowLedgers: 17_280,
    windowStartedLedger: 0,
    utilizationPct: 0,
    ...partial,
  };
}

function setup(policyState: SpendingLimitState | Error) {
  const policyReader = {
    getSpendingLimitState: vi.fn(),
  } as unknown as PolicyReader;

  const db = {
    insertAlert: vi.fn().mockResolvedValue(undefined),
  } as unknown as Database;

  if (policyState instanceof Error) {
    policyReader.getSpendingLimitState.mockRejectedValue(policyState);
  } else {
    policyReader.getSpendingLimitState.mockResolvedValue(policyState);
  }

  const detector = new BreachDetector(policyReader, db, 90);
  return { policyReader, db, detector };
}

describe("BreachDetector.evaluateEvent", () => {
  it("raises a breach alert when spentInWindow >= cap", async () => {
    const { db, detector } = setup(
      state({ spentInWindow: 10_000_000n, utilizationPct: 100 }),
    );

    const alerts = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1_000_000n,
      triggerLedger: LEDGER,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: "breach",
      account: ACCOUNT,
      contextRuleId: RULE,
      eventAmount: 1_000_000n,
      totalSpentInWindow: 10_000_000n,
      cap: 10_000_000n,
      triggerLedger: LEDGER,
      webhookDelivered: false,
    });
    expect(db.insertAlert).toHaveBeenCalledTimes(1);
    expect(db.insertAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: "breach" }),
    );
  });

  it("raises a near-miss alert when spent >= 90% of cap (default threshold)", async () => {
    const { db, detector } = setup(
      state({ spentInWindow: 9_000_000n, utilizationPct: 90 }),
    );

    const alerts = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1_000_000n,
      triggerLedger: LEDGER,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.level).toBe("near_miss");
    expect(db.insertAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: "near_miss" }),
    );
  });

  it("does not raise an alert below the near-miss threshold", async () => {
    const { db, detector } = setup(
      state({ spentInWindow: 5_000_000n, utilizationPct: 50 }),
    );

    const alerts = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1_000_000n,
      triggerLedger: LEDGER,
    });

    expect(alerts).toEqual([]);
    expect(db.insertAlert).not.toHaveBeenCalled();
  });

  it("does not raise an alert when cap is zero", async () => {
    const { db, detector } = setup(state({ cap: 0n, spentInWindow: 1n }));

    const alerts = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1n,
      triggerLedger: LEDGER,
    });

    expect(alerts).toEqual([]);
    expect(db.insertAlert).not.toHaveBeenCalled();
  });

  it("generates deterministic alert IDs", async () => {
    const { detector } = setup(state({ spentInWindow: 10_000_000n }));

    const [a] = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1n,
      triggerLedger: LEDGER,
    });
    const [b] = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1n,
      triggerLedger: LEDGER,
    });

    expect(a?.id).toBe(b?.id);
    expect(a?.id).toMatch(/^alert_[0-9a-f]{16}$/);
  });

  it("swallows policy-read errors and returns no alerts", async () => {
    const { db, detector } = setup(new Error("RPC failure"));

    const alerts = await detector.evaluateEvent({
      account: ACCOUNT,
      contextRuleId: RULE,
      amountSpent: 1n,
      triggerLedger: LEDGER,
    });

    expect(alerts).toEqual([]);
    expect(db.insertAlert).not.toHaveBeenCalled();
  });
});
