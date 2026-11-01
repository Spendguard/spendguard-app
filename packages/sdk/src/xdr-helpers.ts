/**
 * XDR encoding / decoding helpers for Soroban contract interactions.
 *
 * This module wraps @stellar/stellar-sdk's nativeToScVal / scValToNative
 * to provide strongly-typed helpers for the SpendGuard domain types.
 * We do NOT hand-roll XDR byte manipulation.
 */

import { nativeToScVal, scValToNative, xdr, Address } from "@stellar/stellar-sdk";
import type { SpendingLimitView } from "./types.js";

// ── Address helpers ───────────────────────────────────────────────────

/** Encode a Stellar public key (G…) as an ScVal address. */
export function addressToScVal(accountId: string): xdr.ScVal {
  return Address.fromString(accountId).toScVal();
}

/** Decode an ScVal address back to a G… string. */
export function scValToAddress(scv: xdr.ScVal): string {
  return Address.fromScVal(scv).toString();
}

// ── u32 helpers ───────────────────────────────────────────────────────

export function u32ToScVal(val: number): xdr.ScVal {
  return nativeToScVal(val, { type: "u32" });
}

export function scValToU32(scv: xdr.ScVal): number {
  return Number(scValToNative(scv));
}

// ── i128 helpers ──────────────────────────────────────────────────────

export function i128ToScVal(val: bigint): xdr.ScVal {
  return nativeToScVal(val, { type: "i128" });
}

export function scValToI128(scv: xdr.ScVal): bigint {
  return BigInt(scValToNative(scv) as number | bigint);
}

// ── u64 helpers ───────────────────────────────────────────────────────

export function u64ToScVal(val: bigint): xdr.ScVal {
  return nativeToScVal(val, { type: "u64" });
}

export function scValToU64(scv: xdr.ScVal): bigint {
  return BigInt(scValToNative(scv) as number | bigint);
}

// ── SpendingLimitView decoder ────────────────────────────────────────

/**
 * Decode the ScMap returned by `get_spending_limit_state`.
 *
 * The four keys are the field names in the deployed contract's embedded spec
 * (`strings -a helper.wasm | grep window_ledgers`): `cap` and
 * `spent_in_window` are i128 stroops, `window_ledgers` and
 * `window_started_ledger` are u32 ledger counts / sequences.
 *
 * Any missing key throws rather than defaulting to zero: a contract that
 * renamed a field must fail loudly here, not quietly report an empty window.
 */
export function decodeSpendingLimitView(scv: xdr.ScVal): SpendingLimitView {
  // Guard on the switch first: calling scv.map() on a non-map ScVal throws
  // a terse SDK error ("map not set") instead of returning undefined.
  if (scv.switch() !== xdr.ScValType.scvMap()) {
    throw new Error("SpendingLimitView ScVal is not a map");
  }
  const map = scv.map();
  if (!map) {
    throw new Error("SpendingLimitView ScVal is not a map");
  }

  const getEntry = (
    key: string,
  ): xdr.ScVal | undefined => {
    return map.find(
      (e: xdr.ScMapEntry) =>
        scValToNative(e.key()) === key,
    )?.val();
  };

  const capEntry = getEntry("cap");
  const spentInWindowEntry = getEntry("spent_in_window");
  const windowLedgersEntry = getEntry("window_ledgers");
  const windowStartedLedgerEntry = getEntry("window_started_ledger");

  if (
    !capEntry ||
    !spentInWindowEntry ||
    !windowLedgersEntry ||
    !windowStartedLedgerEntry
  ) {
    throw new Error(
      "SpendingLimitView ScMap is missing one or more required fields " +
        "(expected cap, spent_in_window, window_ledgers, window_started_ledger)",
    );
  }

  const windowLedgers = scValToU32(windowLedgersEntry);
  const windowStartedLedger = scValToU32(windowStartedLedgerEntry);
  for (const [name, value] of [
    ["window_ledgers", windowLedgers],
    ["window_started_ledger", windowStartedLedger],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `SpendingLimitView.${name} is not a u32 ledger value (got ${value})`,
      );
    }
  }

  return {
    cap: scValToI128(capEntry),
    spentInWindow: scValToI128(spentInWindowEntry),
    windowLedgers,
    windowStartedLedger,
  };
}

// ── Error decoding ────────────────────────────────────────────────────

export type ContractErrorCode =
  | "NoSpendingLimitPolicyInstalled"
  | "AccountNotFound"
  | "UnsupportedContextType"
  | "UnknownContractError";

const ERROR_MAP: Record<number, ContractErrorCode> = {
  1: "NoSpendingLimitPolicyInstalled",
  2: "AccountNotFound",
  3: "UnsupportedContextType",
};

/** Decode a contract error ScVal into a human-readable name. */
export function decodeContractError(scv: xdr.ScVal): ContractErrorCode {
  if (scv.switch() !== xdr.ScValType.scvError()) {
    return "UnknownContractError";
  }
  const scError = scv.value() as xdr.ScError;
  // contractCode() returns the numeric error code for contract errors
  const code = scError.contractCode();
  return ERROR_MAP[code] ?? "UnknownContractError";
}
