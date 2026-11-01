// ── On-chain event types ──────────────────────────────────────────────

/** Raw Soroban event as returned by getEvents, before decoding. */
export interface RawContractEvent {
  id: string;
  ledger: number;
  topic: string[];
  value: string;
  contractId: string;
  timestamp: number | null;
}

/**
 * Decoded x402 settlement event.
 *
 * Produced from one of two real on-chain event sources:
 *  - SEP-41 token `transfer` events on the monitored asset contract
 *    (topics: ["transfer", from, to]; data: amount) — the actual payment.
 *  - OpenZeppelin smart-account `spending_limit_enforced` events
 *    (topics: ["spending_limit_enforced", smart_account]; data map with
 *    context, context_rule_id, amount, total_spent_in_period) — the
 *    policy-enforcing spend.
 *
 * Note: the x402 "facilitator" is an off-chain service (OpenZeppelin
 * Relayer + x402 Facilitator Plugin), not an on-chain contract, so there
 * is no facilitator contract event to decode.
 */
export interface X402SettlementEvent {
  /** Unique event identifier (RPC-provided). */
  id: string;
  /** Stellar ledger sequence where this event was emitted. */
  ledger: number;
  /** Unix timestamp (seconds) if the RPC provider includes it, else null. */
  timestamp: number | null;
  /** The account that authorised the spend (SEP-41 `from` or smart account). */
  account: string;
  /** The on-chain contract that emitted this event (asset or smart account). */
  sourceContractId: string;
  /** Amount of the native asset spent, in stroops (1 XLM = 10^7 stroops). */
  amountSpent: bigint;
  /** Context rule ID this spend was matched against. */
  contextRuleId: number;
  /** Optional invoice / memo reference (SEP-41 `to` for transfer events). */
  reference: string | null;
}

// ── Policy ────────────────────────────────────────────────────────────

/**
 * View returned by the policy-view-helper contract.
 *
 * Field names and ScMap keys mirror the deployed WASM's embedded spec —
 * `cap`, `spent_in_window`, `window_ledgers`, `window_started_ledger` — so a
 * rename on either side shows up as a decode error instead of a silent zero.
 *
 * The window fields are ledger-native by design: the contract hands back the
 * policy's raw `period_ledgers` and the earliest retained `ledger_sequence`,
 * and Soroban has no wall-clock. Anything user-facing converts through
 * `ledger-window.ts` and labels the result an estimate.
 */
export interface SpendingLimitView {
  cap: bigint;
  spentInWindow: bigint;
  /** Rolling window length in ledgers. */
  windowLedgers: number;
  /** Earliest retained spending entry's ledger; `0` when the window is empty. */
  windowStartedLedger: number;
}

export interface SpendingLimitState {
  account: string;
  contextRuleId: number;
  cap: bigint;
  spentInWindow: bigint;
  windowLedgers: number;
  windowStartedLedger: number;
  /** Percentage of cap consumed (0-100). */
  utilizationPct: number;
}

// ── Indexer cursor ────────────────────────────────────────────────────

export interface Cursor {
  lastLedger: number;
  lastEventId: string | null;
  updatedAt: Date;
}

// ── Breach / alert types ──────────────────────────────────────────────

export type AlertLevel = "near_miss" | "breach";

export interface SpendAlert {
  id: string;
  account: string;
  contextRuleId: number;
  level: AlertLevel;
  /** The amount that caused the alert. */
  eventAmount: bigint;
  /** Total spent in window after this event. */
  totalSpentInWindow: bigint;
  /** Cap for the policy. */
  cap: bigint;
  /** Ledger at which the triggering event was observed. */
  triggerLedger: number;
  /** ISO-8601 timestamp when the alert was raised. */
  raisedAt: string;
  /** Whether the webhook notification was successfully delivered. */
  webhookDelivered: boolean;
}

// ── Webhook configuration ─────────────────────────────────────────────

export interface WebhookConfig {
  id: string;
  url: string;
  /** Optional bearer token sent as Authorization header. */
  secret: string | null;
  /** Alert levels to dispatch. */
  alertLevels: AlertLevel[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Monitored account ─────────────────────────────────────────────────

export interface MonitoredAccount {
  address: string;
  label: string | null;
  contextRuleId: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Multi-Account Management System Types ──────────────────────────────

export type AccountType = "Personal" | "Business" | "DAO" | "NGO" | "Project";
export type AccountStatus = "Active" | "Archived";
export type AccountRole = "Owner" | "Admin" | "Finance Manager" | "Approver" | "Viewer";

export interface TreasuryAccount {
  id: string;
  name: string;
  description: string;
  address: string;
  type: AccountType;
  status: AccountStatus;
  contextRuleId: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountMember {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: AccountRole;
  addedAt: string;
}

export interface SpendingPolicy {
  id: string;
  accountId: string;
  name: string;
  cap: bigint;
  windowSeconds: bigint;
  assetId: string;
  status: "Active" | "Inactive";
  createdAt: string;
}

export interface Budget {
  id: string;
  accountId: string;
  name: string;
  category: string;
  allocatedAmount: bigint;
  spentAmount: bigint;
  period: "Monthly" | "Quarterly" | "Annual";
  status: "Active" | "Exceeded" | "Closed";
  createdAt: string;
}

export interface MultiSigApproval {
  id: string;
  proposalId: string;
  approverEmail: string;
  decision: "Approved" | "Rejected";
  note: string | null;
  timestamp: string;
}

export interface MultiSigProposal {
  id: string;
  accountId: string;
  title: string;
  description: string;
  amount: bigint;
  recipient: string;
  requiredApprovals: number;
  status: "Pending" | "Approved" | "Rejected";
  createdBy: string;
  createdAt: string;
  approvals: MultiSigApproval[];
}

export interface AuditLog {
  id: string;
  accountId: string;
  action: string;
  actorEmail: string;
  details: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AccountSettings {
  accountId: string;
  webhookUrl: string | null;
  nearMissThresholdPct: number;
  multisigThreshold: number;
  notificationEmail: string | null;
  autoLockOnBreach: boolean;
  updatedAt: string;
}

