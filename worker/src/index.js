// cydian.dev as one Cloudflare Worker: the website (web/app/ as static assets), its fetch proxy (/api/fetch), and
// what iOS needs from a server when the app signs on the phone (/sign/*). Nothing here signs, and no key or
// certificate ever comes here (worker/README.md).
//
//   GET  /sign/status                       {ok, ttl, worker: true}: Settings > Signing asks if this server answers
//   GET  /sign/manifest?bundleid=&version=&title=&port=&path=
//                                           the itms-services manifest for an IPA the phone serves itself at
//                                           http://127.0.0.1:<port>/<path> (iOS wants HTTPS only for the manifest)
//   POST /sign/host?bundleid=&version=&title=   body: an IPA the phone signed (Cydian's own update: iOS closes
//                                           Cydian, and its local server, while installing over it) -> {itms, ...};
//                                           kept TTL seconds in KV, then gone
//   GET  /sign/host/<token>/manifest.plist, /sign/host/<token>/app.ipa   what that itms link fetches
//
// Settings (wrangler.toml [vars]): HOST_IDS, the bundle IDs /sign/host takes ("*.cydian" = any ending in .cydian);
// TTL (seconds, 600). KV namespace binding: HOSTED.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
const MAX_IPA = 25 * 1024 * 1024; // KV's largest value
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const fail = (code, error, status = 400) => json({ code, error }, status);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function manifest({ url, bundleId, version, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
<key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${esc(url)}</string></dict></array>
<key>metadata</key><dict><key>bundle-identifier</key><string>${esc(bundleId)}</string><key>bundle-version</key><string>${esc(version)}</string><key>kind</key><string>software</string><key>title</key><string>${esc(title || bundleId)}</string></dict>
</dict></array></dict></plist>
`;
}
const plist = (body) => new Response(body, { headers: { "Content-Type": "application/xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

// bundleid, version and title from a query: null when they don't look like an app's.
export function appOf(q) {
  const bundleId = q.get("bundleid") ?? "", version = q.get("version") || "1.0", title = q.get("title") ?? "";
  if (!/^[A-Za-z0-9.-]{1,155}$/.test(bundleId) || version.length > 64 || title.length > 200) return null;
  return { bundleId, version, title };
}

export function allowed(bundleId, list = "*.cydian") {
  return list.split(",").map((s) => s.trim()).filter(Boolean)
    .some((p) => (p.startsWith("*.") ? bundleId.endsWith(p.slice(1)) : p === "*" || p === bundleId));
}

export function loopbackUrl(q) {
  const port = q.get("port") ?? "", path = q.get("path") ?? "";
  if (!/^\d{1,5}$/.test(port) || !/^[A-Za-z0-9/._-]{1,200}$/.test(path)) return null;
  return `http://127.0.0.1:${Number(port)}/${path.replace(/^\/+/, "")}`;
}

// ---- /api/fetch: the website's fetch proxy (APT and AltStore sources don't let a page read them) ----------------
// ?url=<URL>: the body. ?url=<repo dir>&kind=packages: the repo's Packages as gzip-encoded text, Packages.gz first,
// then plain Packages (gzipped here). Cloudflare's fetch can't reach private or loopback addresses, which is the SSRF
// guard the old server had to build itself. ponytail: no .xz/.bz2 (no decompressor here); the app reads those itself.
const CYDIA = { "User-Agent": "Telesphoreo APT-HTTP/1.0.592", "X-Machine": "iPhone14,2", "X-Firmware": "16.5" };
const SAFE = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store", ...CORS };
const PASS = ["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "application/json"];
const fetchErr = (code, error, status = 502) => new Response(JSON.stringify({ error, code }), { status, headers: { "Content-Type": "application/json", ...SAFE } });
export function httpUrl(raw) {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u : null; } catch { return null; }
}
async function upstream(url) {
  return fetch(url, { headers: CYDIA, redirect: "follow", cf: { cacheTtl: 0 }, signal: AbortSignal.timeout(30000) });
}
async function apiFetch(u) {
  const target = httpUrl(u.searchParams.get("url") ?? "");
  if (!target) return fetchErr("bad_url", "Only http(s) URLs can be fetched.", 400);
  const kind = u.searchParams.get("kind") ?? "";
  try {
    if (kind === "packages") {
      const dir = target.href.endsWith("/") ? target.href : target.href + "/";
      for (const [name, gz] of [["Packages.gz", true], ["Packages", false]]) {
        const r = await upstream(dir + name);
        if (!r.ok) continue;
        const body = gz ? r.body : r.body.pipeThrough(new CompressionStream("gzip"));
        return new Response(body, { encodeBody: "manual", headers: { ...SAFE, "Content-Type": "text/plain; charset=utf-8",
          "Content-Encoding": "gzip", "X-Source-URL": encodeURI(r.url), "Vary": "Accept-Encoding" } });
      }
      return fetchErr("not_found", "This repo has no Packages.gz or Packages file.", 404);
    }
    if (kind) return fetchErr("bad_url", `unknown kind ${kind}`, 400);
    const r = await upstream(target.href);
    if (!r.ok) return fetchErr("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
    const ctype = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return new Response(r.body, { headers: { ...SAFE, "Content-Type": PASS.includes(ctype) ? r.headers.get("content-type") : "application/octet-stream",
      "X-Source-URL": encodeURI(r.url), ...(r.headers.get("last-modified") ? { "Last-Modified": r.headers.get("last-modified") } : {}) } });
  } catch (e) {
    return fetchErr("network", String(e?.message ?? e), 502);
  }
}

const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const ttl = Math.max(60, Number(env.TTL) || 600);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api/fetch" && req.method === "GET") return apiFetch(u);
    if (u.pathname === "/healthz") return new Response("ok\n", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    if (u.pathname === "/sign/status") return json({ ok: true, ttl, worker: true, zsign: false });

    if (u.pathname === "/sign/manifest" && req.method === "GET") {
      const url = loopbackUrl(u.searchParams), app = appOf(u.searchParams);
      if (!url) return fail("bad_url", "Only an IPA on this iPhone (127.0.0.1) can be installed this way.");
      if (!app) return fail("bad_request", "Bad bundle ID, version or title.");
      return plist(manifest({ url, ...app }));
    }

    if (u.pathname === "/sign/host" && req.method === "POST") {
      const app = appOf(u.searchParams);
      if (!app) return fail("bad_request", "Send bundleid, version and title in the query.");
      if (!allowed(app.bundleId, env.HOST_IDS)) return fail("not_allowed", "This server hosts only Cydian's own signed app.", 403);
      const size = Number(req.headers.get("Content-Length") || 0);
      if (!size || size > MAX_IPA) return fail("too_large", "Send the signed IPA as the body (up to 25 MB).", 413);
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_IPA || new Uint8Array(body, 0, 2).join() !== "80,75") return fail("bad_ipa", "That isn't an IPA (a zip archive).");
      const t = token();
      await env.HOSTED.put(t, body, { expirationTtl: ttl, metadata: app });
      const m = `${u.origin}/sign/host/${t}/manifest.plist`;
      return json({ itms: "itms-services://?action=download-manifest&url=" + encodeURIComponent(m), manifest: m,
        expiresIn: ttl, bundleId: app.bundleId, name: app.title, version: app.version });
    }

    const h = /^\/sign\/host\/([0-9a-f]{48})\/(manifest\.plist|app\.ipa)$/.exec(u.pathname);
    if (h && (req.method === "GET" || req.method === "HEAD")) {
      if (h[2] === "manifest.plist") {
        const { metadata } = await env.HOSTED.getWithMetadata(h[1], { type: "stream" }).then((r) => { r.value?.cancel?.(); return r; });
        if (!metadata) return fail("gone", "That install link has expired.", 404);
        return plist(manifest({ url: `${u.origin}/sign/host/${h[1]}/app.ipa`, ...metadata }));
      }
      const data = await env.HOSTED.get(h[1], { type: "arrayBuffer" });
      if (!data) return fail("gone", "That install link has expired.", 404);
      const headers = { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("Range") ?? "");
      if (r && (r[1] || r[2])) { // iOS's installer may ask for parts
        const n = data.byteLength;
        const start = r[1] ? Number(r[1]) : Math.max(0, n - Number(r[2]));
        const end = r[1] && r[2] ? Math.min(n - 1, Number(r[2])) : n - 1;
        if (start > end || start >= n) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${n}` } });
        return new Response(req.method === "HEAD" ? null : data.slice(start, end + 1), { status: 206,
          headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${n}`, "Content-Length": String(end - start + 1) } });
      }
      return new Response(req.method === "HEAD" ? null : data, { headers: { ...headers, "Content-Length": String(data.byteLength) } });
    }

    // Everything else is the website (web/app/, Workers static assets: revalidated on every load, so a phone never
    // keeps an old file). /add?url=… and other app routes fall back to index.html (single-page application).
    if (env.ASSETS && !u.pathname.startsWith("/sign")) return env.ASSETS.fetch(req);
    return fail("not_found", "Nothing here. This is Cydian's install server (github.com/RyanAHayden/Cydian).", 404);
  },
};
