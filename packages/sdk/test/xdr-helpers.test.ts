import { describe, it, expect } from "vitest";
import { xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";
import {
  addressToScVal,
  scValToAddress,
  u32ToScVal,
  scValToU32,
  i128ToScVal,
  scValToI128,
  u64ToScVal,
  scValToU64,
  decodeSpendingLimitView,
  decodeContractError,
} from "../src/xdr-helpers.js";

// A well-formed testnet public key (G…).
const TEST_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
// A well-formed contract id (C…).
const TEST_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("address helpers", () => {
  it("round-trips an address through ScVal", () => {
    const scv = addressToScVal(TEST_ADDRESS);
    expect(scv.switch()).toBe(xdr.ScValType.scvAddress());
    expect(scValToAddress(scv)).toBe(TEST_ADDRESS);
  });

  it("round-trips a contract address through ScVal", () => {
    const scv = addressToScVal(TEST_CONTRACT);
    expect(scValToAddress(scv)).toBe(TEST_CONTRACT);
  });
});

describe("numeric helpers", () => {
  it("round-trips u32", () => {
    expect(scValToU32(u32ToScVal(42))).toBe(42);
  });

  it("round-trips i128 values beyond Number.MAX_SAFE_INTEGER", () => {
    const big = 9_000_000_000_000_000_000n;
    expect(scValToI128(i128ToScVal(big))).toBe(big);
  });

  it("round-trips u64 values beyond Number.MAX_SAFE_INTEGER", () => {
    const big = 18_000_000_000_000_000_000n;
    expect(scValToU64(u64ToScVal(big))).toBe(big);
  });
});

describe("decodeSpendingLimitView", () => {
  // The key names below are not a guess at the contract's shape — they are the
  // field names in the deployed WASM's embedded spec, read from testnet:
  //
  //   stellar contract fetch \
  //     --rpc-url https://soroban-testnet.stellar.org \
  //     --network-passphrase "Test SDF Network ; September 2015" \
  //     --contract-id CCAM4NRAUB6SO3XLL2SRZQEHSOUYQGDKGNPCUIQ5KKI2S6QKWC2VN6NX \
  //     -o /tmp/helper.wasm
  //   strings -a /tmp/helper.wasm | grep -o "cap.*window_started_ledger"
  //   → …get_context_ruleget_spending_limit_datacapspent_in_windowwindow_ledgerswindow_started_ledger
  //
  // The ScMap keys a #[contracttype] struct serialises are exactly those names,
  // so this fixture mirrors the on-chain contract, not this test file's memory
  // of it.
  function buildView(opts: {
    cap: bigint;
    spentInWindow: bigint;
    windowLedgers: number;
    windowStartedLedger: number;
  }): xdr.ScVal {
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("cap"),
        val: nativeToScVal(opts.cap, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("spent_in_window"),
        val: nativeToScVal(opts.spentInWindow, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_ledgers"),
        val: nativeToScVal(opts.windowLedgers, { type: "u32" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_started_ledger"),
        val: nativeToScVal(opts.windowStartedLedger, { type: "u32" }),
      }),
    ]);
  }

  const deployed = {
    cap: 10_000_000n,
    spentInWindow: 2_500_000n,
    windowLedgers: 17_280,
    windowStartedLedger: 123_456_789,
  };

  it("decodes the map the deployed contract returns", () => {
    const view = decodeSpendingLimitView(buildView(deployed));
    expect(view).toEqual({
      cap: 10_000_000n,
      spentInWindow: 2_500_000n,
      windowLedgers: 17_280,
      windowStartedLedger: 123_456_789,
    });
  });

  it("reads a window length as a ledger count, not a duration", () => {
    const view = decodeSpendingLimitView(buildView({ ...deployed, windowLedgers: 1 }));
    expect(view.windowLedgers).toBe(1);
    expect(typeof view.windowLedgers).toBe("number");
  });

  it("keeps 0 as the contract's \"no spending history yet\" encoding", () => {
    const view = decodeSpendingLimitView(buildView({ ...deployed, windowStartedLedger: 0 }));
    expect(view.windowStartedLedger).toBe(0);
  });

  // The decoder used to require `window_seconds` / `window_started_at` — keys
  // the contract stopped emitting when it dropped its invented 5x ledger→
  // seconds conversion (spendguard-contract b4bd728). Every live read failed
  // with that mismatch while these tests still passed, because they built the
  // map from the decoder's own assumption. This pins the shape from the
  // outside instead.
  it("rejects the pre-b4bd728 key names instead of decoding them", () => {
    const stale = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("cap"),
        val: nativeToScVal(deployed.cap, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("spent_in_window"),
        val: nativeToScVal(deployed.spentInWindow, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_seconds"),
        val: nativeToScVal(17_280n, { type: "u64" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_started_at"),
        val: nativeToScVal(1_780_000_000n, { type: "u64" }),
      }),
    ]);
    expect(() => decodeSpendingLimitView(stale)).toThrow(
      /missing one or more required fields/,
    );
  });

  it("throws when a required key is missing", () => {
    const incomplete = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("cap"),
        val: nativeToScVal(1n, { type: "i128" }),
      }),
    ]);
    expect(() => decodeSpendingLimitView(incomplete)).toThrow(
      /missing one or more required fields/,
    );
  });

  it("throws when the ScVal is not a map", () => {
    expect(() => decodeSpendingLimitView(nativeToScVal(1n, { type: "i128" }))).toThrow(
      /is not a map/,
    );
  });
});

describe("decodeContractError", () => {
  function contractError(code: number): xdr.ScVal {
    // xdr.ScError.sceContract(code) builds a contract error with that code.
    return xdr.ScVal.scvError(xdr.ScError.sceContract(code));
  }

  it("maps known contract error codes", () => {
    expect(decodeContractError(contractError(1))).toBe("NoSpendingLimitPolicyInstalled");
    expect(decodeContractError(contractError(2))).toBe("AccountNotFound");
    expect(decodeContractError(contractError(3))).toBe("UnsupportedContextType");
  });

  it("returns UnknownContractError for unrecognised codes", () => {
    expect(decodeContractError(contractError(99))).toBe("UnknownContractError");
  });

  it("returns UnknownContractError for non-error ScVals", () => {
    expect(decodeContractError(nativeToScVal(1n, { type: "i128" }))).toBe(
      "UnknownContractError",
    );
  });
});
