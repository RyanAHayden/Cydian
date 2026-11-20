// F291: Report as Malicious, kept in D1 beside the reviews (binding REVIEWS, src/reviews.js): no accounts, the same
// device token (X-Review-Token, kept only as a salted hash), the same rate limits. One report per device per app
// version; a second one from that device replaces its reason.
//
//   GET  /reports/<bundle id>?version=<v>   {enabled, count, reasons: {reason: n}, mine}: distinct devices for that
//                                            version; `mine` whether this token reported it
//   POST /reports/<bundle id>               {reason, text <= 200 (Something Else… only), version <= 64, sha256?}
//                                            -> {ok, count}
//
// The clients show a red "Reported as Malicious" card at REPORT_BANNER (10, web/app/core/malicious.js) devices. The
// maintainer reads the reports in D1 (`npx wrangler d1 execute`), and a confirmed one goes on the shipped malware list
// (web/app/core/malicious.js MALWARE_IPAS). Addresses are kept only as salted hashes, as for reviews.
// SPDX-License-Identifier: GPL-3.0-or-later

import { hashOf, allowReviewWrite, clean } from "./reviews.js";

export const REASONS = ["logins", "data", "profile", "takeover", "money", "fake", "other"];
export const TEXT_MAX = 200;
const PKG = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const SHA = /^[0-9a-f]{64}$/;
const PATH = /^\/reports\/([^/]+)\/?$/;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Review-Token" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS } });
const fail = (code, error, status = 400) => json({ code, error }, status);

export const isReportsPath = (pathname) => pathname === "/reports" || pathname.startsWith("/reports/");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS malicious_reports (pkg TEXT NOT NULL, version TEXT NOT NULL, device TEXT NOT NULL, reason TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (pkg, version, device))`,
];
const ready = new WeakMap();
function schema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

// A POST body -> { ok: true, report } or { ok: false, error }.
export function parseReport(b) {
  if (!b || typeof b !== "object") return { ok: false, error: "Send JSON: {reason, text, version, sha256}." };
  if (!REASONS.includes(b.reason)) return { ok: false, error: "Unknown reason." };
  const text = clean(typeof b.text === "string" ? b.text : "", TEXT_MAX); // one line, no bidi overrides (src/reviews.js)
  if (text === null) return { ok: false, error: `Text is at most ${TEXT_MAX} characters.` };
  if (b.reason === "other" && !text) return { ok: false, error: "Say what it did." };
  const version = typeof b.version === "string" || typeof b.version === "number" ? String(b.version).replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  if (version.length > 64) return { ok: false, error: "Version is at most 64 characters." };
  const sha = typeof b.sha256 === "string" ? b.sha256.toLowerCase() : "";
  if (sha && !SHA.test(sha)) return { ok: false, error: "sha256 is 64 hex digits." };
  return { ok: true, report: { reason: b.reason, text: b.reason === "other" ? text : "", version, sha256: sha } };
}

export async function reports(req, env = {}, { now = Date.now() } = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const m = PATH.exec(u.pathname);
  let pkg = "";
  try { pkg = m ? decodeURIComponent(m[1]) : ""; } catch { /* bad escape */ }
  if (!m || !PKG.test(pkg)) return fail("bad_request", "Send /reports/<bundle id>.", 404);
  const db = env.REVIEWS;
  if (!db?.prepare) {
    if (req.method === "GET") return json({ enabled: false, count: 0, reasons: {}, mine: false });
    return fail("unavailable", "This server keeps no reports.", 503);
  }
  await schema(db);
  const salt = env.REVIEWS_SALT ?? "";
  const rawToken = req.headers.get("X-Review-Token");
  if (rawToken !== null && !TOKEN.test(rawToken)) return fail("bad_token", "X-Review-Token is 32 to 128 letters, digits, - or _.");
  const device = rawToken ? await hashOf("device", rawToken, salt) : null;

  if (req.method === "GET") {
    const version = (u.searchParams.get("version") ?? "").slice(0, 64);
    const [stats, mine] = await db.batch([
      db.prepare("SELECT reason, COUNT(*) AS n FROM malicious_reports WHERE pkg = ? AND version = ? GROUP BY reason").bind(pkg, version),
      db.prepare("SELECT 1 AS x FROM malicious_reports WHERE pkg = ? AND version = ? AND device = ?").bind(pkg, version, device ?? ""),
    ]);
    const reasons = {};
    let count = 0;
    for (const r of stats.results ?? []) { reasons[r.reason] = Number(r.n); count += Number(r.n); }
    return json({ enabled: true, count, reasons, mine: Boolean(device && mine.results?.length) });
  }

  if (req.method !== "POST") return fail("bad_request", "Not a reports route.", 405);
  if (!device) return fail("bad_token", "Send this device's X-Review-Token.");
  const ip = await hashOf("ip", req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "unknown", salt);
  const allowed = await allowReviewWrite(env, db, ip, device, now);
  if (allowed !== true) return fail("rate_limited", allowed, 429);
  let body;
  try {
    const text = await req.text();
    if (text.length > 4096) return fail("too_large", "A report is at most 200 characters.", 413);
    body = JSON.parse(text);
  } catch { return fail("bad_request", "Send JSON: {reason, text, version, sha256}."); }
  const p = parseReport(body);
  if (!p.ok) return fail("bad_request", p.error);
  const r = p.report;
  await db.prepare(`INSERT INTO malicious_reports (pkg, version, device, reason, body, sha256, at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (pkg, version, device) DO UPDATE SET reason = excluded.reason, body = excluded.body, sha256 = excluded.sha256, at = excluded.at`)
    .bind(pkg, r.version, device, r.reason, r.text, r.sha256, now).run();
  const n = await db.prepare("SELECT COUNT(*) AS n FROM malicious_reports WHERE pkg = ? AND version = ?").bind(pkg, r.version).first();
  return json({ ok: true, count: Number(n?.n) || 0 });
}
