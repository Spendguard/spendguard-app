import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { xdr, nativeToScVal, scValToNative, Address } from "@stellar/stellar-sdk";
import {
  decodeSettlementEvent,
  decodeTransferAmount,
  decodeSpendingLimitEnforced,
} from "../src/event-poller.js";
import { normalizeContractEvent, type RawContractEvent } from "@spendguard/sdk";

// Real testnet values used across the app.
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const FROM = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHT";
const SMART_ACCOUNT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABF4";

// ── XDR builders (real encodings via @stellar/stellar-sdk) ────────────

/** SEP-41 transfer event value: single-value i128 amount format. */
function transferAmountI128Scv(amount: bigint): string {
  return nativeToScVal(amount, { type: "i128" }).toXDR("base64");
}

/** SEP-41 transfer event value: map { amount: i128, to_muxed_id } format. */
function transferAmountMapScv(amount: bigint): string {
  const scv = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount"),
      val: nativeToScVal(amount, { type: "i128" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("to_muxed_id"),
      val: xdr.ScVal.scvVoid(),
    }),
  ]);
  return scv.toXDR("base64");
}

/** OZ spending_limit_enforced event value: map with the 4 data fields. */
function spendingLimitEnforcedScv(opts: {
  contextRuleId: number;
  amount: bigint;
  totalSpentInPeriod: bigint;
}): string {
  const scv = xdr.ScVal.scvMap([
    // `context` is a soroban_sdk::auth::Context enum (ContractContext) — the
    // decoder ignores it, so a plausible map stands in for the real value.
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context"),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("contract"),
      // Address.fromString() cannot parse C… contract strkeys in this SDK
      // version; the decoder ignores `context`, so a plain string suffices.
      val: xdr.ScVal.scvString(SMART_ACCOUNT),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("fn_name"),
          val: xdr.ScVal.scvSymbol("spend"),
        }),
      ]),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_id"),
      val: nativeToScVal(opts.contextRuleId, { type: "u32" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount"),
      val: nativeToScVal(opts.amount, { type: "i128" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("total_spent_in_period"),
      val: nativeToScVal(opts.totalSpentInPeriod, { type: "i128" }),
    }),
  ]);
  return scv.toXDR("base64");
}

function transferEvent(opts: {
  value: string;
  from?: string;
  to?: string;
  contractId?: string;
  id?: string;
}): RawContractEvent {
  return {
    id: opts.id ?? "evt-transfer-1",
    ledger: 12345,
    topic: ["transfer", opts.from ?? FROM, opts.to ?? TO],
    value: opts.value,
    contractId: opts.contractId ?? USDC_TESTNET,
    timestamp: 1700000000,
  };
}

function spendingLimitEvent(opts: {
  value: string;
  smartAccount?: string;
  contractId?: string;
}): RawContractEvent {
  return {
    id: "evt-sl-1",
    ledger: 12346,
    topic: ["spending_limit_enforced", opts.smartAccount ?? SMART_ACCOUNT],
    value: opts.value,
    contractId: opts.contractId ?? SMART_ACCOUNT,
    timestamp: 1700000000,
  };
}

// ── decodeTransferAmount ──────────────────────────────────────────────

describe("decodeTransferAmount", () => {
  it("decodes the SEP-41 single-value i128 format", () => {
    expect(decodeTransferAmount(transferAmountI128Scv(5_000_000n))).toBe(5_000_000n);
  });

  it("decodes the SEP-41 map { amount } format", () => {
    expect(decodeTransferAmount(transferAmountMapScv(12_345_678n))).toBe(12_345_678n);
  });

  it("returns null for empty or invalid XDR", () => {
    expect(decodeTransferAmount("")).toBeNull();
    expect(decodeTransferAmount("not-base64!!")).toBeNull();
  });

  it("returns null for a non-amount ScVal (e.g. an address)", () => {
    const addressScv = Address.fromString(FROM).toScVal().toXDR("base64");
    expect(decodeTransferAmount(addressScv)).toBeNull();
  });
});

// ── decodeSpendingLimitEnforced ───────────────────────────────────────

