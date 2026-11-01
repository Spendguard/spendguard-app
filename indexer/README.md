# `@spendguard/indexer`

**Persistent Soroban RPC Event Ingestion, Breach Detection, and Webhook Dispatch Service.**

The SpendGuard indexer continuously monitors Soroban ledger event logs for x402 settlement activity (SEP-41 token transfers and OpenZeppelin `spending_limit_enforced` events). It cross-references ingested events against on-chain policy caps and dispatches breach / near-miss webhook alerts.

---

## Why a Dedicated Long-Running Indexer Process?

Soroban RPC nodes only retain approximately **7 days of event history**. To maintain a permanent, reliable audit trail and prevent missed alerts during downtime, the indexer operates as a persistent daemon rather than a serverless function. It persists its ledger cursor in PostgreSQL, allowing seamless resumption across restarts.

---

## Service Architecture

```
                    ┌─────────────────────────┐
                    │    Soroban RPC Node     │
                    └────────────┬────────────┘
                                 │
                                 │ getEvents()
                                 ▼
                    ┌─────────────────────────┐
                    │      Event Poller       │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
    ┌─────────────────────────┐     ┌─────────────────────────┐
    │  PostgreSQL Cursor &    │     │     Breach Detector     │
    │     Events Store        │     └────────────┬────────────┘
    └─────────────────────────┘                  │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │    Alert Dispatcher     │
                                    │    (Webhook Client)     │
                                    └─────────────────────────┘
```

### Components

1. **`EventPoller` (`event-poller.ts`)**: Continuous loop that polls `getEvents` from Soroban RPC, decodes SEP-41 transfer and `spending_limit_enforced` events, and saves the ledger cursor.
2. **`BreachDetector` (`breach-detector.ts`)**: Queries the deployed `policy-view-helper` contract via simulation to check live spent amount vs cap. Raises `near_miss` (e.g. 90% of cap) or `breach` (100%+ of cap) alerts.
3. **`AlertDispatcher` (`alert-dispatcher.ts`)**: Delivers JSON webhook POST notifications with bearer authentication signatures to operator-configured URLs. Because that URL is operator-supplied and the request carries a secret, every target is guarded before a socket opens — see *Webhook destination policy* below.
4. **`Database` (`db.ts`)**: Database wrapper managing schema migration execution (`migrations/*.sql`), cursor persistence, settlement event storage, and monitored account lists.

---

## Database Migrations

SQL migrations are applied automatically on startup from `migrations/`:

- `001_init.sql`: Base tables (`ingest_cursor`, `settlement_events`, `alerts`, `monitored_accounts`, `webhook_configs`).
- `002_repoint_events.sql`: Repoints event store to real on-chain event source contract IDs.
- `003_multi_account_system.sql`: Multi-account treasury tables (`treasury_accounts`, `account_members`, `account_spending_policies`, `account_budgets`, `account_multisig_proposals`, `account_multisig_approvals`, `account_audit_logs`, `account_settings`).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SOROBAN_RPC_URL` | Yes | Soroban RPC node endpoint |
| `NETWORK_PASSPHRASE` | Yes | Network passphrase matching RPC |
| `POLICY_VIEW_HELPER_CONTRACT_ID` | Yes | Deployed view helper contract ID |
| `X402_ASSET_CONTRACT_ID` | Yes | Monitored SEP-41 token contract ID |
| `SIMULATION_SOURCE_ACCOUNT` | No | Funded G... account for simulation calls |
| `NEAR_MISS_THRESHOLD_PCT` | No | Near-miss alert threshold % (default: `90`) |
| `POLL_INTERVAL_MS` | No | Polling interval in ms (default: `10000`) |
| `WEBHOOK_TIMEOUT_MS` | No | Per-request webhook timeout in ms (default: `5000`) |
| `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | No | `true` relaxes the destination policy for local development only (default: `false`) |

---

## Webhook destination policy

