/**
 * Policy state reader.
 *
 * Reads spending-limit state from the deployed `policy-view-helper`
 * contract via `simulateTransaction` (read-only — no submission).
 * The contract exposes:
 *   - get_spending_limit_state(account, context_rule_id) -> SpendingLimitView
 *   - get_version() -> u32
 *
 * The returned view is ledger-native (`windowLedgers`,
 * `windowStartedLedger`); see `ledger-window.ts` for the labelled estimates
 * the UI needs.
 *
 * All calls are read-only simulations; no transactions are signed or
 * submitted to the network.
 */

import { nativeToScVal, scValToNative, rpc } from "@stellar/stellar-sdk";

import { SorobanClient } from "./soroban-client.js";
import { decodeSpendingLimitView } from "./xdr-helpers.js";
import type { SpendingLimitState, SpendingLimitView } from "./types.js";

// ── Errors ────────────────────────────────────────────────────────────

export class PolicyReaderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PolicyReaderError";
  }
}

/** The helper's `PolicyViewError` arrives as `HostError: Error(Contract, #N)`. */
const CONTRACT_ERROR_PATTERN = /(^|\D)Error\(Contract,\s*#\d+\)/;

/**
 * The error string from a failed simulation is a headline plus a long
 * diagnostic-event log. Only the headline is the returned error; the rest is
 * safe to drop from a message a caller might put on screen.
 */
function errorHeadline(responseError: string): string {
  return (responseError.split("\n")[0] ?? "").trim();
}

// ── Reader ────────────────────────────────────────────────────────────

export class PolicyReader {
  private readonly client: SorobanClient;
  private readonly contractId: string;
  /** A known testnet source for read-only simulations. */
  private readonly simulationSource: string;

  constructor(
    client: SorobanClient,
    contractId: string,
    simulationSource: string,
  ) {
    this.client = client;
    this.contractId = contractId;
    this.simulationSource = simulationSource;
  }

  // ── Simulation error classification ─────────────────────────────────

  /**
   * Classify a failed simulation.
   *
   * `Error(Contract, #N)` is the helper deliberately refusing — no policy on
   * that rule, unknown account, unsupported context type — so "there is
   * nothing to show" is the correct reading.
   *
   * Every other host error (`Error(Object, InvalidInput)` for an address that
   * is not a contract, `Error(Storage, MissingValue)`, a VM trap) means the
   * call itself never ran. Coding those as `HOST_ERROR` keeps a broken
   * integration from presenting as an empty account.
   */
  private simulationError(
    response: rpc.Api.SimulateTransactionErrorResponse,
    functionName: string,
  ): PolicyReaderError {
    const headline = errorHeadline(String(response.error ?? ""));
    const code = CONTRACT_ERROR_PATTERN.test(headline)
      ? "CONTRACT_ERROR"
      : "HOST_ERROR";
    const source = code === "CONTRACT_ERROR" ? "Contract" : "Host";

    return new PolicyReaderError(
      `${source} error from ${functionName}: ${headline}`,
      code,
      response.error,
    );
  }

  // ── get_spending_limit_state ─────────────────────────────────────────

  /**
   * Fetch the current spending limit state for an account + context rule.
   *
   * @param account       - Smart-account contract address (C…). The helper
   *                        cross-calls into it, so a plain `G…` account
   *                        address is rejected by the host with
   *                        `Error(Object, InvalidInput)`.
   * @param contextRuleId - Context rule ID (u32).
   * @returns The decoded SpendingLimitView from the contract.
   *
   * @throws PolicyReaderError with code `CONTRACT_ERROR` when the helper
   *         answered with a `PolicyViewError` (absence), `HOST_ERROR` when the
   *         call itself failed, and `RPC_FAILURE` / `RESTORE_REQUIRED` /
   *         `NO_RESULT` / `NO_RETVAL` / `DECODE_ERROR` for other shapes.
   */
  async getSpendingLimitState(
    account: string,
    contextRuleId: number,
  ): Promise<SpendingLimitState> {
    const accountArg = nativeToScVal(account, { type: "address" });
    const ruleIdArg = nativeToScVal(contextRuleId, { type: "u32" });

    let response: rpc.Api.SimulateTransactionResponse;
    try {
      response = await this.client.simulateContract(
        this.simulationSource,
        this.contractId,
        "get_spending_limit_state",
        [accountArg, ruleIdArg],
      );
    } catch (err) {
      throw new PolicyReaderError(
        "RPC simulation failed for get_spending_limit_state",
        "RPC_FAILURE",
        err,
      );
    }

    if (rpc.Api.isSimulationError(response)) {
      throw this.simulationError(response, "get_spending_limit_state");
    }

    if (!rpc.Api.isSimulationSuccess(response)) {
      throw new PolicyReaderError(
        "Simulation returned restoration required response",
        "RESTORE_REQUIRED",
      );
    }

    const result = response.result;
    if (!result) {
      throw new PolicyReaderError(
        "Simulation returned no result",
        "NO_RESULT",
      );
    }

    const retVal = result.retval;
    if (!retVal) {
      throw new PolicyReaderError(
        "Simulation result has no retval",
        "NO_RETVAL",
      );
    }

    let view: SpendingLimitView;
    try {
      view = decodeSpendingLimitView(retVal);
    } catch (err) {
      throw new PolicyReaderError(
        "Failed to decode SpendingLimitView from ScVal",
        "DECODE_ERROR",
        err,
      );
    }

    const utilizationPct =
      view.cap > 0n
        ? Number((view.spentInWindow * 100n) / view.cap)
        : 0;

    return {
      account,
      contextRuleId,
      cap: view.cap,
      spentInWindow: view.spentInWindow,
      windowLedgers: view.windowLedgers,
      windowStartedLedger: view.windowStartedLedger,
      utilizationPct,
    };
  }

  // ── get_version ─────────────────────────────────────────────────────

  /**
   * Read the contract version.
   *
   * @returns Version number (u32).
   */
  async getVersion(): Promise<number> {
    let response: rpc.Api.SimulateTransactionResponse;
    try {
      response = await this.client.simulateContract(
        this.simulationSource,
        this.contractId,
        "get_version",
        [],
      );
    } catch (err) {
      throw new PolicyReaderError(
        "RPC simulation failed for get_version",
        "RPC_FAILURE",
        err,
      );
    }

    if (rpc.Api.isSimulationError(response)) {
      throw this.simulationError(response, "get_version");
    }

    if (!rpc.Api.isSimulationSuccess(response)) {
      throw new PolicyReaderError(
        "Simulation returned restoration required response",
        "RESTORE_REQUIRED",
      );
    }

    const retVal = response.result?.retval;
    if (!retVal) {
      throw new PolicyReaderError(
        "Simulation result has no retval",
        "NO_RETVAL",
      );
    }

    try {
      return Number(scValToNative(retVal));
    } catch (err) {
      throw new PolicyReaderError(
        "Failed to decode version from ScVal",
        "DECODE_ERROR",
        err,
      );
    }
  }
}
