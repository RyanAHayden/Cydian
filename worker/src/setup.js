// The free route's one-time computer setup (F258): the website signs the app (LiveContainer with this app inside) on
// the phone, uploads it the usual way (/sign/upload, index.js) and asks here for a short code; the setup command on
// a computer (tools/setup/) asks the person for that code, reads what it points at, downloads the signed IPA and
// installs it over USB. The code is the only thing typed: no Apple ID ever reaches the computer.
//
//   POST /sign/setup?token=<48 hex>[&bundleid=<id>][&pairing=<path>|&pairing=][&sha256=<64 hex>]
//        { code: "ABCD-EFGH", expiresIn }  for a finished upload (its `done` mark); bundleid is the app whose
//        container gets the pairing file (default: the uploaded app's own), pairing the file's path in that container
//        (default PAIRING_PATH; empty: write none), sha256 the IPA's, which the command checks after downloading
//   GET  /sign/setup/<code>
//        { ipa, size, sha256, bundleId, name, version, pairing: { bundleId, path } | null, expiresIn }; `ipa` is the
//        upload's /sign/up/<token>/app.ipa. 404 { code: "gone" } once the code or its upload has expired.
//   GET  /sign/setup.sh, /sign/setup.ps1, /sign/setup/bin/<file>
//        the install scripts and the command's binaries: assets of the GitHub release tagged SETUP_TAG
//        (tools/setup/release.sh), fetched here so the one line people paste is https://<DOMAIN>/sign/setup.sh.
//        The scripts carry the binaries' SHA-256 and refuse a download that doesn't match.
//
// Codes live in the HOSTED KV namespace under "setup:<CODE>" no longer than the upload they point at (the upload's
// TTL counts again from its `done`, kept as doneAt, so the code gets what is left of it). 8 characters from a
// 31-letter alphabet without look-alikes (no 0/O, 1/I/L): about 39 bits, for a few minutes.

export const SETUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 letters, no 0 O 1 I L
export const PAIRING_PATH = "Documents/pairingFile.plist";
export const SETUP_TAG = "setup"; // the release tools/setup/release.sh publishes the command under
export const SETUP_FILES = ["install.sh", "install.ps1", "SHA256SUMS",
  "ifizbox-setup-macos", "ifizbox-setup-linux-x86_64", "ifizbox-setup-linux-arm64",
  "ifizbox-setup-windows-x64.exe", "ifizbox-setup-windows-arm64.exe"];
const CODE_LEN = 8;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const fail = (code, error, status = 400) => json({ code, error }, status);
const text = (body, status = 404) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const key = (c) => `setup:${c}`;
const TOKEN = /^[0-9a-f]{48}$/;
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

export const isSetupPath = (p) => p === "/sign/setup" || p === "/sign/setup.sh" || p === "/sign/setup.ps1" || p.startsWith("/sign/setup/");

// What a person typed, as the code it stands for: case, spaces and dashes don't matter; null when it can't be one.
export function normalCode(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== CODE_LEN || [...s].some((c) => !SETUP_ALPHABET.includes(c))) return null;
  return s;
}
export const showCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let out = "";
  while (out.length < CODE_LEN) {
    for (const b of random(CODE_LEN * 2)) {
      if (b < 248 && out.length < CODE_LEN) out += SETUP_ALPHABET[b % 31]; // 248 = 8 * 31: no bias
    }
  }
  return out;
}

// A path inside an app's container: relative, no "..", no empty parts, printable.
export function containerPath(p) {
  const s = String(p);
  if (!s || s.length > 255 || s.startsWith("/") || /[\x00-\x1f\\]/.test(s)) return null;
  const parts = s.split("/");
  return parts.every((x) => x && x !== "." && x !== "..") ? s : null;
}

async function meta(env, k) {
  const r = await env.HOSTED.getWithMetadata(k, { type: "stream" });
  r.value?.cancel?.();
  return r.metadata ?? null;
}

