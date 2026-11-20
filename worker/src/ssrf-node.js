// The self-hosted server's outgoing fetch (node.mjs hands it to the Worker code as env.FETCH): the SSRF guard that
// Cloudflare's own fetch gives the Worker. Every host is resolved here and refused when any of its addresses is
// private, loopback, link-local, CGNAT, ULA, multicast or v4-mapped (src/ssrf.js blockedIp); the connection then goes
// to the address that was checked (no second lookup a DNS rebind could answer differently), and redirects are
// followed here, hop by hop, with the same check. Node-only: the Worker bundle never imports this file.
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { Readable } from "node:stream";
import { blockedIp, blockedHost, isIp, refused } from "./ssrf.js";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const bare = (h) => h.replace(/^\[|\]$/g, "");

// fetch(input, init) as the Worker code uses it: method, headers, body (string or bytes), signal and redirect
// ("follow", the default, or "manual"); Cloudflare's cf/cache options are ignored. The Response carries url and
// redirected like fetch's. Options (for tests): lookup(host) → [{ address, family }], blocked(ip, host) → bool,
// headersTimeout (ms until the answer's headers), maxRedirects.
export function guardedFetch({ lookup = (h) => dnsLookup(h, { all: true, verbatim: true }), blocked = (ip) => blockedIp(ip),
  headersTimeout = 30000, maxRedirects = 10 } = {}) {
  async function pin(url) {
    const host = bare(url.hostname);
    if (isIp(host)) {
      if (blocked(host, url.hostname)) throw refused(url.hostname);
      return null; // a literal: Node connects to it without a lookup
    }
    if (blockedHost(url.hostname) && blocked(host, url.hostname)) throw refused(url.hostname); // localhost names
    const found = await lookup(host);
    if (!found?.length) throw new Error(`${host} has no address`);
    if (found.some((a) => blocked(a.address, url.hostname))) throw refused(url.hostname);
    return found[0];
  }

  function once(url, { method, headers, body, signal }, at) {
    return new Promise((ok, no) => {
      const mod = url.protocol === "https:" ? https : http;
      const opts = { method, hostname: bare(url.hostname), port: url.port || undefined, path: url.pathname + url.search,
        headers, agent: false };
      if (at) opts.lookup = (_h, o, cb) => (o?.all ? cb(null, [at]) : cb(null, at.address, at.family));
      const req = mod.request(opts, (res) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); ok(res); });
      const fail = (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); no(e); };
      const onAbort = () => { req.destroy(); fail(signal.reason ?? new DOMException("The operation was aborted.", "AbortError")); };
      const timer = setTimeout(() => { req.destroy(); fail(new Error(`${url.host} didn't answer in ${headersTimeout / 1000} s`)); }, headersTimeout);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      req.on("error", fail);
      req.end(body ?? undefined);
    });
  }

  return async function fetch(input, init = {}) {
    const from = input instanceof Request ? input : null;
    let url = new URL(from ? from.url : String(input));
    let method = String(init.method ?? from?.method ?? "GET").toUpperCase();
    const h = new Headers(init.headers ?? from?.headers ?? undefined);
    let body = init.body ?? null;
    if (body !== null && typeof body !== "string" && !(body instanceof Uint8Array)) body = new Uint8Array(await new Response(body).arrayBuffer());
    const signal = init.signal ?? from?.signal ?? null;
    const manual = (init.redirect ?? from?.redirect ?? "follow") === "manual";
    for (let hop = 0; ; hop++) {
      if (!/^https?:$/.test(url.protocol)) throw new Error(`only http(s) is fetched, not ${url.protocol}`);
      const at = await pin(url);
      const res = await once(url, { method, headers: Object.fromEntries(h), body, signal }, at);
      const where = res.headers.location;
      if (!manual && REDIRECTS.has(res.statusCode) && where) {
        res.resume();
        if (hop >= maxRedirects) throw new Error("too many redirects");
        const next = new URL(where, url);
        if (next.origin !== url.origin) { h.delete("authorization"); h.delete("cookie"); }
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === "POST")) {
          method = method === "HEAD" ? "HEAD" : "GET"; body = null; h.delete("content-type"); h.delete("content-length");
        }
        url = next;
        continue;
      }
      const headers = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      const empty = method === "HEAD" || [204, 205, 304].includes(res.statusCode);
      if (empty) res.resume();
      const out = new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers });
      Object.defineProperty(out, "url", { value: url.href });
      Object.defineProperty(out, "redirected", { value: hop > 0 });
      return out;
    }
  };
}
