import { describe, it, expect } from "vitest";
import {
  ESTIMATED_LEDGER_CLOSE_SECONDS,
  estimateWindowSeconds,
  estimateLedgerCloseTime,
} from "../src/ledger-window.js";

describe("estimateWindowSeconds", () => {
  it("sizes the 17,280-ledger default window at ~24 h", () => {
    expect(estimateWindowSeconds(17_280)).toBe(86_400);
  });

  it("scales with an explicit close interval", () => {
    expect(estimateWindowSeconds(1_000, 10)).toBe(10_000);
  });

  it("treats a zero-width window as zero, not undefined", () => {
    expect(estimateWindowSeconds(0)).toBe(0);
  });
});

describe("estimateLedgerCloseTime", () => {
  const latest = { ledger: 1_000_050, closedAtSeconds: 1_780_000_500 };

  it("anchors the latest ledger on its own close time", () => {
    expect(estimateLedgerCloseTime(1_000_050, latest)).toBe(1_780_000_500);
  });

  it("steps back by the ledger gap", () => {
    expect(estimateLedgerCloseTime(1_000_040, latest)).toBe(
      1_780_000_500 - 10 * ESTIMATED_LEDGER_CLOSE_SECONDS,
    );
  });

  // 0 is the contract's encoding of "this window has no spending history",
  // not a ledger that closed at the birth of the chain. Guessing a timestamp
  // for it would put a fabricated date on the dashboard.
  it("returns null for the empty-window sentinel", () => {
    expect(estimateLedgerCloseTime(0, latest)).toBeNull();
  });

  it("places a future ledger after the anchor", () => {
    expect(estimateLedgerCloseTime(1_000_060, latest)).toBe(1_780_000_550);
  });
});
