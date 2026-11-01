import type { SpendAlert } from "@spendguard/sdk";

interface AlertListProps {
  alerts: SpendAlert[];
  /**
   * Set when the feed could not be read. Rendering the "no alerts" panel in
   * that case would claim the treasury is quiet when it is actually unknown.
   */
  unavailable?: string | null;
}

function formatAmount(stroops: bigint | string): string {
  const val = typeof stroops === "string" ? BigInt(stroops) : stroops;
  return (Number(val) / 10_000_000).toFixed(2);
}

function AlertBadge({ level }: { level: string }) {
  if (level === "breach") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-950/50 px-2.5 py-0.5 text-xs font-medium text-red-400 ring-1 ring-red-800/50">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Breach
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/50 px-2.5 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-amber-800/50">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Near Miss
    </span>
  );
}

export function AlertList({ alerts, unavailable }: AlertListProps) {
  if (unavailable) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-dashed border-amber-800/60 bg-amber-950/20 px-6 py-8 text-center"
      >
        <p className="text-sm font-semibold text-amber-300">{unavailable}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Alert history is unknown while the indexer database is unreachable — this is not the
          same as no alerts having been raised.
        </p>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
        <svg
          className="mx-auto mb-3 h-8 w-8 text-zinc-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm text-zinc-500">
          No alerts have been raised for this account.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="min-w-full divide-y divide-zinc-800">
        <thead className="bg-zinc-900/80">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Level
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Event Amount
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Window Total
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Cap
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Raised At
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Webhook
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {alerts.map((alert) => (
            <tr
              key={alert.id}
              className="transition-colors hover:bg-zinc-900/50"
            >
              <td className="whitespace-nowrap px-4 py-3">
                <AlertBadge level={alert.level} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-zinc-300">
                {formatAmount(alert.eventAmount)} XLM
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-zinc-300">
                {formatAmount(alert.totalSpentInWindow)} XLM
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-zinc-300">
                {formatAmount(alert.cap)} XLM
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-500">
                {new Date(alert.raisedAt).toLocaleString()}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {alert.webhookDelivered ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    Delivered
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                      />
                    </svg>
                    Pending
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
