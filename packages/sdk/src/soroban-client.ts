/**
 * Soroban RPC client wrapper.
 *
 * Provides typed helpers over @stellar/stellar-sdk's Server class for
 * event ingestion and contract state queries. All calls are read-only;
 * no transactions are submitted or signed here.
 *
 * RPC providers retain events for approximately 7 days. This service
 * MUST run continuously and persist a ledger cursor to avoid data loss
 * after downtime exceeding the retention window.
 */

import {
  Contract,
  TransactionBuilder,
  scValToNative,
  xdr,
  rpc,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

import type { RawContractEvent } from "./types.js";

// ── Configuration ─────────────────────────────────────────────────────

export interface SorobanClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

// ── Event filter ──────────────────────────────────────────────────────

export interface ContractEventFilter {
  type: "contract" | "system";
  contractIds?: string[];
  topics?: string[][];
}

export interface GetEventsOptions {
  startLedger: number;
  filters: ContractEventFilter[];
  maxEvents?: number;
}

// ── Event normalization ───────────────────────────────────────────────

/**
 * Turn one RPC event record into the shape the indexer decodes.
 *
 * Kept as a standalone pure function so a captured chain record can be pushed
 * through the exact same path in a test, with no server involved.
 */
export function normalizeContractEvent(entry: rpc.Api.EventResponse): RawContractEvent {
  // Decode topic segments: v16 SDK returns them as xdr.ScVal[]
  const topics: string[] = entry.topic.map((scv: xdr.ScVal) => String(scValToNative(scv)));

  // Preserve the raw base64 XDR of the event value so consumers can
  // decode the exact ScVal shape (i128, map, etc.). v16 SDK returns
  // entry.value as xdr.ScVal; scValToNative would flatten maps and
  // lose type information, so we keep the raw encoding.
  let valueStr = "";
  try {
    valueStr = entry.value.toXDR("base64");
  } catch {
    valueStr = "";
  }

  return {
    id: entry.id,
    ledger: entry.ledger,
    topic: topics,
    value: valueStr,
    contractId: entry.contractId?.toString() ?? "",
    timestamp: entry.ledgerClosedAt
      ? Math.floor(new Date(entry.ledgerClosedAt).getTime() / 1000)
      : null,
  };
}

// ── Client ────────────────────────────────────────────────────────────

export class SorobanClient {
  readonly server: Server;
  readonly networkPassphrase: string;

  constructor(config: SorobanClientConfig) {
    this.server = new Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
    this.networkPassphrase = config.networkPassphrase;
  }

  // ── Event ingestion ─────────────────────────────────────────────────

  /**
   * Fetch contract events from a given ledger cursor forward.
   */
  async getEvents(
    opts: GetEventsOptions,
  ): Promise<{
    events: RawContractEvent[];
    latestLedger: number;
    cursor: string | null;
  }> {
    const response: rpc.Api.GetEventsResponse = await this.server.getEvents({
      startLedger: opts.startLedger,
      filters: opts.filters,
      limit: opts.maxEvents ?? 100,
    });

    const events: RawContractEvent[] = response.events.map(normalizeContractEvent);

    return {
      events,
      // The cursor must track the RPC's own latestLedger, not the highest
      // ledger seen in the returned events. When zero events match (the
      // common idle case) an events-derived value would never advance past
      // startLedger, leaving the persisted cursor stuck and re-scanning the
      // same window on every poll.
      latestLedger: response.latestLedger,
      cursor: response.cursor ?? null,
    };
  }

  // ── Ledger info ─────────────────────────────────────────────────────

  /** Fetch the latest ledger sequence number. */
  async getLatestLedger(): Promise<number> {
    const info = await this.server.getLatestLedger();
    return info.sequence;
  }

  // ── Read-only contract simulation ───────────────────────────────────

  /**
   * Simulate a read-only contract invocation.
   *
   * Builds a minimal invokeHostFunction transaction, simulates it (no
   * submission), and returns the response.
   *
   * @param source       - Source account public key (G…). Must exist on network.
   * @param contractId   - Deployed contract ID (C…).
   * @param functionName - Contract function to call.
   * @param args         - ScVal arguments to the function.
   */
  async simulateContract(
    source: string,
    contractId: string,
    functionName: string,
    args: xdr.ScVal[],
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    const account = await this.server.getAccount(source);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(functionName, ...args))
      .setTimeout(0)
      .build();

    return this.server.simulateTransaction(tx);
  }
}