describe("decodeSpendingLimitEnforced", () => {
  it("decodes context_rule_id and amount from the OZ data map", () => {
    const decoded = decodeSpendingLimitEnforced(
      spendingLimitEnforcedScv({ contextRuleId: 7, amount: 250_000n, totalSpentInPeriod: 250_000n }),
    );
    expect(decoded).toEqual({ contextRuleId: 7, amount: 250_000n });
  });

  it("returns null for non-map values", () => {
    expect(decodeSpendingLimitEnforced(transferAmountI128Scv(1n))).toBeNull();
  });

  it("returns null when required keys are missing", () => {
    const partial = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: nativeToScVal(1n, { type: "i128" }),
      }),
    ]).toXDR("base64");
    expect(decodeSpendingLimitEnforced(partial)).toBeNull();
  });
});

// ── decodeSettlementEvent ─────────────────────────────────────────────

describe("decodeSettlementEvent", () => {
  it("decodes a transfer from a monitored account with its context rule", () => {
    const raw = transferEvent({ value: transferAmountI128Scv(5_000_000n) });
    const ruleByAccount = new Map<string, number>([[FROM, 3]]);

    const decoded = decodeSettlementEvent(raw, ruleByAccount);

    expect(decoded).toMatchObject({
      id: raw.id,
      ledger: raw.ledger,
      account: FROM,
      sourceContractId: USDC_TESTNET,
      amountSpent: 5_000_000n,
      contextRuleId: 3,
      reference: TO,
    });
  });

  it("decodes a transfer using the map data format", () => {
    const raw = transferEvent({ value: transferAmountMapScv(99_000n) });
    const decoded = decodeSettlementEvent(raw, new Map<string, number>([[FROM, 1]]));
    expect(decoded?.amountSpent).toBe(99_000n);
  });

  it("skips transfers from accounts that are not monitored", () => {
    const raw = transferEvent({ value: transferAmountI128Scv(5_000_000n) });
    expect(decodeSettlementEvent(raw, new Map<string, number>())).toBeNull();
  });

  it("skips transfers whose amount cannot be decoded", () => {
    const raw = transferEvent({ value: "garbage" });
    expect(decodeSettlementEvent(raw, new Map<string, number>([[FROM, 3]]))).toBeNull();
  });

  it("decodes an OZ spending_limit_enforced event directly", () => {
    const raw = spendingLimitEvent({
      value: spendingLimitEnforcedScv({
        contextRuleId: 5,
        amount: 900_000n,
        totalSpentInPeriod: 900_000n,
      }),
    });
    const decoded = decodeSettlementEvent(raw, new Map<string, number>());

    expect(decoded).toMatchObject({
      id: raw.id,
      ledger: raw.ledger,
      account: SMART_ACCOUNT,
      sourceContractId: SMART_ACCOUNT,
      amountSpent: 900_000n,
      contextRuleId: 5,
      reference: null,
    });
  });

  it("skips events that are neither transfer nor spending_limit_enforced", () => {
    const raw: RawContractEvent = {
      id: "evt-approve",
      ledger: 1,
      topic: ["approve", FROM, TO],
      value: transferAmountI128Scv(1n),
      contractId: USDC_TESTNET,
      timestamp: null,
    };
    expect(decodeSettlementEvent(raw, new Map<string, number>([[FROM, 1]]))).toBeNull();
  });

  it("skips transfer events with too few topics", () => {
    const raw: RawContractEvent = {
      id: "evt-short",
      ledger: 1,
      topic: ["transfer", FROM],
      value: transferAmountI128Scv(1n),
      contractId: USDC_TESTNET,
      timestamp: null,
    };
    expect(decodeSettlementEvent(raw, new Map<string, number>([[FROM, 1]]))).toBeNull();
  });

  it("skips spending_limit_enforced events missing the smart_account topic", () => {
    const raw: RawContractEvent = {
      id: "evt-sl-short",
      ledger: 1,
      topic: ["spending_limit_enforced"],
      value: spendingLimitEnforcedScv({ contextRuleId: 1, amount: 1n, totalSpentInPeriod: 1n }),
      contractId: SMART_ACCOUNT,
      timestamp: null,
    };
    expect(decodeSettlementEvent(raw, new Map<string, number>())).toBeNull();
  });
});

