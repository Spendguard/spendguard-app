/**
 * Ledger-sequence → wall-clock estimates.
 *
 * The `policy-view-helper` contract deliberately returns ledger-native fields
 * (`window_ledgers`, `window_started_ledger`): Soroban has no clock, and the
 * contract refuses to invent one. Anything shown to a human has to convert,
 * and the conversion is an **estimate** — ledgers close in roughly five
 * seconds but the interval varies with load and protocol version. Soroban RPC
 * also exposes no close time for historical ledgers (`getLedgerEntries` reads
 * the current one), so a precise answer needs a second data source such as
 * Horizon's `/ledgers/{seq}`.
 *
 * Callers must label the result. These functions exist so the constant and the
 * assumption live in exactly one place instead of being divided out ad hoc in
 * components.
 */

/** Assumed seconds per ledger close, used only for display estimates. */
export const ESTIMATED_LEDGER_CLOSE_SECONDS = 5;

/** How long a `window_ledgers`-wide rolling window is, in seconds (estimate). */
export function estimateWindowSeconds(
  windowLedgers: number,
  closeSeconds: number = ESTIMATED_LEDGER_CLOSE_SECONDS,
): number {
  return windowLedgers * closeSeconds;
}

/**
 * When a given ledger closed, in Unix seconds (estimate).
 *
 * Anchored on the most recently observed ledger: `closedAtSeconds` is the close
 * time of `latestLedger` (for a read that just happened, `Date.now() / 1000` is
 * within a few seconds of it). Returns `null` for `0`, the contract's encoding
 * of "this window has no spending history yet" — that ledger does not exist.
 */
export function estimateLedgerCloseTime(
  ledger: number,
  latest: { ledger: number; closedAtSeconds: number },
  closeSeconds: number = ESTIMATED_LEDGER_CLOSE_SECONDS,
): number | null {
  if (ledger === 0) return null;
  return latest.closedAtSeconds - (latest.ledger - ledger) * closeSeconds;
}
