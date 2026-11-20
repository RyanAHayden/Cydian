// The SSRF guard's address rules, shared by both runtimes. Cloudflare's fetch can't reach private addresses, but the
// self-hosted server (node.mjs, often in Docker on 0.0.0.0) can: there every outgoing host is resolved and checked
// (src/ssrf-node.js), and here the literal forms are refused before any fetch on either runtime.
// Refused: unspecified, loopback, private (RFC 1918), CGNAT (100.64/10), link-local, ULA (fc00::/7), site-local,
// multicast, reserved and documentation ranges, broadcast, and IPv6 forms that carry one of those IPv4 addresses
// (v4-mapped ::ffff:a.b.c.d, v4-compatible ::a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16).

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4num = (s) => s.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const V4_RANGES = V4_BLOCKED.map(([a, bits]) => [v4num(a), 2 ** (32 - bits)]);

// A dotted IPv4 address (four decimal parts), or null.
function v4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return m && m.slice(1).every((p) => Number(p) <= 255) ? v4num(s) : null;
}
const v4Blocked = (n) => V4_RANGES.some(([start, size]) => n >= start && n < start + size);

// An IPv6 address as 8 numbers (16-bit groups), or null. Takes "::" and a trailing dotted IPv4 part.
function v6(s) {
  s = s.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  // a trailing dotted IPv4 part stands for the last two groups
  const dot = /:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dot) {
    const n = v4(dot[1]);
    if (n === null) return null;
    s = s.slice(0, -dot[1].length) + `${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  if (s.includes(".")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const given = head.length + rest.length;
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const zeros = halves.length === 2 ? 8 - given : 0;
  return [...head, ...Array(zeros).fill("0"), ...rest].map((g) => parseInt(g, 16));
}

// True when an IP address (v4 or v6, as text) is one the server must never fetch from. Anything that isn't an IP
// address at all is refused too: callers check resolved addresses here.
export function blockedIp(ip) {
  const s = String(ip ?? "");
  const n4 = v4(s);
  if (n4 !== null) return v4Blocked(n4);
  const g = v6(s);
  if (!g) return true;
  const embedded = (hi, lo) => v4Blocked(hi * 65536 + lo);
  const zeroTo = (k) => g.slice(0, k).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g[7] === 1) return true; // ::1
  if (zeroTo(5) && g[5] === 0xffff) return true; // ::ffff:a.b.c.d, any address: a public host resolves to plain v4 instead
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // local-use NAT64 64:ff9b:1::/48
  if (zeroTo(6)) return true; // ::a.b.c.d (deprecated v4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only 100::/64
  return false;
}

export const isIp = (s) => v4(String(s)) !== null || v6(String(s)) !== null;

// True when a URL's hostname is refused before any lookup: localhost names, and IP literals blockedIp refuses.
// WHATWG URL parsing already turns decimal, hex and octal IPv4 forms (http://2130706433/) into dotted ones.
export function blockedHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;
  const bare = h.replace(/^\[|\]$/g, "");
  return isIp(bare) ? blockedIp(bare) : false;
}

export const REFUSED_CODE = "SSRF_REFUSED";
export function refused(host) {
  const e = new Error(`${host} is a private or local address; this server only fetches public ones.`);
  e.code = REFUSED_CODE;
  return e;
}