// ── Real on-chain golden fixtures ─────────────────────────────────────
//
// Two generations of fixtures live here:
//
// 1. The one below, captured while the SDF testnet was idle (2026-07-31): a
//    real event (contract CCKRLPKII3U47ACRGYVSNT3ZZ5AA3N63HYDIQEFTWSPWLSIAEXI2XPIB,
//    ledger 3781099) whose VALUE is a genuine base64 ScVal map with an `amount`
//    key — the SEP-41 map branch of decodeTransferAmount — but whose topic shape
//    is NOT SEP-41 (single ["transfer"] topic). It pins value decoding, and that
//    a non-settlement event is skipped rather than mis-attributed.
//
// 2. `fixtures/testnet-usdc-transfers.json`, captured on 2026-11-01 once Circle
//    testnet USDC (CBIELTK6Y…) had real traffic: three SEP-41 transfer events
//    straight from getEvents, ledger and XDR included. Those exercise the topic
//    path the fixture below could not. See the describe block at the end of this
//    file.

const REAL_TESTNET_TRANSFER_VALUE =
  "AAAAEQAAAAEAAAADAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAATB62AAAADwAAAARmcm9tAAAAAQAAAA8AAAACdG8AAAAAABIAAAAAAAAAALQ+5OBjUvO04LbH1YkMWDu4sRey2ydDbmscUz4p7ds3";
const REAL_TESTNET_TRANSFER_CONTRACT =
  "CCKRLPKII3U47ACRGYVSNT3ZZ5AA3N63HYDIQEFTWSPWLSIAEXI2XPIB";

// Amount decoded from the real event value by scValToNative (0x4C1EB6).
const REAL_TESTNET_TRANSFER_AMOUNT = 4988598n;

describe("golden fixture: real event value (2026-07 idle-testnet capture)", () => {
  it("decodes a real on-chain transfer VALUE (map format with amount)", () => {
    expect(decodeTransferAmount(REAL_TESTNET_TRANSFER_VALUE)).toBe(
      REAL_TESTNET_TRANSFER_AMOUNT,
    );
  });

  it("rejects the real non-SEP-41-shaped event (single-topic) gracefully", () => {
    const raw: RawContractEvent = {
      id: "evt-real-1",
      ledger: 3781099,
      topic: ["transfer"],
      value: REAL_TESTNET_TRANSFER_VALUE,
      contractId: REAL_TESTNET_TRANSFER_CONTRACT,
      timestamp: null,
    };
    expect(decodeSettlementEvent(raw, new Map<string, number>())).toBeNull();
  });
});

// ── Captured chain records, run through the real ingestion path ───────

type CapturedEvent = {
  type: "contract";
  ledger: number;
  ledgerClosedAt: string;
  id: string;
  operationIndex: number;
  transactionIndex: number;
  txHash: string;
  /** base64 ScVal per topic, exactly as the RPC sent them */
  topic: string[];
  /** base64 ScVal */
  value: string;
  contractId: string;
};

const capturedFixture = JSON.parse(
  readFileSync(new URL("./fixtures/testnet-usdc-transfers.json", import.meta.url), "utf8"),
) as {
  provenance: { contractId: string; asset: string; capturedAt: string };
  events: CapturedEvent[];
};

/**
 * Push a captured RPC record through `normalizeContractEvent` — the same
 * conversion `SorobanClient.getEvents` performs — without a server.
 */
function normalize(entry: CapturedEvent): RawContractEvent {
  return normalizeContractEvent({
    ...entry,
    topic: entry.topic.map((t) => xdr.ScVal.fromXDR(t, "base64")),
    value: xdr.ScVal.fromXDR(entry.value, "base64"),
    // The SDK yields an ScAddress here and only ever calls `.toString()` on it.
    contractId: entry.contractId as unknown as Address,
  } as unknown as Parameters<typeof normalizeContractEvent>[0]);
}

const [WALLET_TO_CONTRACT, MUXED_I128, MUXED_MAP] = capturedFixture.events;
const CAPTURED_CONTRACT = capturedFixture.provenance.contractId;

