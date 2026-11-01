/**
 * SpendGuard indexer — long-running ingest loop entrypoint.
 *
 * This process:
 * 1. Loads and validates configuration from environment variables.
 * 2. Connects to Postgres and runs pending migrations.
 * 3. Connects to the Soroban RPC endpoint.
 * 4. Starts the event poller (continuous getEvents loop with cursor
 *    persistence).
 * 5. For each ingested settlement event, evaluates it against the
 *    spending-limit policy and raises breach/near-miss alerts.
 * 6. Dispatches alerts to configured webhooks.
 *
 * This is NOT a serverless function — it holds an open polling loop and
 * a persistent DB connection. It must be deployed to a long-running
 * process host (Render, Railway, etc.).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { SorobanClient, PolicyReader } from "@spendguard/sdk";
import { loadConfig } from "./config.js";
import { Database } from "./db.js";
import { EventPoller } from "./event-poller.js";
import { BreachDetector } from "./breach-detector.js";
import { AlertDispatcher } from "./alert-dispatcher.js";

// ── Logger ────────────────────────────────────────────────────────────

function log(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${ts}] [${level}] [Main] ${msg}${metaStr}`);
}

// ── Graceful shutdown ─────────────────────────────────────────────────

let shuttingDown = false;

function registerShutdownHandlers(
  db: Database,
  poller: EventPoller,
): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log("INFO", `Received ${signal}; shutting down gracefully...`);

    try {
      poller.stop();
      await db.close();
      log("INFO", "Shutdown complete");
    } catch (err) {
      log("ERROR", "Error during shutdown", { error: String(err) });
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Prevent unhandled rejections from crashing the process silently
  process.on("unhandledRejection", (reason) => {
    log("ERROR", "Unhandled rejection", { reason: String(reason) });
  });

  process.on("uncaughtException", (err) => {
    log("ERROR", "Uncaught exception", { error: String(err) });
    // Exit with non-zero code so the process manager restarts us
    process.exit(1);
  });
}

// ── Sequential batch processing ───────────────────────────────────────

/**
 * Process new settlement events that have not yet been evaluated by the
 * breach detector. This runs after each poll cycle.
 */
async function processNewEvents(
  db: Database,
  breachDetector: BreachDetector,
  alertDispatcher: AlertDispatcher,
): Promise<void> {
  // Fetch settlement events that haven't been evaluated yet.
  // We track this via a simple heuristic: events without a corresponding
  // breach-detector evaluation are those with a ledger greater than the
  // last evaluated ledger. For simplicity in this MVP, we evaluate all
  // events at most once when they come in.
  //
  // In a production system, consider a separate `evaluated` flag or
  // an `events_pending_evaluation` table.
  const events = await db.sql`
    SELECT id, ledger, account, context_rule_id, amount_spent
    FROM settlement_events
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts WHERE alerts.trigger_ledger = settlement_events.ledger
    )
    ORDER BY ledger ASC
    LIMIT 50
  `;

  for (const row of events) {
    const alert = await breachDetector.evaluateEvent({
      account: row.account as string,
      contextRuleId: row.context_rule_id as number,
      amountSpent: BigInt(row.amount_spent as string),
      // settlement_events.ledger is BIGINT, which postgres.js returns as a
      // string; convert so the alert's triggerLedger is a real number.
      triggerLedger: Number(row.ledger),
    });

    for (const a of alert) {
      // Dispatch synchronously — we want delivery confirmation before
      // moving on, but failures are logged not fatal.
      try {
        await alertDispatcher.dispatchAlert(a);
      } catch (err) {
        log("ERROR", "Alert dispatch failed", {
          alertId: a.id,
          error: String(err),
        });
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("INFO", "Starting SpendGuard indexer");

  // Load the repo-root .env.local file into process.env. The compiled
  // output (dist/) and the source (src/) both sit two levels below the
  // repo root, so resolve the path relative to this module — this works
  // no matter which directory the process is launched from (npm workspace
  // scripts, repo root, a process manager, etc.). Variables already
  // exported in the environment always win — dotenv never overrides
  // existing process.env entries.
  const envFilePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".env.local",
  );
  dotenv.config({ path: envFilePath, quiet: true });

  // 1. Load configuration
  const config = loadConfig();

  log("INFO", "Configuration loaded", {
    sorobanRpcUrl: config.sorobanRpcUrl,
    policyContract: config.policyViewHelperContractId,
    assetContract: config.x402AssetContractId,
    smartAccountContracts: config.x402SmartAccountContractIds,
    nearMissThresholdPct: config.nearMissThresholdPct,
  });

  // 2. Connect to Postgres and run migrations
  const db = new Database(config.databaseUrl);
  await db.runMigrations();

  const healthy = await db.healthCheck();
  if (!healthy) {
    log("ERROR", "Database health check failed");
    process.exit(1);
  }
  log("INFO", "Database connected and migrated");

  // 3. Connect to Soroban RPC
  const sorobanClient = new SorobanClient({
    rpcUrl: config.sorobanRpcUrl,
    networkPassphrase: config.networkPassphrase,
  });

  // 4. Create policy reader. Read-only simulations need a source account
  //    that exists on the network (getAccount is called on it), so a funded
  //    G… account must be supplied via SIMULATION_SOURCE_ACCOUNT; a contract
  //    ID is not a valid account and would fail at runtime.
  if (!process.env.SIMULATION_SOURCE_ACCOUNT) {
    log("WARN", "SIMULATION_SOURCE_ACCOUNT is not set; falling back to the " +
      "asset contract ID. Policy reads will fail unless a funded G… " +
      "account is configured.");
  }
  const policyReader = new PolicyReader(
    sorobanClient,
    config.policyViewHelperContractId,
    config.simulationSourceAccount,
  );

  // 5. Create breach detector and alert dispatcher
  const breachDetector = new BreachDetector(
    policyReader,
    db,
    config.nearMissThresholdPct,
  );
  const alertDispatcher = new AlertDispatcher(db, config.webhookTimeoutMs, {
    allowPrivateNetworks: config.webhookAllowPrivateNetworks,
  });

  // 6. Start the event poller
  const poller = new EventPoller(
    sorobanClient,
    db,
    config.x402AssetContractId,
    config.x402SmartAccountContractIds,
    config.pollIntervalMs,
  );

  // Wire post-poll processing: after each poll cycle, process new events
  // through the breach detector.
  // We use a simple setInterval for post-processing; the poller itself
  // has its own internal timing.
  const processingInterval = setInterval(async () => {
    try {
      await processNewEvents(db, breachDetector, alertDispatcher);
    } catch (err) {
      log("ERROR", "Event processing cycle failed", { error: String(err) });
    }
  }, config.pollIntervalMs);

  // 7. Register shutdown handlers
  registerShutdownHandlers(db, poller);

  // Ensure the processing interval is cleaned up on shutdown
  const origStop = poller.stop.bind(poller);
  poller.stop = () => {
    clearInterval(processingInterval);
    origStop();
  };

  // 8. Start polling
  await poller.start();

  log("INFO", "Indexer is running");
}

// ── Run ───────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error in main():", err);
  process.exit(1);
});
