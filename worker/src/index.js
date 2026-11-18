// The site (brand.js DOMAIN) as one Cloudflare Worker: the website (web/app/ as static assets), its fetch proxy (/api/fetch), and
// what iOS needs from a server when the app signs on the phone (/sign/*). Nothing here signs, and no key or
// certificate ever comes here (worker/README.md).
//
//   GET  /sign/status                       {ok, ttl, worker: true}: Settings > Signing asks if this server answers
//   GET  /sign/manifest?bundleid=&version=&title=&port=&path=
//                                           the itms-services manifest for an IPA the phone serves itself at
//                                           http://127.0.0.1:<port>/<path> (iOS wants HTTPS only for the manifest)
//   POST /sign/host?bundleid=&version=&title=   body: an IPA the phone signed (iFizBox's own update: iOS closes
//                                           iFizBox, and its local server, while installing over it) -> {itms, ...};
//                                           kept TTL seconds in KV, then gone
//   GET  /sign/host/<token>/manifest.plist, /sign/host/<token>/app.ipa   what that itms link fetches
//
//   POST /sign/upload?bundleid=&version=&title=&size=   F93: an app the website signed in the browser (any app) ->
//                                           {token, partSize, parts}; then PUT /sign/upload/<token>/<i> each part (KV
//                                           holds 25 MB a value, a Worker request ~100 MB), POST /sign/upload/<token>/done
//                                           -> {itms, ...}; GET /sign/up/<token>/manifest.plist and app.ipa (HEAD,
//                                           Range) for TTL seconds, like /sign/host
//   GET  /sign/up/<token>/status            F190: what iOS has done with that link, from its own requests:
//                                           {manifest, started, finished} (manifest.plist fetched, app.ipa's body begun,
//                                           and streamed to its end); the website shows it after "Installing"
//                                           F121: &token=<48 hex> without size reserves the website's own token, whose
//                                           link it opened inside the Install tap: manifest.plist answers at once from
//                                           its own query (bundleid, version, title), else once the reservation lands
//                                           (up to 15 s); app.ipa holds up to 2 minutes: headers once the upload has
//                                           started, the body once it's done. The same POST with token and size starts it
//   GET/PUT/DELETE /api/account/<id>       F97: iFizBox Account's encrypted blob (src/account.js)
//   GET  /api/fetch?url=&kind=ipa           F93: an IPA for the website's signer, streamed, up to MAX_UPLOAD_MB
//   GET  /api/applookup?bundleId=&country=  F161: Apple's iTunes Search API lookup of one app by bundle ID (the
//                                           app page's App Store details), its first result only; cached a day
//   GET  /api/ipainfo?url=<IPA URL>          F160: MinimumOSVersion, UIDeviceFamily, bundle ID and version from the IPA's
//                                           own Info.plist, read with Range requests (src/ipainfo.js); cached 30 days
//   GET/POST/DELETE /reviews/<package id>[/<review id>[/report]]   F182: user reviews in D1 (src/reviews.js)
//   GET  /repo/<file>                       B17: iFizBox's own flat APT repo (Release, Packages, Packages.gz, *.deb),
//                                           the latest release's asset fetched here, redirects followed here
//
// Settings (wrangler.toml [vars]): HOST_IDS, the bundle IDs /sign/host takes ("*.ifizbox" = any ending in .ifizbox);
// TTL (seconds, 600); MAX_UPLOAD_MB (512), the largest IPA /sign/upload and kind=ipa take ("0": no uploads). KV
// namespace binding: HOSTED.

import { account, isAccountPath } from "./account.js";
import { readIpaInfo, IpaError } from "./ipainfo.js";
import { reviews, isReviewsPath } from "./reviews.js";
import { NAME, GITHUB_REPO, DOMAIN } from "../../web/app/brand.js";

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

