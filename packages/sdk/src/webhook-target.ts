/**
 * Webhook destination policy.
 *
 * Alert webhooks are operator-supplied URLs that the indexer POSTs to with a
 * bearer secret attached. Left unchecked they are an SSRF primitive: point the
 * webhook at `http://169.254.169.254/`, at a database on `127.0.0.1`, or at a
 * hostnames that resolves to either, and the deployment will happily deliver a
 * signed request — and the secret — to wherever you wanted to reach.
 *
 * This module holds the *pure* part of that decision (no DNS, no sockets), so
 * the write-time API check and the dispatcher's delivery-time check cannot
 * drift apart. Resolving a hostname to addresses and re-checking every redirect
 * hop lives in the indexer, on top of these functions.
 */

export interface AllowedWebhookTarget {
  ok: true;
  url: URL;
}

export interface RejectedWebhookTarget {
  ok: false;
  /** Safe to show to the operator: names the rule, never the secret. */
  reason: string;
}

export type WebhookTargetCheck = AllowedWebhookTarget | RejectedWebhookTarget;

export type WebhookTargetOptions = {
  /**
   * Relax the *network* rules — private ranges, special-use hostnames,
   * non-default ports — for local development against `http://localhost:PORT`.
   * The protocol and embedded-credential rules still apply, so this cannot turn
   * into `file:///etc/passwd`. Deployments leave it off.
   */
  allowPrivateNetworks?: boolean;
};

/** Hostnames that are special-use by definition (RFC 6761 / RFC 8375). */
const SPECIAL_USE_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

/** Ports belonging to databases, caches and admin surfaces, not webhooks. */
const BLOCKED_PORTS: Record<number, string> = {
  25: "SMTP",
  110: "POP3",
  143: "IMAP",
  445: "SMB",
  1433: "SQL Server",
  2375: "Docker daemon",
  3306: "MySQL",
  5432: "PostgreSQL",
  6379: "Redis",
  9200: "Elasticsearch",
  11211: "Memcached",
  27017: "MongoDB",
};

function reject(reason: string): RejectedWebhookTarget {
  return { ok: false, reason };
}

/** Dotted-quad text → four octets, or null for anything else. */
export function parseIpv4(address: string): number[] | null {
  const trimmed = address.replace(/^\[|\]$/g, "");
  const parts = trimmed.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * IPv6 text → 16 bytes, with `::` compression and an embedded IPv4 tail.
 * Returns null for anything that is not a well-formed IPv6 literal.
 */
export function parseIpv6(address: string): number[] | null {
  const trimmed = address.replace(/^\[|\]$/g, "");
  if (!trimmed.includes(":")) return null;

  const [head = "", ...rest] = trimmed.split("::");
  const compression = rest.length > 0;
  if (rest.length > 1) return null;

  const expand = (group: string): number[] | null => {
    if (group === "") return [];
    const pieces = group.split(":").filter((p) => p !== "");
    const words: number[] = [];
    for (const piece of pieces) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(piece)) {
        const octets = parseIpv4(piece);
        if (!octets) return null;
        words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      words.push(Number.parseInt(piece, 16));
    }
    return words;
  };

  const headWords = head === "" ? [] : expand(head);
  const tailWords = compression ? expand(rest[0] ?? "") : [];
  if (!headWords || !tailWords) return null;

  const words = compression
    ? [...headWords, ...new Array(Math.max(0, 8 - headWords.length - tailWords.length)).fill(0), ...tailWords]
    : [...headWords, ...tailWords];

  if (words.length !== 8) return null;

  const bytes: number[] = [];
  for (const word of words) bytes.push((word >> 8) & 0xff, word & 0xff);
  return bytes;
}

function bits(value: number[]): number[] {
  const out: number[] = [];
  for (const byte of value) {
    for (let shift = 7; shift >= 0; shift -= 1) out.push((byte >> shift) & 1);
  }
  return out;
}

