import { describe, expect, it } from "vitest";
import {
  checkWebhookUrlShape,
  findBlockedAddress,
  isBlockedIpAddress,
  parseIpv6,
} from "../src/webhook-target.js";

describe("isBlockedIpAddress", () => {
  it.each([
    ["0.0.0.0", "this network"],
    ["10.42.0.7", "RFC 1918"],
    ["100.64.0.1", "CGNAT"],
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "cloud metadata"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.255", "RFC 1918"],
    ["192.168.1.1", "RFC 1918"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "limited broadcast"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fc00::1234", "unique local"],
    ["fd12:3456::1", "unique local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    ["64:ff9b::8.8.8.8", "NAT64 translation of a public address"],
  ])("refuses %s (%s)", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "192.0.1.1",
    "2002:6000:20f7:0:204:61ff:fe9d:f156",
    "2606:2800:220:1:248:1893:25c8:1946",
  ])("allows the publicly routable %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });

  it("fails closed on text that is not an address at all", () => {
    expect(isBlockedIpAddress("not-an-ip")).toBe(true);
    expect(isBlockedIpAddress("999.1.1.1")).toBe(true);
    expect(isBlockedIpAddress("1:2:3:4:5")).toBe(true);
  });

  it("parses IPv6 compression and an embedded IPv4 tail", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ]);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toHaveLength(16);
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("checkWebhookUrlShape", () => {
  it("accepts an ordinary HTTPS receiver", () => {
    const res = checkWebhookUrlShape("https://hooks.spendguard.io/alerts");
    expect(res.ok).toBe(true);
  });

  it.each([
    ["file:///etc/passwd", "protocol"],
    ["gopher://127.0.0.1:6379/_", "protocol"],
    ["http://localhost:3000/callback", "special-use hostname"],
    ["http://db.internal:5432/", "special-use hostname"],
    ["http://169.254.169.254/latest/meta-data/", "private address"],
    ["http://127.0.0.1/admin", "private address"],
    ["http://[::1]:8080/", "private address"],
    ["http://2130706433/", "decimal loopback, normalised by the URL parser"],
    ["http://10.0.0.9:6379/", "internal service port"],
    ["http://example.com:8080/hooks", "non-default port"],
    ["https://admin:hunter2@hooks.spendguard.io/", "embedded credentials"],
    ["not a url at all", "unparseable"],
  ])("refuses %s (%s)", (url) => {
    const res = checkWebhookUrlShape(url);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
  });

  it("names the reason the operator needs to fix it", () => {
    const res = checkWebhookUrlShape("http://169.254.169.254/latest/meta-data/");
    expect(!res.ok && res.reason).toMatch(/not a routable public address/);

    const port = checkWebhookUrlShape("https://hooks.spendguard.io:6379/");
    expect(!port.ok && port.reason).toMatch(/Redis/);
  });

  it("lets loopback through only when private networks are explicitly allowed", () => {
    const strict = checkWebhookUrlShape("http://127.0.0.1:3000/hook");
    expect(strict.ok).toBe(false);

    // Same URL, development switch on: still not `file:`, still no credentials.
    const loose = checkWebhookUrlShape("http://127.0.0.1:3000/hook", {
      allowPrivateNetworks: true,
    });
    expect(loose.ok).toBe(true);

    const stillBad = checkWebhookUrlShape("file:///etc/passwd", {
      allowPrivateNetworks: true,
    });
    expect(stillBad.ok).toBe(false);
  });
});

describe("findBlockedAddress", () => {
  it("refuses a hostname that resolves to both a public and an internal address", () => {
    expect(findBlockedAddress(["93.184.216.34", "10.0.0.5"])).toBe("10.0.0.5");
  });

  it("accepts a fully public answer set", () => {
    expect(findBlockedAddress(["93.184.216.34", "93.184.216.35"])).toBeNull();
  });

  it("refuses an empty answer set rather than assuming it was safe", () => {
    expect(findBlockedAddress([])).not.toBeNull();
  });

  it("is inert when private networks are allowed", () => {
    expect(
      findBlockedAddress(["127.0.0.1"], { allowPrivateNetworks: true })
    ).toBeNull();
  });
});