const CAPTURED_SENDER = "GBDCULE53LUPK4XHUCXBI35MAZFQHENMZ3JRKAJS2PPYBV646M6XKVHG";
const CAPTURED_RECEIVE_CONTRACT = "CAVICL644SJP472RBLELX2BLIXBXWPRKQL4N3E7S3YZR4BB3ERJC4XTY";
const CAPTURED_MUXED_SENDER = "LBGND5W67ORDP3WLYX7P4JM7RHV4JNPN2SIRNPVVKNWEANH4JDLD7Q7I";
const CAPTURED_WALLET = "GAVNBQ77LZVBWRZ5AWHGINDFHZ63QZB335H7JKTTTCRPEIFCRMSHRSBY";
const CAPTURED_AT = Math.floor(Date.parse("2026-10-27T12:02:50Z") / 1000);

describe("golden fixtures: real testnet USDC transfer events (captured 2026-11-01)", () => {
  it("decodes the four SEP-41 topics the RPC actually sends", () => {
    const raw = normalize(WALLET_TO_CONTRACT);

    expect(raw.topic).toEqual([
      "transfer",
      CAPTURED_SENDER,
      CAPTURED_RECEIVE_CONTRACT,
      capturedFixture.provenance.asset,
    ]);
    expect(raw.id).toBe("0023260653816963072-0000000001");
    expect(raw.ledger).toBe(5415793);
    expect(raw.contractId).toBe(CAPTURED_CONTRACT);
    expect(raw.timestamp).toBe(CAPTURED_AT);
    // The value survives normalization byte for byte. scValToNative would have
    // flattened it, and the amount decoder needs the original ScVal shape.
    expect(raw.value).toBe(WALLET_TO_CONTRACT.value);
  });

  it("turns a captured transfer into a settlement event", () => {
    const settlement = decodeSettlementEvent(
      normalize(WALLET_TO_CONTRACT),
      new Map([[CAPTURED_SENDER, 1]]),
    );

    expect(settlement).toEqual({
      id: "0023260653816963072-0000000001",
      ledger: 5415793,
      timestamp: CAPTURED_AT,
      account: CAPTURED_SENDER,
      sourceContractId: CAPTURED_CONTRACT,
      amountSpent: 946360n,
      contextRuleId: 1,
      reference: CAPTURED_RECEIVE_CONTRACT,
    });
  });

  it("still ignores a captured transfer whose sender is not monitored", () => {
    expect(decodeSettlementEvent(normalize(WALLET_TO_CONTRACT), new Map())).toBeNull();
  });

  it("reads both SEP-41 value formats of one real settlement", () => {
    // A single transaction emitted both legs: the outgoing one with a plain
    // i128 amount, the incoming one as the map format carrying `to_muxed_id`.
    expect(MUXED_I128.txHash).toBe(MUXED_MAP.txHash);
    expect(decodeTransferAmount(MUXED_I128.value)).toBe(1578241808n);
    expect(decodeTransferAmount(MUXED_MAP.value)).toBe(1578241808n);

    const mapValue = scValToNative(xdr.ScVal.fromXDR(MUXED_MAP.value, "base64")) as {
      amount: bigint;
      to_muxed_id: string;
    };
    expect(mapValue.amount).toBe(1578241808n);
    expect(mapValue.to_muxed_id).toBe("trying out Stellarcarbon");
  });

  it("attributes a muxed-account leg by the address string the chain sent", () => {
    const raw = normalize(MUXED_I128);
    expect(raw.topic[1]).toBe(CAPTURED_MUXED_SENDER);
    expect(raw.topic[2]).toBe(CAPTURED_WALLET);

    expect(decodeSettlementEvent(raw, new Map([[CAPTURED_MUXED_SENDER, 3]]))).toMatchObject({
      account: CAPTURED_MUXED_SENDER,
      amountSpent: 1578241808n,
      contextRuleId: 3,
      reference: CAPTURED_WALLET,
    });

    // The L… form is what arrives in topic[1]. A monitored-accounts table keyed
    // by the underlying G… account does not match it, so the leg is skipped
    // rather than attributed to an account that did not spend.
    expect(decodeSettlementEvent(raw, new Map([[CAPTURED_WALLET, 3]]))).toBeNull();
  });
});