function inPrefix(bytes: number[], network: string, prefixBits: number): boolean {
  const net = parseIpv4(network) ?? parseIpv6(network);
  if (!net || net.length !== bytes.length) return false;
  const valueBits = bits(bytes);
  const netBits = bits(net);
  for (let i = 0; i < prefixBits; i += 1) {
    if (valueBits[i] !== netBits[i]) return false;
  }
  return true;
}

/** RFC 1918 / RFC 3927 / loopback / CGNAT / multicast / reserved, in order. */
const BLOCKED_IPV4_NETWORKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Unspecified, loopback, link-local, ULA, multicast, documented and discard. */
const BLOCKED_IPV6_NETWORKS: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

/**
 * True for every address a webhook must not be delivered to.
 *
 * Unparseable input is blocked: a destination we cannot classify is a
 * destination we do not call.
 */
export function isBlockedIpAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return BLOCKED_IPV4_NETWORKS.some(([net, bits]) => inPrefix(v4, net, bits));

  const v6 = parseIpv6(address);
  if (v6) {
    // `::ffff:127.0.0.1` and `::127.0.0.1` are IPv4 in IPv6 clothing.
    const mapped = v6.slice(0, 12).every((b, i) => (i < 10 ? b === 0 : b === 0xff));
    if (mapped) {
      const dotted = `${v6[12]}.${v6[13]}.${v6[14]}.${v6[15]}`;
      return isBlockedIpAddress(dotted);
    }
    return BLOCKED_IPV6_NETWORKS.some(([net, bits]) => inPrefix(v6, net, bits));
  }

  return true;
}

/**
 * Shape checks a webhook URL must pass before anything resolves it, and before
 * anything is written to the database.
 */
export function checkWebhookUrlShape(
  raw: string,
  options: WebhookTargetOptions = {}
): WebhookTargetCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("Webhook URL is not a valid absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject(`Unsupported webhook protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    return reject("Webhook URL must not embed credentials");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (!options.allowPrivateNetworks) {
    if (url.port !== "") {
      const port = Number(url.port);
      const service = BLOCKED_PORTS[port];
      if (service) {
        return reject(`Webhook port ${port} belongs to ${service}, not to a webhook receiver`);
      }
      if (port !== 80 && port !== 443) {
        return reject(
          `Webhook port ${port} is not allowed; deliver to the scheme default (80/443) or put a proxy in front`
        );
      }
    }

    if (host === "localhost" || SPECIAL_USE_SUFFIXES.some((suffix) => host.toLowerCase().endsWith(suffix))) {
      return reject(`${host} is a special-use hostname and cannot receive webhooks`);
    }

    // `new URL()` already normalises numeric hosts — 2130706433, 0177.0.0.1,
    // 0x7f000001 — into a dotted quad, so an IP literal here is canonical and
    // cannot hide behind a spelling.
    if (isIpAddressLike(host) && isBlockedIpAddress(host)) {
      return reject(`${host} is not a routable public address`);
    }
  }

  return { ok: true, url };
}

/** Is this hostname an IP literal, in a form the parser recognises? */
export function isIpAddressLike(host: string): boolean {
  const trimmed = host.replace(/^\[|\]$/g, "");
  if (parseIpv4(trimmed)) return true;
  if (trimmed.includes(":")) return parseIpv6(trimmed) !== null;
  // A bare decimal host has already been folded into a dotted quad by `URL`;
  // if one still arrives, treat it as an address rather than a name.
  return /^\d+$/.test(trimmed);
}

/**
 * Given every address a hostname resolved to, return the first one that must be
 * refused — or null when the whole set is safe to call.
 */
export function findBlockedAddress(
  addresses: string[],
  options: WebhookTargetOptions = {}
): string | null {
  if (options.allowPrivateNetworks) return null;
  if (addresses.length === 0) return "<no address returned>";
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) return address;
  }
  return null;
}
