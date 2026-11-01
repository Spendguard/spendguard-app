import { describe, it, expect, vi } from "vitest";
import { xdr, nativeToScVal, type rpc } from "@stellar/stellar-sdk";
import { PolicyReader, PolicyReaderError } from "../src/policy-reader.js";
import type { SorobanClient } from "../src/soroban-client.js";

const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * The map the deployed `policy-view-helper` returns — `window_ledgers` and
 * `window_started_ledger` as u32, read off the contract's embedded spec (see
 * the comment in `xdr-helpers.test.ts` for the fetch command).
 */
function spendingLimitViewScv(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("cap"),
      val: nativeToScVal(10_000_000n, { type: "i128" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spent_in_window"),
      val: nativeToScVal(5_000_000n, { type: "i128" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("window_ledgers"),
      val: nativeToScVal(17_280, { type: "u32" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("window_started_ledger"),
      val: nativeToScVal(987_654_321, { type: "u32" }),
    }),
  ]);
}

/** Build a mock SorobanClient whose simulateContract returns `response`. */
function mockClient(
  simulateContract: ReturnType<typeof vi.fn>,
): SorobanClient {
  return { simulateContract } as unknown as SorobanClient;
}

describe("PolicyReader.getSpendingLimitState", () => {
  it("decodes a successful simulation into a SpendingLimitState", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: { retval: spendingLimitViewScv() },
      latestLedger: 1234,
    } as unknown as rpc.Api.SimulateTransactionResponse);

    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);
    const state = await reader.getSpendingLimitState(ACCOUNT, 3);

    expect(state).toMatchObject({
      account: ACCOUNT,
      contextRuleId: 3,
      cap: 10_000_000n,
      spentInWindow: 5_000_000n,
      windowLedgers: 17_280,
      windowStartedLedger: 987_654_321,
      utilizationPct: 50,
    });
    // simulateContract must receive the account + rule args as ScVals
    const [, , fn, args] = simulate.mock.calls[0] as [string, string, string, xdr.ScVal[]];
    expect(fn).toBe("get_spending_limit_state");
    expect(args).toHaveLength(2);
  });

  it("maps RPC failures to PolicyReaderError(RPC_FAILURE)", async () => {
    const simulate = vi.fn().mockRejectedValue(new Error("network down"));
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "RPC_FAILURE",
    });
  });

  // Both strings below are copied from a live `simulateTransaction` against
  // the deployed helper on testnet:
  //   get_spending_limit_state(C…-with-no-contract, 1) -> Error(Contract, #2)
  //   get_spending_limit_state(G…-plain-account, 1)    -> Error(Object, InvalidInput)
  // Classifying the second as absence would hide a broken integration behind
  // an "no policy configured" empty state.
  it("maps a PolicyViewError to PolicyReaderError(CONTRACT_ERROR)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      error:
        "HostError: Error(Contract, #2)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CCAM4NRAU..., topics:[error, Error(Contract, #2)], data:\"escalating Ok(ScErrorType::Contract) frame-exit to Err\"\n",
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(CONTRACT, 0)).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
    });
  });

  it("maps a non-contract host error to PolicyReaderError(HOST_ERROR)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      error:
        "HostError: Error(Object, InvalidInput)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CCAM4NRAU..., topics:[error, Error(Object, InvalidInput)], data:\"not a contract address\"\n",
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "HOST_ERROR",
    });
  });

  it("quotes only the headline of a host error, not the diagnostic log", async () => {
    const simulate = vi.fn().mockResolvedValue({
      error: "HostError: Error(WasmVM, Runtime)\n   0: long diagnostic line\n   1: another",
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    const err = await reader
      .getSpendingLimitState(ACCOUNT, 0)
      .then(() => null)
      .catch((e: unknown) => e as PolicyReaderError);

    expect(err?.message).toBe(
      "Host error from get_spending_limit_state: HostError: Error(WasmVM, Runtime)",
    );
    // The full response error stays available for logs.
    expect(String(err?.cause)).toContain("another");
  });

  it("maps restore-required responses to PolicyReaderError(RESTORE_REQUIRED)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      // No `error` (so not an error) and no `transactionData` (so not a success)
      restorePreamble: {},
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "RESTORE_REQUIRED",
    });
  });

  it("maps a missing result to PolicyReaderError(NO_RESULT)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: undefined,
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "NO_RESULT",
    });
  });

  it("maps a missing retval to PolicyReaderError(NO_RETVAL)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: {},
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "NO_RETVAL",
    });
  });

  it("maps a malformed retval to PolicyReaderError(DECODE_ERROR)", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: { retval: nativeToScVal(1n, { type: "i128" }) },
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 0)).rejects.toMatchObject({
      code: "DECODE_ERROR",
    });
  });

  it("computes utilizationPct as 0 when the cap is zero", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: {
        retval: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("cap"),
            val: nativeToScVal(0n, { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("spent_in_window"),
            val: nativeToScVal(0n, { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("window_ledgers"),
            val: nativeToScVal(17_280, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("window_started_ledger"),
            val: nativeToScVal(0, { type: "u32" }),
          }),
        ]),
      },
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    const state = await reader.getSpendingLimitState(ACCOUNT, 0);
    expect(state.utilizationPct).toBe(0);
    expect(state.windowStartedLedger).toBe(0);
  });

  // The shape this reader decodes changed on-chain in spendguard-contract
  // b4bd728 (`window_seconds`/`window_started_at` → `window_ledgers`/
  // `window_started_ledger`), and the SDK did not follow. Every live read
  // failed while callers reported "no policy". A stale-shape retval must be a
  // DECODE_ERROR the caller can distinguish from a contract error — never a
  // zeroed state.
  it("reports a pre-b4bd728 retval as DECODE_ERROR rather than a zeroed state", async () => {
    const staleShape = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("cap"),
        val: nativeToScVal(10_000_000n, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("spent_in_window"),
        val: nativeToScVal(5_000_000n, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_seconds"),
        val: nativeToScVal(17_280n, { type: "u64" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("window_started_at"),
        val: nativeToScVal(987_654_321n, { type: "u64" }),
      }),
    ]);
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: { retval: staleShape },
      latestLedger: 5,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getSpendingLimitState(ACCOUNT, 1)).rejects.toMatchObject({
      code: "DECODE_ERROR",
    });
  });
});

describe("PolicyReader.getVersion", () => {
  it("decodes a successful version", async () => {
    const simulate = vi.fn().mockResolvedValue({
      transactionData: {},
      result: { retval: nativeToScVal(7, { type: "u32" }) },
      latestLedger: 10,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getVersion()).resolves.toBe(7);
  });

  it("maps RPC failures to PolicyReaderError(RPC_FAILURE)", async () => {
    const simulate = vi.fn().mockRejectedValue(new Error("boom"));
    const reader = new PolicyReader(mockClient(simulate), CONTRACT, SOURCE);

    await expect(reader.getVersion()).rejects.toMatchObject({ code: "RPC_FAILURE" });
  });
});
