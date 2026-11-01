# `@spendguard/sdk`

**Core TypeScript SDK for SpendGuard — Soroban RPC Client, Policy Reader, XDR Conversions, Types, and RBAC Engine.**

This package provides strongly-typed interfaces, Stellar/Soroban XDR helpers, contract simulation wrappers, and permission validation helpers used by the SpendGuard indexer service and web application.

---

## Installation

Within the SpendGuard monorepo:

```json
{
  "dependencies": {
    "@spendguard/sdk": "*"
  }
}
```

---

## Features

- 🔌 **`SorobanClient`**: Wrapper for Soroban RPC calls (`getEvents`, `getLatestLedger`, `simulateTransaction`). `normalizeContractEvent` is exported alongside it — the RPC record → `RawContractEvent` conversion, pure and server-free, so captured chain bytes can be replayed in a test.
- 📜 **`PolicyReader`**: Reads live `spending_limit` policy state from deployed `policy-view-helper` smart contracts.
- ⚡ **`xdr-helpers`**: Strongly-typed wrappers around `@stellar/stellar-sdk` XDR conversions (`nativeToScVal`, `scValToNative`, `addressToScVal`, `i128ToScVal`, `u64ToScVal`).
- 🔐 **`permissions`**: Role-based access control engine (`hasPermission`, `getRolePermissions`) and Stellar address validator (`isValidStellarAddress`).
- 🧱 **`webhook-target`**: The alert-webhook destination policy, kept pure (no DNS, no sockets) so the API's write-time check and the indexer's delivery-time check cannot drift apart — `checkWebhookUrlShape`, `isBlockedIpAddress`, `findBlockedAddress`, plus `parseIpv4`/`parseIpv6`.
- 📐 **Domain Models & Types**: Interfaces for `TreasuryAccount`, `AccountMember`, `SpendingPolicy`, `Budget`, `MultiSigProposal`, `AuditLog`, `AccountSettings`, `X402SettlementEvent`, `SpendAlert`, and `WebhookConfig`.

---

## Usage Examples

### 1. Checking Role-Based Permissions

```typescript
import { hasPermission, isValidStellarAddress } from "@spendguard/sdk";

// Check permissions
const canEdit = hasPermission("Admin", "account:edit"); // true
const canDelete = hasPermission("Admin", "account:delete"); // false

// Validate Stellar wallet address
const isValid = isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"); // true
```

### 2. Reading Spending Limit Policy State

```typescript
import { SorobanClient, PolicyReader } from "@spendguard/sdk";

const client = new SorobanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; July 2015",
});

const reader = new PolicyReader(
  client,
  "CCAM4NRAUB6SO3XLL2SRZQEHSOUYQGDKGNPCUIQ5KKI2S6QKWC2VN6NX", // Policy view helper ID
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"  // Simulation account
);

const state = await reader.getSpendingLimitState(
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", // Monitored smart account
  1 // Context rule ID
);

console.log(`Cap: ${state.cap}, Spent: ${state.spentInWindow}, Utilization: ${state.utilizationPct}%`);
```

### 3. Converting XDR Values Safely

```typescript
import { addressToScVal, scValToAddress, i128ToScVal, scValToI128 } from "@spendguard/sdk";

const scvAddr = addressToScVal("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
const addr = scValToAddress(scvAddr);

const scvAmount = i128ToScVal(100_000_000n);
const amount = scValToI128(scvAmount);
```

---

## Data Model Interfaces

### `TreasuryAccount`

```typescript
export interface TreasuryAccount {
  id: string;
  name: string;
  description: string;
  address: string;
  type: "Personal" | "Business" | "DAO" | "NGO" | "Project";
  status: "Active" | "Archived";
  contextRuleId: number;
  createdAt: string;
  updatedAt: string;
}
```

### `AccountMember`

```typescript
export interface AccountMember {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: "Owner" | "Admin" | "Finance Manager" | "Approver" | "Viewer";
  addedAt: string;
}
```

---

## Build & Test

```bash
# Build TypeScript output to dist/
npm run build

# Run Vitest test suite
npm run test
```

---

## License

[MIT](LICENSE)
