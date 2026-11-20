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
//   GET  /sign/host/<token>/manifest.plist, /sign/host/<token>/app.ipa   what that itms link fetches (each looks
//                                           again for a few seconds before a 404: KV is eventually consistent)
//   GET  /sign/host/<token>/status          B83: {manifest, started, finished} as /sign/up's: the app stays open
//                                           until iOS has the whole IPA, then closes so iOS can install over it
//
//   POST /sign/upload?bundleid=&version=&title=&size=   F93: an app the website signed in the browser (any app) ->
//                                           {token, partSize, parts}; then PUT /sign/upload/<token>/<i> each part (KV
//                                           holds 25 MB a value, a Worker request ~100 MB), POST /sign/upload/<token>/done
//                                           -> {itms, ...}; GET /sign/up/<token>/manifest.plist and app.ipa (HEAD,
//                                           Range) for TTL seconds, like /sign/host
//   GET  /sign/up/<token>/status            F190: what iOS has done with that link, from its own requests:
//                                           {manifest, asked, started, finished} (manifest.plist fetched, app.ipa asked
//                                           for at all: Install tapped in iOS's prompt, its body begun, and streamed
//                                           to its end); the website shows it after "Installing"
//                                           F121: &token=<48 hex> without size reserves the website's own token, whose
//                                           link it opened inside the Install tap: manifest.plist answers at once from
//                                           its own query (bundleid, version, title), else once the reservation lands
//                                           (up to 15 s); app.ipa holds up to 2 minutes: headers once the upload has
//                                           started, the body once it's done. The same POST with token and size starts it
//   POST /sign/upload/<token>/fail          B95: the website's sign failed after iOS was sent to that link: its held and
//                                           later manifest.plist and app.ipa answer 404 at once (refused once parts came)
//   GET/PUT/DELETE /api/account/<id>       F97: iFizBox Account's encrypted blob (src/account.js)
//   GET  /api/fetch?url=&kind=ipa           F93: an IPA for the website's signer, streamed, up to MAX_UPLOAD_MB
//   GET  /api/applookup?bundleId=&country=  F161: Apple's iTunes Search API lookup of one app by bundle ID (the
//                                           app page's App Store details), its first result only; cached a day
//   GET  /api/appreviews?id=&country=       B37: Apple's customer-reviews RSS (JSON) for one App Store id, cached a day
//   GET  /api/ipainfo?url=<IPA URL>          F160: MinimumOSVersion, UIDeviceFamily, bundle ID and version from the IPA's
//                                           own Info.plist, read with Range requests (src/ipainfo.js); cached 30 days
//   GET/POST/DELETE /reviews/<package id>[/<review id>[/report]]   F182: user reviews in D1 (src/reviews.js)
//   GET  /repo/<file>                       B17: iFizBox's own flat APT repo (Release, Packages, Packages.gz, *.deb),
//                                           the latest release's asset fetched here, redirects followed here
//   GET  /repo/<tag>/<file>.deb             B73: an older release's .deb (Packages' Filename), from releases/download/<tag>/
//   GET  /repo/source.json                  F178: iFizBox's AltStore source (the deployed web/app/source.json, else the
//                                           latest release's source.json asset), the sideload app's built-in source
//   GET  /repo/CydiaIcon.png                B58: the repo's icon (also @2x/@3x): the app icon from ASSETS, kept a week
//
// Settings (wrangler.toml [vars]): HOST_IDS, the bundle IDs /sign/host takes ("*.ifizbox" = any ending in .ifizbox);
// TTL (seconds, 600); MAX_UPLOAD_MB (512), the largest IPA /sign/upload and kind=ipa take ("0": no uploads). KV
// namespace binding: HOSTED.

import { account, isAccountPath } from "./account.js";
import { readIpaInfo, IpaError } from "./ipainfo.js";
import { reviews, isReviewsPath } from "./reviews.js";
import { reports, isReportsPath } from "./reports.js";
import { udid, isUdidPath } from "./udid.js";
import { appleRelay, isApplePath } from "./apple-relay.js";
import { setup, isSetupPath } from "./setup.js";
import { push, isPushPath, scheduled as pushScheduled } from "./push.js";
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