// The release asset `name` from SETUP_TAG of IFIZBOX_REPO (or brand.js GITHUB_REPO), streamed through.
async function asset(req, env, name, { upstream, repo }) {
  if (!["GET", "HEAD"].includes(req.method) || !SETUP_FILES.includes(name)) return text("Not found\n");
  const slug = /^[\w.-]+\/[\w.-]+$/.test(env.IFIZBOX_REPO ?? "") ? env.IFIZBOX_REPO : repo;
  const tag = /^[\w.-]{1,64}$/.test(env.SETUP_TAG ?? "") ? env.SETUP_TAG : SETUP_TAG;
  let r;
  try { r = await upstream(`https://github.com/${slug}/releases/download/${tag}/${name}`, { token: env.GITHUB_TOKEN ?? null }); } catch {
    return text("GitHub didn't answer\n", 502);
  }
  if (!r.ok) { r.body?.cancel?.(); return r.status === 404 ? text("Not found\n") : text(`GitHub answered HTTP ${r.status}\n`, 502); }
  const script = name.startsWith("install.") || name === "SHA256SUMS";
  const headers = { "Content-Type": script ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Cache-Control": `public, max-age=${script ? 300 : 3600}`, "X-Content-Type-Options": "nosniff", ...CORS };
  if (!script) headers["Content-Disposition"] = `attachment; filename="${name}"`;
  const len = r.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  if (req.method === "HEAD") { r.body?.cancel?.(); return new Response(null, { headers }); }
  return new Response(r.body, { headers, encodeBody: "manual" });
}

// `deps`: { upstream, repo } from index.js (GitHub fetches with its retries; brand.js GITHUB_REPO).
export async function setup(req, u, env, ttl, deps) {
  const p = u.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p === "/sign/setup.sh") return asset(req, env, "install.sh", deps);
  if (p === "/sign/setup.ps1") return asset(req, env, "install.ps1", deps);
  const bin = /^\/sign\/setup\/bin\/([^/]+)$/.exec(p);
  if (bin) return asset(req, env, bin[1], deps);

  if (p === "/sign/setup" && req.method === "POST") {
    const q = u.searchParams, t = q.get("token") ?? "";
    if (!TOKEN.test(t)) return fail("bad_request", "Send the upload's token (token=, 48 hex digits).");
    const up = await meta(env, `up.${t}`);
    if (!up) return fail("gone", "That upload has expired. Sign the app again.", 404);
    if (!up.done || up.failed) return fail("bad_request", "That upload isn't finished.", 409);
    const bundleId = q.get("bundleid") ?? up.bundleId;
    if (!BUNDLE.test(bundleId ?? "")) return fail("bad_request", "Bad bundle ID (bundleid=).");
    const rawPath = q.has("pairing") ? q.get("pairing") : PAIRING_PATH;
    const path = rawPath === "" ? "" : containerPath(rawPath);
    if (path === null) return fail("bad_request", "The pairing file's path is relative to the app's container, without '..' (pairing=).");
    const sha256 = q.get("sha256") ?? "";
    if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) return fail("bad_request", "sha256= is 64 lowercase hex digits.");
    // what is left of the upload's time (from its doneAt; at least KV's 60 s)
    const left = Math.max(60, ttl - Math.max(0, Math.floor((Date.now() - (Number(up.doneAt) || Date.now())) / 1000)));
    let code;
    for (let i = 0; i < 5 && !code; i++) {
      const c = newCode();
      if (!(await meta(env, key(c)))) code = c;
    }
    if (!code) return fail("busy", "No free code; try again.", 503);
    await env.HOSTED.put(key(code), "", { expirationTtl: left, metadata: { token: t, bundleId, path, sha256,
      expires: Date.now() + left * 1000 } });
    return json({ code: showCode(code), expiresIn: left });
  }

  const g = /^\/sign\/setup\/([^/]+)$/.exec(p);
  if (g && req.method === "GET") {
    let raw;
    try { raw = decodeURIComponent(g[1]); } catch { raw = ""; }
    const c = normalCode(raw);
    if (!c) return fail("bad_code", `A code is ${CODE_LEN} letters and digits, like ${showCode("ABCD2345")}.`);
    const m = await meta(env, key(c));
    const gone = () => fail("gone", "That code has expired or was never made. Make a new one on the iPhone.", 404);
    if (!m) return gone();
    const up = await meta(env, `up.${m.token}`);
    if (!up?.done || up.failed) return gone();
    return json({ ipa: `${u.origin}/sign/up/${m.token}/app.ipa`, size: up.size, sha256: m.sha256 || null,
      bundleId: up.bundleId, name: up.title, version: up.version,
      pairing: m.path ? { bundleId: m.bundleId, path: m.path } : null,
      expiresIn: Math.max(0, Math.round(((Number(m.expires) || Date.now()) - Date.now()) / 1000)) });
  }
  return fail("not_found", "Nothing here.", 404);
}
