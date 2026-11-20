// F291: Report as Malicious (src/reports.js) against Node's SQLite with D1's API (src/d1-sqlite.js). Run by
// test_reports.py (the gate runs every test_*.py).
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { reports, parseReport, isReportsPath, REASONS } from "./src/reports.js";
import { d1 } from "./src/d1-sqlite.js";
import w from "./src/index.js";

const db = d1();
const env = { REVIEWS: db };
const tok = (c) => c.repeat(40);
let ipN = 0;
const call = (path, { method = "GET", body, token, ip = `198.51.100.${++ipN % 250}`, e = env } = {}) => {
  const headers = { "CF-Connecting-IP": ip };
  if (token) headers["X-Review-Token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return reports(new Request("https://ifizbox.example" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), e);
};

assert.ok(isReportsPath("/reports/com.x"));
assert.ok(!isReportsPath("/reviews/com.x"));
assert.deepEqual(REASONS, ["logins", "data", "profile", "takeover", "money", "fake", "other"]);
assert.equal(parseReport({ reason: "ads" }).ok, false, "no ads/pop-ups reason: that's a review");
assert.equal(parseReport({ reason: "other" }).ok, false, "Something Else needs text");
assert.equal(parseReport({ reason: "other", text: "x".repeat(201) }).ok, false);
assert.equal(parseReport({ reason: "logins", sha256: "nothex" }).ok, false);
assert.deepEqual(parseReport({ reason: "logins", text: "ignored", version: "1.2", sha256: "A".repeat(64) }).report,
  { reason: "logins", text: "", version: "1.2", sha256: "a".repeat(64) });

// nothing yet
let r = await call("/reports/com.example.bad?version=3.0");
let j = await r.json();
assert.deepEqual(j, { enabled: true, count: 0, reasons: {}, mine: false });
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
assert.equal((await call("/reports/..%2Fetc")).status, 404);

// a report needs a token
assert.equal((await call("/reports/com.example.bad", { method: "POST", body: { reason: "logins", version: "3.0" } })).status, 400);

// one per device per version: a second replaces the first
r = await call("/reports/com.example.bad", { method: "POST", token: tok("a"), body: { reason: "logins", version: "3.0" } });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true, count: 1 });
r = await call("/reports/com.example.bad", { method: "POST", token: tok("a"), body: { reason: "data", version: "3.0" } });
assert.deepEqual(await r.json(), { ok: true, count: 1 });
await call("/reports/com.example.bad", { method: "POST", token: tok("b"), body: { reason: "data", version: "3.0", sha256: "b".repeat(64) } });
await call("/reports/com.example.bad", { method: "POST", token: tok("c"), body: { reason: "other", text: "asked for my password", version: "3.0" } });
await call("/reports/com.example.bad", { method: "POST", token: tok("c"), body: { reason: "logins", version: "2.9" } });
j = await (await call("/reports/com.example.bad?version=3.0", { token: tok("b") })).json();
assert.deepEqual(j, { enabled: true, count: 3, reasons: { data: 2, other: 1 }, mine: true });
j = await (await call("/reports/com.example.bad?version=3.0", { token: tok("d") })).json();
assert.equal(j.mine, false);
const kept = await db.prepare("SELECT body, sha256 FROM malicious_reports WHERE device <> '' ORDER BY body DESC").all();
assert.ok(kept.results.some((x) => x.body === "asked for my password"));
assert.ok(kept.results.some((x) => x.sha256 === "b".repeat(64)));

// the review limits: one address gets a handful a minute
let limited = false;
for (let i = 0; i < 12 && !limited; i++) {
  const t = tok(String.fromCharCode(101 + i));
  limited = (await call("/reports/com.example.flood", { method: "POST", token: t, ip: "192.0.2.9", body: { reason: "money", version: "1" } })).status === 429;
}
assert.ok(limited, "rate limited like reviews");

// without D1: quiet GET, 503 on POST
assert.deepEqual(await (await call("/reports/com.x?version=1", { e: {} })).json(), { enabled: false, count: 0, reasons: {}, mine: false });
assert.equal((await call("/reports/com.x", { method: "POST", token: tok("z"), body: { reason: "money" }, e: {} })).status, 503);

// routed by the Worker
r = await w.fetch(new Request("https://ifizbox.example/reports/com.example.bad?version=3.0"), env, {});
assert.equal((await r.json()).count, 3);
console.log("worker reports: ok");