export async function upstream(url, { fetcher = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), token = null, range = null } = {}) {
  const cf = releaseFile(url) ? RELEASE_CACHE : { cacheTtl: 0 };
  // B95: a Range (bytes=n-) goes on, so the website can resume an IPA whose body broke off
  const asked = range ? { ...CYDIA, Range: range } : CYDIA;
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 30 s for the answer to start, not for the whole body: a 40 MB IPA streams for longer than that ("Load failed")
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try { r = await fetcher(url, { headers: asked, redirect: "follow", cf, signal: ctl.signal }); } finally { clearTimeout(timer); }
    // A 404 the edge kept (from before RELEASE_CACHE, or a redirect's hop, as releases/latest/download's to the
    // tagged file): ask the server itself once.
    if (r.status === 404) r = await fetcher(url, { headers: asked, redirect: "follow", cache: "no-store" });
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
// Only the repo's own names are fetched (anything else, InRelease, Packages.xz: 404 without asking GitHub; the icon
// is the app's own, repoIcon below).
// IFIZBOX_REPO (owner/name) picks another GitHub repo's releases (default brand.js GITHUB_REPO).
const SELF_REPO = GITHUB_REPO;
const REPO_TYPES = { "Release": "text/plain; charset=utf-8", "Packages": "text/plain; charset=utf-8", "Packages.gz": "application/gzip" };
// B73: Packages keeps every release's iFizBox (tools/selfrepo.py), each Filename `<tag>/<file>.deb`: /repo/<tag>/<file>.deb
// is that release's asset, releases/download/<tag>/<file> (only vX.Y.Z tags and .debs; it never changes once published).
const DEB_NAME = /^[A-Za-z0-9][A-Za-z0-9.+~_-]{0,200}\.deb$/;
export function repoFile(pathname) {
  const t = /^\/repo\/(v\d{1,4}\.\d{1,4}\.\d{1,4})\/([^/]+)$/.exec(pathname);
  if (t) {
    let name;
    try { name = decodeURIComponent(t[2]); } catch { return null; }
    return DEB_NAME.test(name) ? { name, tag: t[1], type: "application/vnd.debian.binary-package" } : null;
  }
  const m = /^\/repo\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1]); } catch { return null; }
  if (REPO_TYPES[name]) return { name, type: REPO_TYPES[name] };
  return DEB_NAME.test(name) ? { name, type: "application/vnd.debian.binary-package" } : null;
}
// F178: /repo/source.json, iFizBox's AltStore source beside its APT repo (the sideload app's and the site's built-in
// source, core/essential.js SELF_ALT_URL): the deployed web/app/source.json (ASSETS, updated by tools/release.sh
// and committed), else the latest release's source.json asset. JSON with CORS, kept 5 minutes like Release.
const SOURCE_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", ...CORS };
export async function selfSource(req, u, env = {}, { fetcher = fetch, wait } = {}) {
  if (!["GET", "HEAD"].includes(req.method)) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  let r = null;
  if (env.ASSETS) {
    try { r = await env.ASSETS.fetch(new Request(`${u.origin}/source.json`)); } catch { r = null; }
    if (r && !r.ok) { r.body?.cancel?.(); r = null; }
  }
  if (!r) {
    const name = /^[\w.-]+\/[\w.-]+$/.test(env.IFIZBOX_REPO ?? "") ? env.IFIZBOX_REPO : SELF_REPO;
    try { r = await upstream(`https://github.com/${name}/releases/latest/download/source.json`, { fetcher, token: env.GITHUB_TOKEN ?? null, ...(wait ? { wait } : {}) }); } catch { r = null; }
    if (!r?.ok) {
      r?.body?.cancel?.();
      return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
  }
  if (req.method === "HEAD") { r.body?.cancel?.(); return new Response(null, { headers: SOURCE_HEADERS }); }
  return new Response(r.body, { headers: SOURCE_HEADERS });
}

// B58: /repo/CydiaIcon.png (and @2x/@3x), the repo's icon in package managers' source lists: iFizBox's own app icon,
// the deployed web/app/icons/icon-180.png (ASSETS; the same PNG as native/icon/AppIcon60x60@3x.png), never GitHub.
// It changes with a redesign at most: kept a week, a day more stale while revalidating.
const REPO_ICON = /^\/repo\/CydiaIcon(@[23]x)?\.png$/;
const REPO_ICON_ASSET = "/icons/icon-180.png";
export async function repoIcon(req, u, env = {}) {
  const none = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  if (!["GET", "HEAD"].includes(req.method) || !env.ASSETS) return none();
  let r;
  try { r = await env.ASSETS.fetch(new Request(`${u.origin}${REPO_ICON_ASSET}`)); } catch { return none(); }
  if (!r?.ok) { r?.body?.cancel?.(); return none(); }
  const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", "X-Content-Type-Options": "nosniff", ...CORS };
  for (const h of ["content-length", "etag", "last-modified"]) { const v = r.headers.get(h); if (v) headers[h] = v; }
  if (req.method === "HEAD") { r.body?.cancel?.(); return new Response(null, { headers }); }
  return new Response(r.body, { headers });
}

export async function repo(req, u, env = {}, { fetcher = fetch, wait } = {}) {
  if (u.pathname === "/repo" || u.pathname === "/repo/") {
    if (u.pathname === "/repo") return Response.redirect(`${u.origin}/repo/`, 301);
    return new Response(`${NAME}'s own APT repo: add this address in ${NAME}, Sileo or Zebra.\n${NAME}'s AltStore source (the app without a jailbreak): ${u.origin}/repo/source.json\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  }
  if (u.pathname === "/repo/source.json") return selfSource(req, u, env, { fetcher, wait });
  if (REPO_ICON.test(u.pathname)) return repoIcon(req, u, env);
  const f = repoFile(u.pathname);
  if (!f || !["GET", "HEAD"].includes(req.method)) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  const name = /^[\w.-]+\/[\w.-]+$/.test(env.IFIZBOX_REPO ?? "") ? env.IFIZBOX_REPO : SELF_REPO;
  const src = f.tag
    ? `https://github.com/${name}/releases/download/${f.tag}/${encodeURIComponent(f.name)}`
    : `https://github.com/${name}/releases/latest/download/${encodeURIComponent(f.name)}`;
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
  // A tagged .deb (B73) is a published release's asset, which never changes: a day.
  const headers = { "Content-Type": f.type, "Cache-Control": `public, max-age=${f.tag ? 86400 : f.name.endsWith(".deb") ? 3600 : 300}`, "X-Content-Type-Options": "nosniff", ...CORS };
  for (const h of ["content-length", "last-modified", "etag"]) { const v = r.headers.get(h); if (v) headers[h] = v; }
  if (req.method === "HEAD") { r.body?.cancel?.(); return new Response(null, { headers }); }
  return new Response(r.body, { headers, encodeBody: "manual" });
}

// F178: a proxied URL that is this Worker's own /repo/ file (the site's built-in source, https://<DOMAIN>/repo/source.json)
// is answered here, not fetched: a Worker's fetch of its own custom domain doesn't come back to it.
export function ownRepoUrl(target, u) {
  const hosts = new Set([DOMAIN, `www.${DOMAIN}`, u.host]);
  return target.protocol === "https:" && hosts.has(target.host) && /^\/repo(\/|$)/.test(target.pathname) ? target : null;
}

async function apiFetch(u, maxBytes = MAX_UPLOAD, token = null, env = {}, range = null) {
  const target = httpUrl(u.searchParams.get("url") ?? "");
  if (!target) return fetchErr("bad_url", "Only http(s) URLs can be fetched.", 400);
  const kind = u.searchParams.get("kind") ?? "";
  if (!kind && ownRepoUrl(target, u)) {
    const r = await repo(new Request(target.href), target, env);
    if (!r.ok) return fetchErr("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
    return new Response(r.body, { headers: { ...SAFE, "Content-Type": r.headers.get("content-type") ?? "application/octet-stream", "X-Source-URL": encodeURI(target.href) } });
  }
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
    if (kind === "ipa") return ipaFetch(target, maxBytes, token, range);
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
// F257: the website's words for its cap (web/app/core/websign.js SITE_LIMIT_TEXT), the same number (MAX_UPLOAD_MB = IPA_MAX)
const tooBig = (max) => `The website signs apps up to ${Math.round(max / 1024 / 1024)} MB.`;

// The IPA, streamed through (no buffering: a Worker has 128 MB): headers within 30 s, then as long as the body takes,
// refused up front when its Content-Length is over maxBytes. `rangeAsked`: the website's Range (bytes=n-) to resume.
async function ipaFetch(target, maxBytes, token = null, rangeAsked = null) {
  if (!maxBytes) return fetchErr("refused", "This server doesn't sign on the website.", 403);
  const range = /^bytes=\d+-$/.test(rangeAsked ?? "") ? rangeAsked : null;
  // The same download as everything else: retries, a day's edge cache for GitHub release files, the token on a 429.
  const r = await upstream(target.href, { token, range });
  if (!r.ok) return fetchErr("upstream", `upstream answered HTTP ${r.status}`, r.status >= 400 && r.status < 600 ? r.status : 502);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > maxBytes) { r.body?.cancel(); return fetchErr("too_large", tooBig(maxBytes), 413); }
  // B95: the body goes out untouched, no JS per chunk: a JS TransformStream here (byte cap, short-end check) cost
  // Worker CPU for every chunk, and a 104 MB IPA ran out of it ("exceededCpu"), its body ending short but cleanly.
  // Untouched, Cloudflare streams it natively and Content-Length survives. The website checks the cap and the length
  // itself (signing-client.js downloadIpa, X-IPA-Length), and resumes a short body with Range, passed through here.
  const total = range && r.status === 206 ? Number(/\/(\d+)$/.exec(r.headers.get("content-range") ?? "")?.[1] || 0) : len;
  if (total > maxBytes) { r.body?.cancel(); return fetchErr("too_large", tooBig(maxBytes), 413); }
  return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers: { ...SAFE, "Content-Type": "application/octet-stream",
    ...(len ? { "Content-Length": String(len) } : {}),
    ...(total ? { "X-IPA-Length": String(total) } : {}),
    ...(r.status === 206 && r.headers.get("content-range") ? { "Content-Range": r.headers.get("content-range") } : {}),
    "Access-Control-Expose-Headers": "X-IPA-Length, Content-Range",
    "X-Source-URL": encodeURI(r.url) } });
}

const upKey = (t) => `up.${t}`, partKey = (t, i) => `up.${t}.${i}`;

// F190: iOS's own requests on an upload's link, so the website can say what iOS is doing (Safari never hears back
// from itms-services). A key of its own, not the upload's metadata: the website's reservation, size and done
// writes replace that metadata whole and would drop a mark iOS made in between. Each mark is written once
// (read first; KV's free tier counts writes, 1,000 a day), so an install costs at most 3 writes.
const iosKey = (t) => `up.${t}.ios`;
export const IOS_MARKS = ["manifest", "started", "finished"];
// B90: /sign/up's links also mark "asked": iOS's first app.ipa request (HEAD or GET, even one held while the website
// signs), which only comes once Install was tapped in iOS's prompt. The website reads a manifest without it, after
// the page comes back, as the prompt cancelled. A worker without it answers no "asked" key: the website carries on.
export const UP_MARKS = ["manifest", "asked", "started", "finished"];
// B83: iFizBox's own update (/sign/host/<t>) keeps the same marks under hostIosKey; `key` picks which.
async function iosStatus(env, t, key = iosKey(t)) {
  const r = await env.HOSTED.getWithMetadata(key, { type: "stream" });
  r.value?.cancel?.();
  return r.metadata ?? {};
}
async function markIos(env, t, mark, ttl, key = iosKey(t)) {
  try {
    const s = await iosStatus(env, t, key);
    if (s[mark]) return;
    await env.HOSTED.put(key, "", { expirationTtl: ttl + 300, metadata: { ...s, [mark]: true } });
  } catch { /* a missed mark only leaves the website's log a step behind */ }
}
const partLen = (m, i) => (i < m.parts - 1 ? m.partSize : m.size - m.partSize * (m.parts - 1));

// /sign/upload/... and /sign/up/...: a Response, or null for a path that isn't these.
async function uploads(req, u, env, ttl, ctx = null) {
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
    if (before && (!before.reserved || before.parts || before.failed || before.bundleId !== app.bundleId)) return fail("bad_request", "That token is taken.", 409);
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
  // B95: the website's sign failed (or was cancelled) after iOS was sent to its early link: iOS's held app.ipa, and
  // every request on the link after it, answer an error at once instead of holding (iOS showed a blank, stuck icon).
  const f = /^\/sign\/upload\/([0-9a-f]{48})\/fail$/.exec(u.pathname);
  if (f && req.method === "POST") {
    const meta = await metaOf(env, f[1]);
    if (meta?.done || meta?.parts) return fail("bad_request", "That upload has begun.", 409);
    if (!meta?.failed) await env.HOSTED.put(upKey(f[1]), "", { expirationTtl: ttl, metadata: { ...(meta ?? {}), reserved: true, failed: true, done: false } });
    return json({ ok: true });
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
      await env.HOSTED.put(upKey(p[1]), "", { expirationTtl: ttl, metadata: { ...meta, done: true, doneAt: Date.now() } }); // F258: setup codes count from doneAt
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
    return json(Object.fromEntries(UP_MARKS.map((k) => [k, Boolean(s[k])])));
  }
  const h = /^\/sign\/up\/([0-9a-f]{48})\/(manifest\.plist|app\.ipa)$/.exec(u.pathname);
  if (h && (req.method === "GET" || req.method === "HEAD")) {
    // F121: a reserved link is opened before its upload. Its manifest answers at once from the link's own query (the
    // website knows the bundle ID it will sign as), else from the reservation, waited for (the website sends it just
    // after opening the link); app.ipa answers its headers once the upload has started (its size known), and its body
    // once it's done (bodyWait). A plain upload's link is only made once it's done, so nothing there waits.
    const started = (m) => !m || m.done || !m.reserved || m.failed || (m.parts && !req.headers.get("Range"));
    const stopped = () => fail("gone", "That install was stopped: the app couldn't be signed.", 404); // B95
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
      if (meta.failed) return stopped();
      if (req.method === "GET") await markIos(env, h[1], "manifest", ttl);
      return plist(manifest({ url: `${u.origin}/sign/up/${h[1]}/app.ipa`, ...meta }));
    }
    await markIos(env, h[1], "asked", ttl); // B90: before the hold, so the website hears of it while it signs
    meta = await waitFor(() => metaOf(env, h[1]), started, IPA_WAIT, env);
    if (meta?.failed) return stopped();
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
    // FixedLengthStream (Cloudflare) keeps the Content-Length on a streamed body; Node's tests use a plain one.
    const f = typeof FixedLengthStream === "function" ? new FixedLengthStream(end - start + 1) : new TransformStream();
    const job = upPump(env, h[1], meta, start, end, n, ttl, f.writable, bodyWait).catch((e) => f.writable.abort(e).catch(() => {}));
    // the client hangs up once it has Content-Length bytes, which ended the request before the finished mark (seen in
    // wrangler tail as "canceled"): the pump runs to its end
    ctx?.waitUntil?.(job);
    return new Response(f.readable, { status, headers });
  }
  return null;
}

// B95: app.ipa's bytes, part by part from KV into `out`. A part sent whole is KV's own stream piped natively (no JS per
// chunk, no copy: a 104 MB app copied through JS ran into the Worker's CPU limit); only a Range's first and last
// part, cut, go through pipeCut (streamed, never read whole). F190: started with the first part, finished once the app's
// last byte is handed over (a Range that stops short of it isn't the end).
async function upPump(env, t, meta, start, end, n, ttl, out, bodyWait) {
  if (bodyWait) {
    const m = await bodyWait();
    if (!m?.done) throw new Error("not uploaded in time");
  }
  const last = Math.floor(end / meta.partSize);
  for (let i = Math.floor(start / meta.partSize); i <= last; i++) {
    const from = i * meta.partSize, size = partLen(meta, i);
    const a = Math.max(0, start - from), b = Math.min(size, end - from + 1);
    const data = await env.HOSTED.get(partKey(t, i), { type: "stream" });
    if (!data) throw new Error("expired");
    if (i === Math.floor(start / meta.partSize)) await markIos(env, t, "started", ttl);
    if (a === 0 && b === size) await data.pipeTo(out, { preventClose: true });
    else await pipeCut(data, a, b, size, out);
  }
  if (end === n - 1) await markIos(env, t, "finished", ttl);
  await out.close();
}

// B96: bytes a..b of a part's KV stream (size bytes) into `out`, without reading the part whole (a 20 MB arrayBuffer
// per cut part cost a Range ~37 ms of Worker CPU). Chunks before `a` are dropped as they come; from the chunk holding
// `a`, a cut that runs to the part's end hands the rest to a native pipe, and one that stops short cancels KV's
// stream once it has `b`. Chunks go on as views, never copied.
async function pipeCut(data, a, b, size, out) {
  const rd = data.getReader(), w = out.getWriter();
  let pos = 0, native = false;
  try {
    while (pos < b) {
      const { done, value } = await rd.read();
      if (done) throw new Error("part cut short");
      const c = value instanceof Uint8Array ? value : new Uint8Array(value);
      const lo = Math.max(0, a - pos), hi = Math.min(c.byteLength, b - pos);
      pos += c.byteLength;
      if (hi > lo) await w.write(lo === 0 && hi === c.byteLength ? c : c.subarray(lo, hi));
      if (pos >= a && b === size && pos < b) { native = true; break; }
    }
  } finally {
    w.releaseLock();
    if (!native) rd.cancel().catch(() => {}); // stops KV's read past b (and releases the stream)
    else rd.releaseLock();
  }
  if (native) await data.pipeTo(out, { preventClose: true });
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

// ---- /sign/host/<t>/...: iFizBox's own update, the IPA the phone uploaded (B83) ---------------------------------
// manifest.plist and app.ipa look again for HOST_WAIT ms before answering 404: KV is eventually consistent, and iOS
// asks for them seconds after the put (it gives up silently on a 404). iOS's requests leave F190's marks (manifest,
// started, finished: app.ipa's body streamed to its end) under hostIosKey, read at GET status by the app, which
// closes for iOS to install over it only once iOS has the whole IPA.
export const HOST_WAIT = 6000;
const HOST_CHUNK = 1024 * 1024; // app.ipa goes out a MB a pull, so "finished" waits for iOS to read the last of it
const hostIosKey = (t) => `${t}.ios`;
async function hosted(req, u, env, ttl, t, what) {
  const gone = () => fail("gone", "That install link has expired.", 404);
  if (what === "status") {
    const s = await iosStatus(env, t, hostIosKey(t));
    return json(Object.fromEntries(IOS_MARKS.map((k) => [k, Boolean(s[k])])));
  }
  const get = req.method === "GET";
  if (what === "manifest.plist") {
    const read = () => env.HOSTED.getWithMetadata(t, { type: "stream" }).then((r) => { r.value?.cancel?.(); return r.metadata ?? null; });
    const metadata = await waitFor(read, Boolean, HOST_WAIT, env);
    if (!metadata) return gone();
    if (get) await markIos(env, t, "manifest", ttl, hostIosKey(t));
    return plist(manifest({ url: `${u.origin}/sign/host/${t}/app.ipa`, ...metadata }));
  }
  const data = await waitFor(() => env.HOSTED.get(t, { type: "arrayBuffer" }), Boolean, HOST_WAIT, env);
  if (!data) return gone();
  const n = data.byteLength;
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
  if (!get) return new Response(null, { status, headers });
  let at = start, begun = false;
  const body = new ReadableStream({
    async pull(c) {
      if (at > end) { c.close(); return; }
      if (!begun) { begun = true; await markIos(env, t, "started", ttl, hostIosKey(t)); }
      const stop = Math.min(end + 1, at + HOST_CHUNK);
      c.enqueue(new Uint8Array(data.slice(at, stop)));
      at = stop;
      // the IPA's last byte is handed over (a Range that stops short of it isn't the end)
      if (at > end && end === n - 1) await markIos(env, t, "finished", ttl, hostIosKey(t));
    },
  });
  if (typeof FixedLengthStream === "function") { // Cloudflare: keeps the Content-Length on a streamed body
    const f = new FixedLengthStream(end - start + 1);
    body.pipeTo(f.writable).catch(() => {});
    return new Response(f.readable, { status, headers });
  }
  return new Response(body, { status, headers });
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

// ---- /api/appreviews: one app's recent App Store reviews (B37) --------------------------------------------------
// Apple's customer-reviews RSS (JSON) for one App Store id, cached at the edge for a day like /api/applookup. Only a
// numeric id and a two-letter country reach Apple; the answer is Apple's JSON as it came (core/applookup.js
// parseStoreReviews reads it), capped at 512 KiB.
export const REVIEWS_TTL_S = 86400;
export async function appReviews(u, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  const id = u.searchParams.get("id") ?? "";
  const country = (u.searchParams.get("country") || "us").toLowerCase();
  if (!/^\d{1,15}$/.test(id) || !/^[a-z]{2}$/.test(country)) return fail("bad_request", "Send a numeric App Store id and a two-letter country.");
  const apple = `https://itunes.apple.com/${country}/rss/customerreviews/id=${id}/sortby=mostrecent/json`;
  const key = new Request(`https://appreviews.ifizbox.internal/${country}/${id}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  let r;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try { r = await fetcher(apple, { headers: { Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: REVIEWS_TTL_S }, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
  } catch { return fail("upstream", "The App Store didn't answer.", 502); }
  if (!r.ok) return fail("upstream", `The App Store answered HTTP ${r.status}.`, 502);
  let text;
  try { text = await r.text(); } catch { return fail("upstream", "The App Store stopped sending.", 502); }
  if (text.length > 512 * 1024) return fail("upstream", "The App Store's answer was too large.", 502);
  try { JSON.parse(text); } catch { return fail("upstream", "The App Store's answer wasn't JSON.", 502); }
  const res = new Response(text, { headers: {
    "Content-Type": "application/json", "Cache-Control": `public, max-age=${REVIEWS_TTL_S}`, "X-Content-Type-Options": "nosniff", ...CORS } });
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
  // F280: the Cron Trigger (wrangler.toml [triggers]): the push check (src/push.js), off without an APNs key.
  async scheduled(event, env, ctx) { await pushScheduled(event, env, ctx); },
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    const ttl = Math.max(60, Number(env.TTL) || 600);
    if (isAccountPath(u.pathname)) return account(req, env); // F97: iFizBox Account (src/account.js)
    if (isReviewsPath(u.pathname)) return reviews(req, env); // F182: user reviews (src/reviews.js)
    if (isReportsPath(u.pathname)) return reports(req, env); // F291: Report as Malicious (src/reports.js)
    if (isUdidPath(u.pathname)) return udid(req, env); // F253: this iPhone's UDID via a profile (src/udid.js)
    if (isApplePath(u.pathname)) return appleRelay(req, env); // F251: Apple sign-in relay (src/apple-relay.js)
    if (isPushPath(u.pathname)) return push(req, env); // F280: push notifications (src/push.js)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api/fetch" && req.method === "GET") return apiFetch(u, uploadCap(env), env.GITHUB_TOKEN ?? null, env, req.headers.get("Range"));
    if (u.pathname === "/api/applookup" && req.method === "GET") return appLookup(u, env);
    if (u.pathname === "/api/appreviews" && req.method === "GET") return appReviews(u, env); // B37
    if (u.pathname === "/api/ipainfo" && req.method === "GET") return ipaInfo(u, env); // F160
    if (u.pathname === "/repo" || u.pathname.startsWith("/repo/")) return repo(req, u, env);
    if (u.pathname === "/healthz") return new Response("ok\n", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    if (u.pathname === "/sign/status") return json({ ok: true, ttl, worker: true, zsign: false, upload: uploadCap(env) });
    if (isSetupPath(u.pathname)) return setup(req, u, env, ttl, { upstream, repo: SELF_REPO }); // F258: src/setup.js
    if (u.pathname.startsWith("/sign/up")) { const r = await uploads(req, u, env, ttl, ctx); if (r) return r; }

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

    const h = /^\/sign\/host\/([0-9a-f]{48})\/(manifest\.plist|app\.ipa|status)$/.exec(u.pathname);
    if (h && (req.method === "GET" || req.method === "HEAD")) return hosted(req, u, env, ttl, h[1], h[2]);

    // Everything else is the website (web/app/, Workers static assets: revalidated on every load, so a phone never
    // keeps an old file). /add?url=… and other app routes fall back to index.html (single-page application).
    // Only /sign and /sign/... are the server's: /signing-client.js and /signing-worker.js are the website's files.
    if (env.ASSETS && !/^\/sign(\/|$)/.test(u.pathname)) return env.ASSETS.fetch(req);
    return fail("not_found", `Nothing here. This is ${NAME}'s install server (github.com/${GITHUB_REPO}).`, 404);
  },
};
