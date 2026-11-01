<div align="center">

# 🛡️ SpendGuard

### Policy-aware spend monitoring & multi-account treasury management for x402 agentic payments on Stellar

**Watch how autonomous agents spend. Know before limits are broken. Never touch a key.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript strict](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![Tests](https://img.shields.io/badge/tests-156%20passing-10b981?logo=vitest&logoColor=white)](https://github.com/Spendguard/spendguard-app/actions/workflows/ci.yml)
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
- 📖 **Live policy reads** — cross-references each transfer against the spending account's own declared policy, read live from the deployed `policy-view-helper` contract (no stale cached state).
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
npm test            # Vitest suites across SDK, Indexer, and Web (156 tests)

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

`apps/web/test` runs 103 Vitest cases — `account-system` and `authorization` against the service/auth layers, plus render tests under jsdom (React Testing Library) for `/` and `/accounts/[id]`, and direct route-handler tests for `/api/accounts`, `/api/alerts` and `/api/webhooks`. The render tests assert the numbers the dashboard derives (alert totals, breach/near-miss counts, stroop→XLM conversion), that the multi-sig queue only loads when its tab is opened, and that a Viewer session cannot reach an Owner-only affordance. The feed tests pin the difference between an outage and an empty treasury: a configured-but-unreachable database must be a `503` that the chart, alert list and KPI cards each render as *unknown*, while `200 []` stays reserved for a feed that really has nothing.

---

## API surface

Every route below requires a session cookie; account-scoped routes additionally require membership on that account.

- `GET/POST/DELETE /api/auth/session` — read identity / demo sign-in (`501` unless `DEMO_AUTH=true`) / sign out
- `GET/POST /api/accounts` — list **the treasuries you belong to** (status/type/search filters) / create
- `GET /api/accounts?address=G…&events=true` — **live ingested settlement events** (SEP-41 `transfer` / `spending_limit_enforced`) for an address, newest first — the data behind the dashboard's Spend History chart and Transactions tab
- `GET /api/accounts?address=G…&alerts=true` — breach/near-miss alerts for an account
- `GET /api/alerts?address=G…` — the same alert feed, unprefixed

Both feeds answer **`503` when a database is configured and the query failed**, and `200 []` only when the feed really is empty (or no database is configured at all). On a monitoring dashboard, "nothing happened" and "I cannot tell you what happened" must not look alike; the chart, alert list and transaction table each render an explicit *unknown* panel, and the KPI cards show `—` instead of a reassuring zero.
- `GET /api/stellar/account?address=G…&ruleId=…` — live on-chain account state (sequence, XLM balance via Horizon REST, RPC reachability)
- `GET/PATCH/DELETE /api/accounts/[id]` — account detail, update, archive/delete
- `GET/POST /api/accounts/[id]/members` · `/policies` · `/budgets` · `/multisig` · `/settings` · `/audit-logs`
- `GET/POST/DELETE /api/webhooks` — alert delivery endpoints; requires Owner or Admin on any treasury, since these decide where alert payloads and a signing secret are sent

---

## Known limitations (honest)

1. **Live testnet flow verified, but not yet a CI golden-fixture test.** Real SEP-41 transfers have been sent, ingested, and rendered end-to-end (transfer → indexer → Postgres → dashboard/API) against this repo's live testnet configuration. That verification is currently manual — the automated suite still relies on encode/decode round-trips plus one captured real on-chain value.
2. **Only `spending_limit`-policy accounts are supported** so far (`simple_threshold`, `weighted_threshold` are next).
3. **`spending_limit` is transfer-context only** — an upstream OpenZeppelin constraint, not a SpendGuard one.
4. **The demo sign-in is identification, not authentication.** `/signin` hands out a signed session for a named email with no credential check, and is gated behind `DEMO_AUTH=true` so it cannot be mistaken for production auth. Authorization is real and server-side; the "who are you" step still needs an IdP.

SpendGuard is intentionally scoped to prove policy-aware, real on-chain observability first — not premature production hardening.

---

## Roadmap

- 🧪 Turn the verified live testnet flow into an automated golden-fixture test in CI
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