export function allowed(bundleId, list = "*.ifizbox") {
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
// A day at the edge for a release file that came, never an error: a 404 cached for a day kept "upstream answered
// HTTP 404" after the missing file was uploaded (user 2026-11-18, iFizBox.ipa added to v0.9.3).
const RELEASE_CACHE = { cacheEverything: true, cacheTtlByStatus: { "200-299": 86400, "300-599": 0 } };
export const releaseFile = (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(String(url));
// GitHub limits requests per address, and Workers share theirs with other sites: a 429 (or a 5xx) is tried again
// after a short wait, up to 3 times (user 2026-11-18: "upstream answered HTTP 429" installing iFizBox).
// A GitHub release file: { owner, repo, tag (null for latest), file }, or null.
export function githubRelease(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/(?:download\/([^/]+)|latest\/download)\/([^/?#]+)$/.exec(String(url));
  return m ? { owner: m[1], repo: m[2], tag: m[3] ? decodeURIComponent(m[3]) : null, file: decodeURIComponent(m[4]) } : null;
}

// GitHub limits anonymous downloads per address, and Cloudflare's addresses are shared: when github.com still says
// 429, the same file comes through GitHub's API with GITHUB_TOKEN (a token with no permissions: public repos only),
// limited per token instead. The asset's real address (GitHub's blob store) is fetched without the token.
async function viaGitHubApi(url, token, { fetcher = fetch } = {}) {
  const g = githubRelease(url);
  if (!g || !token) return null;
  const api = { Authorization: `Bearer ${token}`, "User-Agent": DOMAIN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const rel = await fetcher(`https://api.github.com/repos/${g.owner}/${g.repo}/releases/${g.tag ? `tags/${encodeURIComponent(g.tag)}` : "latest"}`, { headers: api });
  if (!rel.ok) return null;
  const asset = ((await rel.json()).assets ?? []).find((a) => a.name === g.file);
  if (!asset?.url) return null;
  const hop = await fetcher(asset.url, { headers: { ...api, Accept: "application/octet-stream" }, redirect: "manual" });
  const where = hop.headers.get("location");
  if (!where) return hop.ok ? hop : null;
  return fetcher(where, { headers: { "User-Agent": DOMAIN }, cf: RELEASE_CACHE });
}

export async function upstream(url, { fetcher = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), token = null } = {}) {
  const cf = releaseFile(url) ? RELEASE_CACHE : { cacheTtl: 0 };
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 30 s for the answer to start, not for the whole body: a 40 MB IPA streams for longer than that ("Load failed")
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try { r = await fetcher(url, { headers: CYDIA, redirect: "follow", cf, signal: ctl.signal }); } finally { clearTimeout(timer); }
    // A 404 the edge kept (from before RELEASE_CACHE, or a redirect's hop, as releases/latest/download's to the
    // tagged file): ask the server itself once.
    if (r.status === 404) r = await fetcher(url, { headers: CYDIA, redirect: "follow", cache: "no-store" });
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

// ---- /repo/: iFizBox's own APT repo (B17) -----------------------------------------------------------------------
// The repo's files are assets of every GitHub release (tools/release.sh, tools/selfrepo.py), and
// github.com/<repo>/releases/latest/download/<file> redirects to release-assets.githubusercontent.com/...?sig=&jwt=,
// a URL Zebra 1.1.36 names its cache file after: too long, "the file name is invalid", the source shows red. Here
// the Worker follows the redirect and answers with the file itself, so https://<DOMAIN>/repo/ has no redirect.
// Only the repo's own names are fetched (anything else, InRelease, Packages.xz, icons: 404 without asking GitHub).
// IFIZBOX_REPO (owner/name) picks another GitHub repo's releases (default brand.js GITHUB_REPO).
const SELF_REPO = GITHUB_REPO;
const REPO_TYPES = { "Release": "text/plain; charset=utf-8", "Packages": "text/plain; charset=utf-8", "Packages.gz": "application/gzip" };
export function repoFile(pathname) {
  const m = /^\/repo\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1]); } catch { return null; }
  if (REPO_TYPES[name]) return { name, type: REPO_TYPES[name] };
  return /^[A-Za-z0-9][A-Za-z0-9.+~_-]{0,200}\.deb$/.test(name) ? { name, type: "application/vnd.debian.binary-package" } : null;
}
export async function repo(req, u, env = {}, { fetcher = fetch, wait } = {}) {
  if (u.pathname === "/repo" || u.pathname === "/repo/") {
    if (u.pathname === "/repo") return Response.redirect(`${u.origin}/repo/`, 301);
    return new Response(`${NAME}'s own APT repo: add this address in ${NAME}, Sileo or Zebra.\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  }
  const f = repoFile(u.pathname);
  if (!f || !["GET", "HEAD"].includes(req.method)) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  const name = /^[\w.-]+\/[\w.-]+$/.test(env.IFIZBOX_REPO ?? "") ? env.IFIZBOX_REPO : SELF_REPO;
  const src = `https://github.com/${name}/releases/latest/download/${encodeURIComponent(f.name)}`;
  let r;
  try { r = await upstream(src, { fetcher, token: env.GITHUB_TOKEN ?? null, ...(wait ? { wait } : {}) }); } catch {
    return new Response("GitHub didn't answer\n", { status: 502, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  if (!r.ok) {
    r.body?.cancel?.();
    const status = r.status === 404 ? 404 : 502;
    return new Response(status === 404 ? "Not found\n" : `GitHub answered HTTP ${r.status}\n`, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  // Release and Packages change with every release: clients ask again after 5 minutes; a .deb is named by version
  // (iFizBox.deb, the one fixed name, is never in Packages' Filename: apt fetches the versioned name).
  const headers = { "Content-Type": f.type, "Cache-Control": `public, max-age=${f.name.endsWith(".deb") ? 3600 : 300}`, "X-Content-Type-Options": "nosniff", ...CORS };
  for (const h of ["content-length", "last-modified", "etag"]) { const v = r.headers.get(h); if (v) headers[h] = v; }
  if (req.method === "HEAD") { r.body?.cancel?.(); return new Response(null, { headers }); }
  return new Response(r.body, { headers, encodeBody: "manual" });
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

// F190: iOS's own requests on an upload's link, so the website can say what iOS is doing (Safari never hears back
// from itms-services). A key of its own, not the upload's metadata: the website's reservation, size and done
// writes replace that metadata whole and would drop a mark iOS made in between. Each mark is written once
// (read first; KV's free tier counts writes, 1,000 a day), so an install costs at most 3 writes.
const iosKey = (t) => `up.${t}.ios`;
export const IOS_MARKS = ["manifest", "started", "finished"];
async function iosStatus(env, t) {
  const r = await env.HOSTED.getWithMetadata(iosKey(t), { type: "stream" });
  r.value?.cancel?.();
  return r.metadata ?? {};
}
async function markIos(env, t, mark, ttl) {
  try {
    const s = await iosStatus(env, t);
    if (s[mark]) return;
    await env.HOSTED.put(iosKey(t), "", { expirationTtl: ttl + 300, metadata: { ...s, [mark]: true } });
  } catch { /* a missed mark only leaves the website's log a step behind */ }
}
const partLen = (m, i) => (i < m.parts - 1 ? m.partSize : m.size - m.partSize * (m.parts - 1));

// /sign/upload/... and /sign/up/...: a Response, or null for a path that isn't these.
async function uploads(req, u, env, ttl) {
  const max = uploadCap(env);
  if (u.pathname === "/sign/upload" && req.method === "POST") {
    if (!max) return fail("not_allowed", "This server doesn't take apps signed on the website.", 403);
    const app = appOf(u.searchParams), size = Number(u.searchParams.get("size"));
    if (!app) return fail("bad_request", "Send bundleid, version and title in the query.");
    // F121: the website may name its own token (opened as an install link inside the Install tap, before it signs) and
    // reserve it without a size (the signed size isn't known yet); the same POST with the size starts the upload.
    const own = u.searchParams.get("token");
    if (own !== null && !TOKEN.test(own)) return fail("bad_request", "A token is 48 hex digits.");
    const before = own ? await metaOf(env, own) : null;
    if (before && (!before.reserved || before.parts || before.bundleId !== app.bundleId)) return fail("bad_request", "That token is taken.", 409);
    if (!u.searchParams.has("size") && own) {
      if (!before) await env.HOSTED.put(upKey(own), "", { expirationTtl: ttl, metadata: { ...app, reserved: true, done: false } });
      return json({ token: own, reserved: true, expiresIn: ttl });
    }
    if (!Number.isSafeInteger(size) || size < 4) return fail("bad_request", "Send the IPA's size in bytes (size=).");
    if (size > max) return fail("too_large", tooBig(max), 413);
    const t = own ?? token(), parts = Math.ceil(size / PART);
    await env.HOSTED.put(upKey(t), "", { expirationTtl: ttl, metadata: { ...app, ...(own ? { reserved: true } : {}), size, parts, partSize: PART, done: false } });
    return json({ token: t, partSize: PART, parts, expiresIn: ttl });
  }
  const p = /^\/sign\/upload\/([0-9a-f]{48})\/(\d{1,4}|done)$/.exec(u.pathname);
  if (p && (req.method === "PUT" || req.method === "POST")) {
    const meta = await metaOf(env, p[1]);
    if (!meta) return fail("gone", "That upload has expired. Install again.", 404);
    if (meta.done) return fail("bad_request", "That upload is finished.", 409);
    if (!meta.parts) return fail("bad_request", "Send the size first (POST /sign/upload with token and size).", 409);
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
  const st = /^\/sign\/up\/([0-9a-f]{48})\/status$/.exec(u.pathname);
  if (st && req.method === "GET") {
    const s = await iosStatus(env, st[1]);
    return json(Object.fromEntries(IOS_MARKS.map((k) => [k, Boolean(s[k])])));
  }
  const h = /^\/sign\/up\/([0-9a-f]{48})\/(manifest\.plist|app\.ipa)$/.exec(u.pathname);
  if (h && (req.method === "GET" || req.method === "HEAD")) {
    // F121: a reserved link is opened before its upload. Its manifest answers at once from the link's own query (the
    // website knows the bundle ID it will sign as), else from the reservation, waited for (the website sends it just
    // after opening the link); app.ipa answers its headers once the upload has started (its size known), and its body
    // once it's done (bodyWait). A plain upload's link is only made once it's done, so nothing there waits.
    const started = (m) => !m || m.done || !m.reserved || (m.parts && !req.headers.get("Range"));
    const t0 = Date.now();
    let meta;
    if (h[2] === "manifest.plist") {
      meta = await metaOf(env, h[1]);
      const asked = appOf(u.searchParams);
      if (!meta && asked) {
        if (req.method === "GET") await markIos(env, h[1], "manifest", ttl);
        return plist(manifest({ url: `${u.origin}/sign/up/${h[1]}/app.ipa`, ...asked }));
      }
      if (!meta) meta = await waitFor(() => metaOf(env, h[1]), (m) => Boolean(m), MANIFEST_WAIT, env);
      if (!meta?.done && !meta?.reserved) return fail("gone", "That install link has expired.", 404);
      if (req.method === "GET") await markIos(env, h[1], "manifest", ttl);
      return plist(manifest({ url: `${u.origin}/sign/up/${h[1]}/app.ipa`, ...meta }));
    }
    meta = await waitFor(() => metaOf(env, h[1]), started, IPA_WAIT, env);
    if (!meta?.done && !(meta?.reserved && meta.parts && !req.headers.get("Range"))) {
      return fail("gone", meta ? "The app wasn't uploaded in time. Install again." : "That install link has expired.", 404);
    }
    let bodyWait = meta.done ? null : () => waitFor(() => metaOf(env, h[1]), (m) => !m || m.done, Math.max(0, IPA_WAIT - (Date.now() - t0)), env);
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
    let begun = false;
    const body = new ReadableStream({
      async pull(c) {
        if (bodyWait) {
          const m = await bodyWait();
          bodyWait = null;
          if (!m?.done) { c.error(new Error("not uploaded in time")); return; }
        }
        if (i > last) { c.close(); return; }
        const data = await env.HOSTED.get(partKey(h[1], i), { type: "arrayBuffer" });
        if (!data) { c.error(new Error("expired")); return; }
        if (!begun) { begun = true; await markIos(env, h[1], "started", ttl); } // F190
        const from = i * meta.partSize;
        c.enqueue(new Uint8Array(data.slice(Math.max(0, start - from), Math.min(data.byteLength, end - from + 1))));
        i++;
        // F190: the app's last byte is handed over (a Range that stops short of it isn't the end)
        if (i > last && end === n - 1) await markIos(env, h[1], "finished", ttl);
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

// F121: how long a reserved link's requests wait (ms), and how often they look again. iOS asks for the manifest the
// moment the link opens, before the website's reservation lands; app.ipa after Install in iOS's prompt, while the
// website still signs and uploads. env.WAIT_SCALE (tests) shrinks the waits.
export const MANIFEST_WAIT = 15000, IPA_WAIT = 120000, POLL = 1500;
const TOKEN = /^[0-9a-f]{48}$/;
export async function waitFor(read, ok, ms, env = {}, sleep = (t) => new Promise((r) => setTimeout(r, t))) {
  const scale = Number(env.WAIT_SCALE ?? 1) || 0, end = Date.now() + ms * scale;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() + POLL * scale > end) return v;
    await sleep(POLL * scale);
  }
}

async function metaOf(env, t, part = null) {
  const r = await env.HOSTED.getWithMetadata(part === null ? upKey(t) : partKey(t, part), { type: "stream" });
  r.value?.cancel?.();
  return r.metadata ?? null;
}

// ---- /api/applookup: one app's App Store details (F161) -------------------------------------------------------
// The website asks here, not Apple, so the answer is cached at the edge for a day (Cloudflare's cache; node.mjs hands
// an in-memory one as env.LOOKUP_CACHE) and every visitor's look at an app costs Apple one request a day.
// Only a bundle ID and a two-letter country go to Apple; the answer is { resultCount, results: [first app] }.
export const LOOKUP_TTL_S = 86400;
export async function appLookup(u, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  const bundleId = u.searchParams.get("bundleId") ?? "";
  const country = (u.searchParams.get("country") || "us").toLowerCase();
  if (!/^[A-Za-z0-9.-]{1,155}$/.test(bundleId) || !/^[a-z]{2}$/.test(country)) return fail("bad_request", "Send bundleId and a two-letter country.");
  const apple = `https://itunes.apple.com/lookup?${new URLSearchParams({ bundleId, country })}`;
  const key = new Request(`https://applookup.ifizbox.internal/${country}/${encodeURIComponent(bundleId)}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  let r;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try { r = await fetcher(apple, { headers: { Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: LOOKUP_TTL_S }, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
  } catch { return fail("upstream", "The App Store didn't answer.", 502); }
  if (!r.ok) return fail("upstream", `The App Store answered HTTP ${r.status}.`, 502);
  let body;
  try { body = JSON.parse(await r.text()); } catch { return fail("upstream", "The App Store's answer wasn't JSON.", 502); }
  const first = Array.isArray(body?.results) ? body.results.find((x) => x && typeof x === "object") : null;
  const res = new Response(JSON.stringify({ resultCount: first ? 1 : 0, results: first ? [first] : [] }), { headers: {
    "Content-Type": "application/json", "Cache-Control": `public, max-age=${LOOKUP_TTL_S}`, "X-Content-Type-Options": "nosniff", ...CORS } });
  if (cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}

// ---- /api/ipainfo: what an IPA's own Info.plist says (F160) ------------------------------------------------------
// For apps whose source gives no iOS range (AppTesters gives none for 10,000 apps): the app page asks here once, and
// the answer is cached at the edge for 30 days keyed by the IPA's URL (node.mjs: env.LOOKUP_CACHE), so each IPA is
// read once for everyone. Only Range requests (src/ipainfo.js readIpaInfo): a server that sends the whole file is
// answered "no_range" at once. Errors that won't change (no_range, not_zip, no_plist, not_found) are cached a day;
// "upstream" (timeouts, 5xx, 429) isn't.
export const IPAINFO_TTL_S = 30 * 86400;
const PERMANENT = new Set(["no_range", "not_zip", "no_plist", "bad_plist", "too_large", "not_found"]);
export function rangeReader(url, { fetcher = fetch, timeout = 20000, maxRequests = 6 } = {}) {
  let asked = 0;
  return async (start, end) => {
    if (++asked > maxRequests) throw new IpaError("too_large", "Too many reads for one IPA.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let r;
    try {
      r = await fetcher(url, { headers: { "User-Agent": DOMAIN, Range: `bytes=${start}-${end}` },
        redirect: "follow", signal: ctl.signal });
    } catch { clearTimeout(timer); throw new IpaError("upstream", "The IPA's server didn't answer."); }
    try {
      if (r.status === 200) { r.body?.cancel?.(); throw new IpaError("no_range", "The IPA's server doesn't answer Range requests."); }
      if (r.status === 404 || r.status === 410) { r.body?.cancel?.(); throw new IpaError("not_found", `The IPA's server answered HTTP ${r.status}.`); }
      if (r.status === 416) { r.body?.cancel?.(); throw new IpaError("not_zip", "The IPA's server refused that range."); }
      if (r.status !== 206) { r.body?.cancel?.(); throw new IpaError("upstream", `The IPA's server answered HTTP ${r.status}.`); }
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get("content-range") ?? "");
      if (!m) { r.body?.cancel?.(); throw new IpaError("no_range", "The IPA's server sent a part without saying which."); }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length !== Number(m[2]) - Number(m[1]) + 1 || Number(m[1]) !== start) {
        throw new IpaError("no_range", "The IPA's server sent another part than asked.");
      }
      return { bytes, total: Number(m[3]) };
    } catch (e) {
      if (e instanceof IpaError) throw e;
      throw new IpaError("upstream", "The IPA's server stopped sending.");
    } finally { clearTimeout(timer); }
  };
}
export async function ipaInfo(u, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null, timeout } = {}) {
  const target = httpUrl(u.searchParams.get("url") ?? "");
  if (!target) return fail("bad_url", "Send the IPA's http(s) URL as url.");
  const key = new Request(`https://ipainfo.ifizbox.internal/?${new URLSearchParams({ url: target.href })}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  const answer = (body, status, ttl) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json",
    "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store", "X-Content-Type-Options": "nosniff", ...CORS } });
  let res;
  try {
    const info = await readIpaInfo(rangeReader(target.href, { fetcher, ...(timeout ? { timeout } : {}) }));
    res = answer(info, 200, IPAINFO_TTL_S);
  } catch (e) {
    const code = e instanceof IpaError ? e.code : "upstream";
    const permanent = PERMANENT.has(code);
    res = answer({ code, error: e instanceof IpaError ? e.message : "The IPA couldn't be read." }, permanent ? 422 : 502, permanent ? 86400 : 0);
    if (!permanent) return res;
  }
  if (cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}

const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const ttl = Math.max(60, Number(env.TTL) || 600);
    if (isAccountPath(u.pathname)) return account(req, env); // F97: iFizBox Account (src/account.js)
    if (isReviewsPath(u.pathname)) return reviews(req, env); // F182: user reviews (src/reviews.js)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api/fetch" && req.method === "GET") return apiFetch(u, uploadCap(env), env.GITHUB_TOKEN ?? null);
    if (u.pathname === "/api/applookup" && req.method === "GET") return appLookup(u, env);
    if (u.pathname === "/api/ipainfo" && req.method === "GET") return ipaInfo(u, env); // F160
    if (u.pathname === "/repo" || u.pathname.startsWith("/repo/")) return repo(req, u, env);
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
      if (!allowed(app.bundleId, env.HOST_IDS)) return fail("not_allowed", `This server hosts only ${NAME}'s own signed app.`, 403);
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
    return fail("not_found", `Nothing here. This is ${NAME}'s install server (github.com/${GITHUB_REPO}).`, 404);
  },
};