Webhook URLs are operator-supplied configuration, and the indexer POSTs to them with a bearer secret attached. Unguarded, that is an SSRF primitive: point a hook at `http://169.254.169.254/`, at Redis on `127.0.0.1:6379`, or at a name that resolves to either, and the deployment delivers a signed request to wherever the configuration wanted to reach.

`AlertDispatcher` therefore checks the destination **before** it opens a socket:

1. **Shape** — `checkWebhookUrlShape()` from `@spendguard/sdk`: `http`/`https` only, no embedded credentials, no port other than the scheme default, no special-use hostname (`.localhost`, `.local`, `.internal`, …), no IP literal in a non-public range. `new URL()` normalises `2130706433`, `0177.0.0.1` and `0x7f000001` into a dotted quad, so an address cannot hide behind a spelling.
2. **Resolution** — the hostname is resolved and **every** answer must be publicly routable; a name with one public and one private record is refused, as are loopback, RFC 1918, link-local (including the cloud metadata address), CGNAT, multicast, reserved and documentation ranges, and IPv6 loopback / ULA / link-local — with `::ffff:`-mapped IPv4 unwrapped first. Unparseable addresses fail closed.
3. **Redirects** — requested with `redirect: "manual"` and followed by the dispatcher, up to `maxRedirects` (3), re-running steps 1–2 on each hop. A public host answering `302 → http://169.254.169.254` is the same request the policy already refused.

A refused dispatch never marks the alert as delivered, so the next poll cycle retries it; the reason is logged, never the secret. `apps/web`'s `POST /api/webhooks` applies the same shape check at write time, so an unusable target does not reach the table.

Setting `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` relaxes steps 1–2 for local development (delivering to `http://localhost:3000/hook`). The protocol and embedded-credential rules still apply, and a deployment that faces the internet should leave it unset.

**Residual risk, stated plainly.** The address checked is not the address dialed: `fetch` resolves the hostname again when it opens the socket, so a record that flips between the check and the connection (classic DNS rebinding, or a name with a short TTL and rotating answers) can still land somewhere private. Closing that gap properly means pinning the connection to the validated IP — a custom agent, and for the web app a `dispatcher` — which this repo does not do yet. Two things make the window narrow rather than wide: the redirect hop is re-guarded, so a `302` cannot be used to walk in from a public host, and the shape check already removed the port and protocol tricks. The remaining exposure assumes an attacker controls DNS answers for a host the operator chose to trust.

---

## Build & Run

```bash
# Build indexer TypeScript files to dist/
npm run build

# Run indexer in watch mode (development)
npm run dev

# Run compiled indexer process (production)
npm run start

# Run Vitest test suite
npm run test
```

---

## Golden fixtures

`test/fixtures/testnet-usdc-transfers.json` stores three real Circle testnet-USDC transfer events (ledger 5415793 / 5415799, captured 2026-11-01) exactly as `getEvents` returned them: paging id, transaction hash, and the base64 `ScVal` of every topic and of the value. `test/event-decode.test.ts` feeds those records through `normalizeContractEvent` from `@spendguard/sdk` and `decodeSettlementEvent`, so the ingestion path is pinned against chain bytes rather than against our idea of what chain bytes look like — including the four-topic shape (`[transfer, from, to, asset]`), a settlement whose two legs use the i128 and the `to_muxed_id` map value formats, and a muxed `L…` sender.

Nothing contacts the network in CI; the fixtures age only in the sense that the RPC stops serving them, not in the sense that they stop decoding. To refresh or add an event, query a public testnet RPC (retention is ~7 days) — for instance from a scratch script inside this workspace:

```ts
const client = new SorobanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});
const latest = await client.getLatestLedger();
const { events } = await client.getEvents({
  startLedger: latest - 100_000,
  filters: [{ type: "contract", contractIds: ["CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"] }],
  maxEvents: 1000,
});
```

`client.server.getEvents(…)` returns the raw SDK records if you need the base64 topic encodings; keep every encoding verbatim when pasting into the fixture file.

---

## License

[MIT](LICENSE)
