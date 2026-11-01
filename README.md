<div align="center">

# 🛡️ SpendGuard

### Policy-aware spend monitoring & multi-account treasury management for x402 agentic payments on Stellar

**Watch how autonomous agents spend. Know before limits are broken. Never touch a key.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript strict](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![Tests](https://img.shields.io/badge/tests-262%20passing-10b981?logo=vitest&logoColor=white)](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml)
[![Stellar & Soroban](https://img.shields.io/badge/built%20for-Stellar%20%26%20Soroban-7c3aed?logo=stellar&logoColor=white)](#architecture)

</div>

<!--
  ⚠️ Maintainers: a dashboard screenshot here makes the strongest first
  impression during grant / Drips-wave review. Suggested:
  <img src="docs/screenshot-dashboard.png" alt="SpendGuard dashboard" width="720" />
-->

SpendGuard is a **read-only monitoring layer for the next generation of payments** — the ones made by *agents, not humans*. It watches settled on-chain Stellar transfers against the spending-limit policies agents have declared on-chain (via OpenZeppelin's `stellar-accounts` smart account framework) and pairs that with an enterprise-grade **multi-account treasury management system**: RBAC, budgets, audit logs, and multi-sig approvals.

It **never sits in the payment path** — it observes and reports, independent of whichever client the agent used to send the transaction.

> **Companion contract repo:** [`spendguard-contract`](https://github.com/Spendguard/spendguard-contract) — the read-only Soroban `policy-view-helper` this indexer queries for live on-chain policy state.

---

## TL;DR

| SpendGuard **is** | SpendGuard **never** |
|---|---|
| ✅ A passive observer of on-chain spend | ❌ Custodies, holds, or touches keys |
| ✅ A continuous, cursor-persisted event indexer | ❌ Signs or submits transactions |
| ✅ A live reader of on-chain spending policies | ❌ Blocks, freezes, or enforces anything |
| ✅ A multi-account treasury dashboard with RBAC | ❌ Sits in the payment path |

If SpendGuard is late or wrong, **no funds are at risk as a direct result** — the real backstop is the on-chain policy enforcement it observes.

---

## Why this matters

x402 enables autonomous agents to execute payments on Stellar without human approval for every micro-transaction. Smart-contract policies enforce limits on-chain — but **operators and treasury managers lack an independent, consolidated view** of whether those limits are being approached or broken across multiple accounts.

SpendGuard closes that gap with a passive, non-custodial observability and governance layer:

- 🔁 **Continuous event indexing** — ingests and persists real on-chain SEP-41 `transfer` and OpenZeppelin `spending_limit_enforced` events in Postgres, keeping historical visibility beyond Soroban RPC's ~7-day retention window.
- 📖 **Live policy reads** — cross-references each transfer against the spending account's own declared policy, read live from the deployed `policy-view-helper` contract (no stale cached state). The contract reports the window in **ledgers** — Soroban has no clock — so the dashboard shows `17,280 ledgers` and a `~24h` figure labelled as the estimate it is.
- 🚨 **Breach & near-miss alerts** — flags breaches and near-misses (default: 90% of cap) via webhook and dashboard.
- 🏦 **Multi-account treasuries** — unlimited accounts (`Personal`, `Business`, `DAO`, `NGO`, `Project`) with fully isolated data domains.
- 🛡️ **Strict 5-tier RBAC** — `Owner`, `Admin`, `Finance Manager`, `Approver`, `Viewer` enforced across APIs and UI.
- ✍️ **Multi-sig approvals, budgets, audit trails** — built-in governance for high-value treasury disbursements.

---

## Key features

**Monitoring core**
- Continuous Soroban RPC polling with **Postgres-persisted ledger cursor** (no history lost to RPC retention)
- Live on-chain policy reads via `simulateContract` / `simulateTransaction`
- Breach and **near-miss** detection (configurable threshold, default 90% of cap)
- Webhook alert delivery + per-account alert timeline in the dashboard

**Treasury dashboard (Next.js)**
- Multi-account treasury management with typed accounts and isolated data domains
- Spending policies, budgets (Monthly/Quarterly/Annual), and **multi-sig approval workflows** with voter progress
- Members & **RBAC** with permission checks on every API route and UI action
- Immutable **security & operations audit log** and per-account settings (webhooks, thresholds, auto-lock)
- Real-time spend timeline, KPI cards, and alert timeline
- 🌗 Polished **light/dark theme**
- ▶️ Runs out of the box with **seeded demo data** when no database is configured

---

## How it works

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (x402 client)
    participant SA as OZ Smart Account
    participant RPC as Soroban RPC
    participant IX as SpendGuard Indexer
    participant DB as Postgres
    participant WB as Dashboard / Webhooks

    A->>SA: Send transfer (spending_limit enforced on-chain)
    SA-->>RPC: Emits transfer event

    loop Every poll interval
        IX->>RPC: getEvents(from persisted cursor)
        RPC-->>IX: New transfer events
        IX->>RPC: simulateContract → live spending_limit state
        IX->>DB: Persist events + advance cursor
        IX->>IX: Compare vs cap → breach / near-miss (≥ 90%)
        alt Alert raised
            IX->>WB: Webhook POST push
            IX->>DB: Persist alert
        end
    end

    WB->>DB: Accounts, spend history & alert timeline
```

---

## Architecture

```
spendguard-app/
├── packages/sdk/     # Soroban RPC client, live policy reads, XDR helpers, RBAC engine
├── indexer/          # Long-running event-ingest service + breach detector + webhook dispatcher
├── apps/web/         # Next.js 15 dashboard — real-time, never signs on-chain
└── .github/          # CI (install, typecheck, lint, test) + Drips wave templates
```

- **`packages/sdk`** — typed wrapper around Stellar Soroban: `soroban-client` (`getEvents`, `getLatestLedger`, `simulateContract`), `policy-reader` (live `spending_limit` reads via `simulateTransaction`), `xdr-helpers` (strongly-typed `nativeToScVal`/`scValToNative`), plus a pure-RBAC `permissions` engine.
- **`indexer`** — a **persistent process**, not a serverless function: Soroban RPC's ~7-day event retention makes continuous polling a hard requirement. `event-poller` advances a Postgres-persisted cursor; `breach-detector` compares each event against the account's live cap; `alert-dispatcher` delivers webhooks.
- **`apps/web`** — Next.js 15 + React 19 + Tailwind dashboard. API routes read the same Postgres database (with an in-memory fallback so the UI is demoable anywhere).

### RBAC matrix

| Permission | Owner | Admin | Finance Manager | Approver | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| `account:create` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `account:edit` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `account:archive` / `account:delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `members:manage` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `policies:manage` / `budgets:manage` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `multisig:create` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `multisig:approve` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `data:view` | ✅ | ✅ | ✅ | ✅ | ✅ |

Enforcement is **server-side**. Every `/api/*` handler resolves the actor from a
signed, `HttpOnly` session cookie and looks the role up in that account's
membership on each request — the client never supplies a role. A request that
claims `"actorRole": "Owner"` while the session belongs to a Viewer is rejected
with `Role "Viewer" does not have permission to manage members`, and the
membership-scoped queries mean a treasury you do not belong to is absent from
your listings rather than filtered out of them.

---

## Security posture

SpendGuard is built on a simple principle: **the least powerful tool that solves the problem.**

- 🔑 No private keys, no signing, no transaction submission — anywhere in this repo
- 👀 Reads only public on-chain data
- 🎭 Sessions carry identity only; roles are resolved from membership per request, so a stolen-or-forged client payload cannot escalate
- 📦 Attack surface limited to event-decoding correctness, alert delivery, and API access control
- 🧱 Webhook destinations are policy-checked before they are stored *and* before the socket opens: no metadata endpoints, no RFC 1918 / loopback / CGNAT, no database ports, and redirects are followed manually one guarded hop at a time
- 📖 See [SECURITY.md](./SECURITY.md) for the full policy and responsible-disclosure process

---

## Quick start

```bash
git clone https://github.com/Spendguard/spendguard-app.git
cd spendguard-app
npm install
npm run build
```

Create a `.env.local` (root or `apps/web/.env.local`). The values below are the **live testnet configuration this repo is developed against**:

```env
DATABASE_URL="postgres://postgres:postgres@localhost:5432/spendguard"
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
POLICY_VIEW_HELPER_CONTRACT_ID="CCAM4NRAUB6SO3XLL2SRZQEHSOUYQGDKGNPCUIQ5KKI2S6QKWC2VN6NX"

# SpendGuard-owned testnet USDC SEP-41 contract (issuer: X402_ASSET_ISSUER).
# Swap back to Circle's testnet USDC SAC (CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA)
# if you fund the monitored account from faucet.circle.com instead.
X402_ASSET_CONTRACT_ID="CD76G5V4M5BBLO2NRMKVCLLODPX5IIL6MZVRHUKB4NM3555EJMJFCXM6"
X402_ASSET_ISSUER="GBXCSJZADCXIWLZMSR4NGWR7BAS6JWBIBPWQ7VEBLZ7YTD7MW2G5OXV5"
X402_ASSET_ISSUER_SECRET="<issuer secret — only needed to mint>"

# Funded testnet account (Friendbot) — the monitored settlement source
SIMULATION_SOURCE_ACCOUNT="GAUNWPSA4UERYKTDIGAHPTGILYJ3YNSLMNU5EQYZFV65VAVMH6QXFNU5"
SIMULATION_SOURCE_ACCOUNT_SECRET="<account secret — only needed by send:transfer / trustline:usdc>"

# Optional: comma-separated OpenZeppelin smart-account contract IDs
# X402_SMART_ACCOUNT_CONTRACT_IDS=

NEAR_MISS_THRESHOLD_PCT=90
POLL_INTERVAL_MS=10000
WEBHOOK_TIMEOUT_MS=5000

# Alert webhooks may only point at a publicly routable http(s) endpoint on the
# scheme's default port. The dispatcher refuses — before opening a socket — any
# host that resolves to loopback, RFC 1918, link-local (169.254.0.0/16, the cloud
# metadata address), CGNAT, multicast or reserved space, and it re-applies the
# same rule to every redirect hop. Leave this unset in any real deployment; it
# exists so a dev can point a hook at http://localhost:3000.
# WEBHOOK_ALLOW_PRIVATE_NETWORKS=false

# Session signing — any value of >=16 chars, e.g. `openssl rand -hex 32`.
# Left unset, the web app falls back to a per-process secret and sessions stop
# validating on every restart.
SESSION_SECRET="<random secret>"

# Enables the seeded demo sign-in at /signin (identity only, no credentials).
# Leave this unset for anything real and /api/auth/session returns 501 until an
# identity provider is wired in.
DEMO_AUTH="true"
```

```bash
npm run typecheck   # tsc --noEmit across all workspaces
npm test            # Vitest suites across SDK, Indexer, and Web (262 tests)

# Terminal A — indexer (watch mode)
npm -w @spendguard/indexer run dev

# Terminal B — dashboard
npm -w @spendguard/web run dev
```

Open `http://localhost:3000`.

**No database handy?** The dashboard degrades gracefully — every screen renders with seeded demo data, so you can explore the full UI before wiring up Postgres.

**Requirements:** Node ≥ 18.18 (CI runs Node 22 LTS) · PostgreSQL 15+ · a deployed [`policy-view-helper`](https://github.com/Spendguard/spendguard-contract) contract (testnet or mainnet).

---

## Live testnet walkthrough

The whole pipeline runs against `soroban-testnet.stellar.org` — this is the exact flow used to produce the live data in this repo:

```bash
# 1. (once) Let the funded account hold the monitored asset
npm -w @spendguard/indexer run trustline:usdc            # adds a USDC trustline to SIMULATION_SOURCE_ACCOUNT

# 2. Tell the indexer whose transfers count as settlements
npm -w @spendguard/indexer run monitor:account           # registers SIMULATION_SOURCE_ACCOUNT with context rule 1

# 3. Generate real on-chain activity (optional — the indexer ingests any SEP-41 transfer)
npm -w @spendguard/indexer run send:transfer -- 5        # sends 5 USDC to a fresh Friendbot-funded destination

# 4. Run the indexer — polls Soroban RPC, persists events + ledger cursor to Postgres
npm -w @spendguard/indexer run dev

# 5. Query the ingested events (newest first)
curl "http://localhost:3000/api/accounts?address=G...&events=true"
```

The dashboard's **Spend History** chart and **Transactions** tab read these ingested events directly (30 s auto-refresh) — send a transfer and it appears within a poll cycle.

The **Live spending limit** card is a different path: it simulates a read against the deployed helper on every load, with nothing cached.

```bash
curl "http://localhost:3000/api/stellar/account?address=C...&ruleId=1"
# → spendingLimitState.windowLedgers / windowStartedLedger, plus *Estimate fields
```

`spendingLimitState: null` with `policyReadError: null` means the helper answered and there is no policy on that rule. A non-null `policyReadError` means the read itself failed, and the card says so instead of looking empty; see limitation 7 for why a `G…` address produces one.

---

## Scripts & CI

| Command | Description |
|---|---|
| `npm run build` | Builds `@spendguard/sdk`, `@spendguard/indexer`, `@spendguard/web` in order |
| `npm run typecheck` | Runs `tsc --noEmit` across all workspace projects |
| `npm run lint` | Runs ESLint across TypeScript and React codebases |
| `npm test` | Runs Vitest suites across SDK, Indexer, and Web app workspaces |
| `npm -w @spendguard/web run dev` | Launches the Next.js dev server on port 3000 |
| `npm -w @spendguard/indexer run dev` | Runs the indexer continuous polling loop with tsx |
| `npm -w @spendguard/indexer run monitor:account` | Registers an address as a monitored account (`-- G... [context_rule_id] [label]`; defaults to `SIMULATION_SOURCE_ACCOUNT`, rule 1) so its transfers count as settlements |
| `npm -w @spendguard/indexer run trustline:usdc` | Adds the monitored-asset trustline (`-- G...`; defaults to `SIMULATION_SOURCE_ACCOUNT`) — required before an account can send or receive the asset |
| `npm -w @spendguard/indexer run send:transfer` | Sends a real testnet transfer (`-- <amount_USDC> [destination]`; default 5 USDC, funds a fresh Friendbot destination) to generate live on-chain activity |

CI (GitHub Actions) runs **install, typecheck, lint, tests and build** on every push and pull request to `main`, and branch protection requires that job to pass.

### What the web suite covers

`apps/web/test` runs 132 Vitest cases — `account-system` and `authorization` against the service/auth layers, plus render tests under jsdom (React Testing Library) for `/` and `/accounts/[id]`, and direct route-handler tests for `/api/accounts`, `/api/alerts` and `/api/webhooks`. The render tests assert the numbers the dashboard derives (alert totals, breach/near-miss counts, stroop→XLM conversion), that the multi-sig queue only loads when its tab is opened, and that a Viewer session cannot reach an Owner-only affordance. The feed tests pin the difference between an outage and an empty treasury: a configured-but-unreachable database must be a `503` that the chart, alert list and KPI cards each render as *unknown*, while `200 []` stays reserved for a feed that really has nothing. `db-pool` mocks the driver itself to prove the app opens **one** Postgres pool per connection string for a burst of requests and never closes it mid-request, `header.demo-mode` pins the in-app *demo mode* badge to the server's answer — including the anonymous `/signin` visitor who is about to be handed a session for typing an email address, and the webhook tests assert that a destination pointing at a metadata endpoint, a private range, a database port or an embedded credential is refused with `400` and a reason, before anything is written and without leaking the signing secret. `stellar-account-route` and `live-spending-card` extend the same outage-is-not-absence rule to the live policy read: only a `CONTRACT_ERROR` — the helper answering with its own `PolicyViewError` — may produce the empty card, while a decode failure, an unreachable RPC or a `HOST_ERROR` (the call never ran, e.g. `Error(Object, InvalidInput)` when the address handed to the helper is a plain `G…` account rather than a smart-account contract) arrives as `policyReadError` and renders as *unavailable*. The classification is pinned against error strings copied from a live testnet simulation, and only the headline is quoted; the rest of the RPC's diagnostic log stays in the error cause. The card shows the ledger count it was given beside the estimated hours it derived.

### What the SDK and indexer suites cover

`packages/sdk/test` (91 cases) holds the pure logic: policy reads, permission matrix, XDR round-trips, and `webhook-target` — the destination policy itself, with a table of every address class a webhook must not receive (`169.254.169.254`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10` CGNAT, multicast and reserved ranges, IPv6 loopback/ULA/link-local, `::ffff:`-mapped IPv4, plus unparseable input which fails closed) and the IPv6 parser that backs them. `indexer/test` (39 cases) covers breach detection, the dispatcher end-to-end with a stubbed resolver and fetch: a public target is delivered to with `redirect: "manual"` and the bearer header attached; a target that *resolves* to `169.254.169.254` is refused with **zero** fetch calls, so the secret never leaves the process; a hostname with one public and one internal answer is refused outright; a `302` toward an internal address is refused before that hop is contacted; and a refused dispatch never marks the alert delivered. The event tests are the interesting ones: `fixtures/testnet-usdc-transfers.json` stores three Circle testnet-USDC transfer events exactly as `getEvents` returned them on 2026-11-01 — ledger, paging id, transaction hash and the base64 ScVal of every topic and of the value — and the suite pushes those records through `normalizeContractEvent` (the SDK's own record → `RawContractEvent` conversion, extracted from `getEvents` so chain bytes can be replayed without a server) and into `decodeSettlementEvent`. That pins the real four-topic SEP-41 shape (`[transfer, from, to, asset]`), both value formats of one settlement in a single transaction (the plain i128 leg and the map leg carrying `to_muxed_id`), a muxed `L…` sender, and the fact that an unmonitored sender is skipped rather than guessed at. `decodeSpendingLimitView` is pinned the same way from the other side: its fixture map is built from the field names in the **deployed** helper's WASM spec (`cap`, `spent_in_window`, `window_ledgers`, `window_started_ledger`), the fetch command that produced them is in the test file, and a map carrying the older `window_seconds` / `window_started_at` keys is asserted to fail as a decode error — because those two keys are the reason every live policy read was silently reporting "no policy" (see issue #18). `ledger-window` covers the estimate helpers, including that ledger `0` yields *no* timestamp rather than a fabricated one.

---

## API surface

Every route below requires a session cookie; account-scoped routes additionally require membership on that account.

- `GET/POST/DELETE /api/auth/session` — read identity / demo sign-in (`501` unless `DEMO_AUTH=true`) / sign out
- `GET/POST /api/accounts` — list **the treasuries you belong to** (status/type/search filters) / create
- `GET /api/accounts?address=G…&events=true` — **live ingested settlement events** (SEP-41 `transfer` / `spending_limit_enforced`) for an address, newest first — the data behind the dashboard's Spend History chart and Transactions tab
- `GET /api/accounts?address=G…&alerts=true` — breach/near-miss alerts for an account
- `GET /api/alerts?address=G…` — the same alert feed, unprefixed

Both feeds answer **`503` when a database is configured and the query failed**, and `200 []` only when the feed really is empty (or no database is configured at all). On a monitoring dashboard, "nothing happened" and "I cannot tell you what happened" must not look alike; the chart, alert list and transaction table each render an explicit *unknown* panel, and the KPI cards show `—` instead of a reassuring zero.
- `GET /api/stellar/account?address=G…&ruleId=…` — live on-chain account state (sequence, XLM balance via Horizon REST, RPC reachability) and the policy view. `spendingLimitState: null` **with** `policyReadError: null` means the contract answered and there is nothing to show; a non-null `policyReadError` means the read itself failed, and the card says *unavailable* rather than *empty*.
- `GET/PATCH/DELETE /api/accounts/[id]` — account detail, update, archive/delete
- `GET/POST /api/accounts/[id]/members` · `/policies` · `/budgets` · `/multisig` · `/settings` · `/audit-logs`
- `GET/POST/DELETE /api/webhooks` — alert delivery endpoints; requires Owner or Admin on any treasury, since these decide where alert payloads and a signing secret are sent. `POST` answers **`400` with the reason** for a URL the destination policy rejects (non-http(s) scheme, embedded credentials, a database/admin port, a special-use hostname, a non-public IP literal) — an unusable target never reaches the table the dispatcher reads.

---

## Known limitations (honest)

1. **Chain fixtures are pinned in CI; the end-to-end run is not.** Decoding is verified against real captured testnet records — `indexer/test/fixtures/testnet-usdc-transfers.json` holds three Circle testnet-USDC transfer events as the RPC returned them (ledger, paging id, tx hash, base64 ScVal topics and values), pushed through the SDK's own normalization and the indexer's decoder in CI. What remains manual is the full loop — transfer → indexer → Postgres → dashboard/API — which needs a live indexer and database rather than fixtures.
2. **Transfer legs paid from a muxed account (`L…`) are attributed by the exact string the chain sent.** A monitored account registered under its `G…` address therefore does not pick up a leg whose `from` topic is the `M…` form; the event is skipped rather than credited to the wrong account (pinned by the golden fixtures).
3. **Only `spending_limit`-policy accounts are supported** so far (`simple_threshold`, `weighted_threshold` are next).
4. **`spending_limit` is transfer-context only** — an upstream OpenZeppelin constraint, not a SpendGuard one.
5. **The demo sign-in is identification, not authentication.** `/signin` hands out a signed session for a named email with no credential check, and is gated behind `DEMO_AUTH=true` so it cannot be mistaken for production auth. When that flag is on, the header carries a server-driven *Demo mode — identity, not authentication* badge (`GET /api/auth/session` answers `demoMode`), so a reviewer sees the caveat in the app and not only in this README. Authorization is real and server-side; the "who are you" step still needs an IdP (#10).

6. **Wall-clock window figures are estimates, and labelled as such.** The contract returns `window_ledgers` and `window_started_ledger` because Soroban has no clock, and Soroban RPC publishes no close time for historical ledgers (`getLedgerEntries` reads the current one). The UI converts at a single named constant — `ESTIMATED_LEDGER_CLOSE_SECONDS = 5` in `packages/sdk/src/ledger-window.ts` — and shows `~24h` beside the raw `17,280 ledgers`. Actual close times vary with load, so a precise timestamp needs a second source (Horizon `/ledgers/{seq}`); we would rather show a marked estimate than an unmarked one.

7. **The live card needs a smart-account contract address, and the app records plain accounts.** `policy-view-helper` calls into the address it is given, so it accepts only a `C…` smart-account contract; a `G…` address fails in the host with `Error(Object, InvalidInput)` before the contract can answer. Accounts created through `/api/accounts` today store the `G…` key a user pastes, so on a live deployment that card reports *Live limit unavailable* with that error rather than a policy — which is the correct outcome, and the reason the `HOST_ERROR`/`CONTRACT_ERROR` split exists (an earlier build collapsed both into "no policy configured"). Making the card show data end-to-end means registering the smart-account contract address alongside the signing key, tracked separately from #18.

SpendGuard is intentionally scoped to prove policy-aware, real on-chain observability first — not premature production hardening.

---

## Roadmap

- 🧩 Support additional OZ policy types (`simple_threshold`, `weighted_threshold`)
- 🔔 PagerDuty / Slack alert sinks alongside webhooks
- 🔐 Wire a real identity provider (OAuth / wallet sign-in) behind the session layer that now enforces authorization

---

## Contributing

Contributors are welcome — and rewarded. SpendGuard is a great **Drips-wave contribution target**: well-scoped issues, a tiny codebase, and zero blockchain setup required to run the UI (seeded demo data).

- 🎯 Start with issues labelled **good first issue**
- 📖 Read [CONTRIBUTING.md](./CONTRIBUTING.md) — Conventional Commits, TypeScript strict, Vitest
- 🐛 Security-sensitive bugs go through [SECURITY.md](./SECURITY.md)
- 🧪 `npm test --workspaces --if-present` runs the Vitest suites

---

## License

[MIT](LICENSE) © SpendGuard Contributors
