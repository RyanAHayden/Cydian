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
//   POST /sign/upload?bundleid=&version=&title=&size=   F93: an app the website signed in the browser (any app) ->
//                                           {token, partSize, parts}; then PUT /sign/upload/<token>/<i> each part (KV
//                                           holds 25 MB a value, a Worker request ~100 MB), POST /sign/upload/<token>/done
//                                           -> {itms, ...}; GET /sign/up/<token>/manifest.plist and app.ipa (HEAD,
//                                           Range) for TTL seconds, like /sign/host
//   GET  /api/fetch?url=&kind=ipa           F93: an IPA for the website's signer, streamed, up to MAX_UPLOAD_MB
//
// Settings (wrangler.toml [vars]): HOST_IDS, the bundle IDs /sign/host takes ("*.cydian" = any ending in .cydian);
// TTL (seconds, 600); MAX_UPLOAD_MB (512), the largest IPA /sign/upload and kind=ipa take ("0": no uploads). KV
// namespace binding: HOSTED.

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
// GitHub release files never change once published: Cloudflare keeps them a day, so an install fetches GitHub once,
// not every time. Everything else (sources, Packages) is fetched fresh.
export const releaseFile = (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(String(url));
// GitHub limits requests per address, and Workers share theirs with other sites: a 429 (or a 5xx) is tried again
// after a short wait, up to 3 times (user 2026-11-18: "upstream answered HTTP 429" installing Cydian).
// A GitHub release file: { owner, repo, tag (null for latest), file }, or null.
export function githubRelease(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/(?:download\/([^/]+)|latest\/download)\/([^/?#]+)$/.exec(String(url));
  return m ? { owner: m[1], repo: m[2], tag: m[3] ? decodeURIComponent(m[3]) : null, file: decodeURIComponent(m[4]) } : null;
}

// GitHub limits anonymous downloads per address, and Cloudflare's addresses are shared: when github.com still says
// 429, the same file comes through GitHub's API with GITHUB_TOKEN (a token with no permissions: public repos only),
// limited per token instead. The asset's real address (GitHub's blob store) is fetched without the token.
export async function viaGitHubApi(url, token, { fetcher = fetch } = {}) {
  const g = githubRelease(url);
  if (!g || !token) return null;
  const api = { Authorization: `Bearer ${token}`, "User-Agent": "cydian.dev", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const rel = await fetcher(`https://api.github.com/repos/${g.owner}/${g.repo}/releases/${g.tag ? `tags/${encodeURIComponent(g.tag)}` : "latest"}`, { headers: api });
  if (!rel.ok) return null;
  const asset = ((await rel.json()).assets ?? []).find((a) => a.name === g.file);
  if (!asset?.url) return null;
  const hop = await fetcher(asset.url, { headers: { ...api, Accept: "application/octet-stream" }, redirect: "manual" });
  const where = hop.headers.get("location");
  if (!where) return hop.ok ? hop : null;
  return fetcher(where, { headers: { "User-Agent": "cydian.dev" }, cf: { cacheEverything: true, cacheTtl: 86400 } });
}

export async function upstream(url, { fetcher = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), token = null } = {}) {
  const cf = releaseFile(url) ? { cacheEverything: true, cacheTtl: 86400 } : { cacheTtl: 0 };
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 30 s for the answer to start, not for the whole body: a 40 MB IPA streams for longer than that ("Load failed")
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try { r = await fetcher(url, { headers: CYDIA, redirect: "follow", cf, signal: ctl.signal }); } finally { clearTimeout(timer); }
    if (r.status !== 429 && r.status < 500) return r;
    const after = Number(r.headers.get("retry-after"));
    await wait(Number.isFinite(after) && after > 0 && after <= 5 ? after * 1000 : 600 * (attempt + 1));
  }
  if (r.status === 429 && token) {
    const viaApi = await viaGitHubApi(url, token, { fetcher }).catch(() => null);
    if (viaApi?.ok) return viaApi;
  }
  return r;
}
async function apiFetch(u, maxBytes = MAX_UPLOAD, token = null) {
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
    if (kind === "ipa") return ipaFetch(target, maxBytes, token);
    if (kind) return fetchErr("bad_url", `unknown kind ${kind}`, 400);
    const r = await upstream(target.href, { token });
    if (!r.ok) return fetchErr("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
    const ctype = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return new Response(r.body, { headers: { ...SAFE, "Content-Type": PASS.includes(ctype) ? r.headers.get("content-type") : "application/octet-stream",
      "X-Source-URL": encodeURI(r.url), ...(r.headers.get("last-modified") ? { "Last-Modified": r.headers.get("last-modified") } : {}) } });
  } catch (e) {
    return fetchErr("network", String(e?.message ?? e), 502);
  }
}

// ---- F93: the website signs in the browser (web/app/signing-worker.js) and leaves the signed IPA here -----------
const MAX_UPLOAD = 512 * 1024 * 1024;
export const PART = 20 * 1024 * 1024; // under KV's 25 MB a value and a Worker request's 100 MB
export const uploadCap = (env) => (env.MAX_UPLOAD_MB === undefined || env.MAX_UPLOAD_MB === "" ? MAX_UPLOAD : Math.max(0, Number(env.MAX_UPLOAD_MB) || 0) * 1024 * 1024);
const tooBig = (max) => `Apps up to ${Math.round(max / 1024 / 1024)} MB can be signed on the website.`;

// The IPA, streamed through (no buffering: a Worker has 128 MB): headers within 30 s, then as long as the body takes,
// cut at maxBytes.
async function ipaFetch(target, maxBytes, token = null) {
  if (!maxBytes) return fetchErr("refused", "This server doesn't sign on the website.", 403);
  // The same download as everything else: retries, a day's edge cache for GitHub release files, the token on a 429.
  const r = await upstream(target.href, { token });
  if (!r.ok) return fetchErr("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > maxBytes) { r.body?.cancel(); return fetchErr("too_large", tooBig(maxBytes), 413); }
  let seen = 0;
  const cap = new TransformStream({ transform(chunk, c) {
    seen += chunk.byteLength;
    if (seen > maxBytes) c.error(new Error(tooBig(maxBytes))); else c.enqueue(chunk);
  } });
  return new Response(r.body.pipeThrough(cap), { headers: { ...SAFE, "Content-Type": "application/octet-stream",
    ...(len ? { "Content-Length": String(len) } : {}), "X-Source-URL": encodeURI(r.url) } });
}

const upKey = (t) => `up.${t}`, partKey = (t, i) => `up.${t}.${i}`;
const partLen = (m, i) => (i < m.parts - 1 ? m.partSize : m.size - m.partSize * (m.parts - 1));

// /sign/upload/... and /sign/up/...: a Response, or null for a path that isn't these.
async function uploads(req, u, env, ttl) {
  const max = uploadCap(env);
  if (u.pathname === "/sign/upload" && req.method === "POST") {
    if (!max) return fail("not_allowed", "This server doesn't take apps signed on the website.", 403);
    const app = appOf(u.searchParams), size = Number(u.searchParams.get("size"));
    if (!app) return fail("bad_request", "Send bundleid, version and title in the query.");
    if (!Number.isSafeInteger(size) || size < 4) return fail("bad_request", "Send the IPA's size in bytes (size=).");
    if (size > max) return fail("too_large", tooBig(max), 413);
    const t = token(), parts = Math.ceil(size / PART);
    await env.HOSTED.put(upKey(t), "", { expirationTtl: ttl, metadata: { ...app, size, parts, partSize: PART, done: false } });
    return json({ token: t, partSize: PART, parts, expiresIn: ttl });
  }
  const p = /^\/sign\/upload\/([0-9a-f]{48})\/(\d{1,4}|done)$/.exec(u.pathname);
  if (p && (req.method === "PUT" || req.method === "POST")) {
    const meta = await metaOf(env, p[1]);
    if (!meta) return fail("gone", "That upload has expired. Install again.", 404);
    if (meta.done) return fail("bad_request", "That upload is finished.", 409);
    if (p[2] === "done") {
      for (let i = 0; i < meta.parts; i++) {
        const got = await metaOf(env, p[1], i);
        if (got?.n !== partLen(meta, i)) return fail("bad_request", `Part ${i + 1} of ${meta.parts} is missing.`, 409);
      }
      await env.HOSTED.put(upKey(p[1]), "", { expirationTtl: ttl, metadata: { ...meta, done: true } });
      const m = `${u.origin}/sign/up/${p[1]}/manifest.plist`;
      return json({ itms: "itms-services://?action=download-manifest&url=" + encodeURIComponent(m), manifest: m,
        expiresIn: ttl, bundleId: meta.bundleId, name: meta.title, version: meta.version });
    }
    const i = Number(p[2]);
    if (i >= meta.parts) return fail("bad_request", "No such part.");
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength !== partLen(meta, i)) return fail("bad_request", `Part ${i + 1} should be ${partLen(meta, i)} bytes.`);
    if (i === 0 && (body[0] !== 0x50 || body[1] !== 0x4b)) return fail("bad_ipa", "That isn't an IPA (a zip archive).");
    // parts outlive the upload's own key by a few minutes, so a link never points at half an app
    await env.HOSTED.put(partKey(p[1], i), body.buffer, { expirationTtl: ttl + 300, metadata: { n: body.byteLength } });
    return json({ ok: true, part: i });
  }
  const h = /^\/sign\/up\/([0-9a-f]{48})\/(manifest\.plist|app\.ipa)$/.exec(u.pathname);
  if (h && (req.method === "GET" || req.method === "HEAD")) {
    const meta = await metaOf(env, h[1]);
    if (!meta?.done) return fail("gone", "That install link has expired.", 404);
    if (h[2] === "manifest.plist") return plist(manifest({ url: `${u.origin}/sign/up/${h[1]}/app.ipa`, ...meta }));
    const n = meta.size;
    let start = 0, end = n - 1, status = 200;
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("Range") ?? "");
    if (r && (r[1] || r[2])) { // iOS's installer may ask for parts
      start = r[1] ? Number(r[1]) : Math.max(0, n - Number(r[2]));
      end = r[1] && r[2] ? Math.min(n - 1, Number(r[2])) : n - 1;
      if (start > end || start >= n) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${n}` } });
      status = 206;
    }
    const headers = { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store",
      "Content-Length": String(end - start + 1), ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${n}` } : {}) };
    if (req.method === "HEAD") return new Response(null, { status, headers });
    let i = Math.floor(start / meta.partSize);
    const last = Math.floor(end / meta.partSize);
    const body = new ReadableStream({
      async pull(c) {
        if (i > last) { c.close(); return; }
        const data = await env.HOSTED.get(partKey(h[1], i), { type: "arrayBuffer" });
        if (!data) { c.error(new Error("expired")); return; }
        const from = i * meta.partSize;
        c.enqueue(new Uint8Array(data.slice(Math.max(0, start - from), Math.min(data.byteLength, end - from + 1))));
        i++;
      },
    });
    if (typeof FixedLengthStream === "function") { // Cloudflare: keeps the Content-Length on a streamed body
      const f = new FixedLengthStream(end - start + 1);
      body.pipeTo(f.writable).catch(() => {});
      return new Response(f.readable, { status, headers });
    }
    return new Response(body, { status, headers });
  }
  return null;
}

async function metaOf(env, t, part = null) {
  const r = await env.HOSTED.getWithMetadata(part === null ? upKey(t) : partKey(t, part), { type: "stream" });
  r.value?.cancel?.();
  return r.metadata ?? null;
}

const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const ttl = Math.max(60, Number(env.TTL) || 600);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api/fetch" && req.method === "GET") return apiFetch(u, uploadCap(env), env.GITHUB_TOKEN ?? null);
    if (u.pathname === "/healthz") return new Response("ok\n", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    if (u.pathname === "/sign/status") return json({ ok: true, ttl, worker: true, zsign: false, upload: uploadCap(env) });
    if (u.pathname.startsWith("/sign/up")) { const r = await uploads(req, u, env, ttl); if (r) return r; }

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
    // Only /sign and /sign/... are the server's: /signing-client.js and /signing-worker.js are the website's files.
    if (env.ASSETS && !/^\/sign(\/|$)/.test(u.pathname)) return env.ASSETS.fetch(req);
    return fail("not_found", "Nothing here. This is Cydian's install server (github.com/RyanAHayden/Cydian).", 404);
  },
};
