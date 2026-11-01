/**
 * Environment configuration for the SpendGuard indexer.
 *
 * All secrets and connection strings are loaded from environment variables
 * at startup. Validation is strict: the process will exit with a clear
 * error message if any required variable is missing.
 */

// ── Helper ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`FATAL: Required environment variable "${name}" is not set.`);
    process.exit(1);
  }
  return value.trim();
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(parsed)) {
    console.error(
      `FATAL: Environment variable "${name}" must be an integer. Got: "${raw}"`,
    );
    process.exit(1);
  }
  return parsed;
}

function optionalBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  console.error(
    `FATAL: Environment variable "${name}" must be true/false. Got: "${raw}"`,
  );
  process.exit(1);
}

/**
 * Parse a comma-separated list env var into a trimmed, non-empty string
 * array. Returns an empty array when the var is unset or blank.
 */function optionalListEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// ── Config shape ──────────────────────────────────────────────────────

export interface IndexerConfig {
  sorobanRpcUrl: string;
  networkPassphrase: string;
  policyViewHelperContractId: string;
  /** SEP-41 asset contract that carries x402 settlements (e.g. testnet USDC). */
  x402AssetContractId: string;
  /** OpenZeppelin smart-account contracts monitored for spend events. */
  x402SmartAccountContractIds: string[];
  /**
   * Funded G… account used as the source for read-only simulations.
   * Must exist on the network; defaults to the asset contract ID.
   */
  simulationSourceAccount: string;
  databaseUrl: string;
  nearMissThresholdPct: number;
  webhookTimeoutMs: number;
  /**
   * Permit webhook targets on loopback/RFC 1918 ranges. Local development
   * only — a hosted indexer delivering alerts to `127.0.0.1` is delivering them
   * to itself, and a hosted indexer delivering to `169.254.169.254` is an SSRF
   * with a signing secret attached.
   */
  webhookAllowPrivateNetworks: boolean;
  pollIntervalMs: number;
}

// ── Loader ────────────────────────────────────────────────────────────

export function loadConfig(): IndexerConfig {
  const x402AssetContractId = requireEnv("X402_ASSET_CONTRACT_ID");
  return {
    sorobanRpcUrl: requireEnv("SOROBAN_RPC_URL"),
    networkPassphrase: requireEnv("NETWORK_PASSPHRASE"),
    policyViewHelperContractId: requireEnv("POLICY_VIEW_HELPER_CONTRACT_ID"),
    x402AssetContractId,
    x402SmartAccountContractIds: optionalListEnv("X402_SMART_ACCOUNT_CONTRACT_IDS"),
    simulationSourceAccount:
      process.env.SIMULATION_SOURCE_ACCOUNT?.trim() || x402AssetContractId,
    databaseUrl: requireEnv("DATABASE_URL"),
    nearMissThresholdPct: optionalIntEnv("NEAR_MISS_THRESHOLD_PCT", 90),
    webhookTimeoutMs: optionalIntEnv("WEBHOOK_TIMEOUT_MS", 5000),
    webhookAllowPrivateNetworks: optionalBoolEnv(
      "WEBHOOK_ALLOW_PRIVATE_NETWORKS",
      false,
    ),
    pollIntervalMs: optionalIntEnv("POLL_INTERVAL_MS", 10_000),
  };
}
