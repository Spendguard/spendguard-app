export { SorobanClient, normalizeContractEvent } from "./soroban-client.js";
export type { SorobanClientConfig, ContractEventFilter, GetEventsOptions } from "./soroban-client.js";

export {
  PolicyReader,
  PolicyReaderError,
  isSpendingLimitAbsence,
} from "./policy-reader.js";

export {
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
  POLICY_VIEW_ERROR,
} from "./xdr-helpers.js";
export type { ContractErrorCode } from "./xdr-helpers.js";

export {
  ESTIMATED_LEDGER_CLOSE_SECONDS,
  estimateWindowSeconds,
  estimateLedgerCloseTime,
} from "./ledger-window.js";

export {
  getRolePermissions,
  hasPermission,
  isValidStellarAddress,
} from "./permissions.js";
export type { Permission } from "./permissions.js";

export {
  checkWebhookUrlShape,
  findBlockedAddress,
  isBlockedIpAddress,
  isIpAddressLike,
  parseIpv4,
  parseIpv6,
} from "./webhook-target.js";
export type {
  AllowedWebhookTarget,
  RejectedWebhookTarget,
  WebhookTargetCheck,
  WebhookTargetOptions,
} from "./webhook-target.js";

export type * from "./types.js";

