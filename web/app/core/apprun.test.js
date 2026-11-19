// F235: the IPA queue's run (core/apprun.js): every app signed ahead, handed to iOS one at a time in order (iFizBox
// last), a row's stop cancels only that app, Cancel abandons the rest, a quiet phase times out into that row's failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, summaryLine, runStatus, runPercent, stallText } from "./apprun.js";
import { SELF_ID } from "./appqueue.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

// A controllable phone: each sign / install waits until the test settles it.
function phone() {
  const events = [];
  const pending = { sign: new Map(), install: new Map() };
  const discarded = [];
  const make = (kind) => (row, hooks) => new Promise((resolve, reject) => {
    events.push(`${kind}:${row.id}`);
    hooks.signal.addEventListener("abort", () => { events.push(`abort-${kind}:${row.id}`); reject(new Error("cancelled")); });
    pending[kind].set(row.id, { resolve, reject, hooks });
  });
  return {
    events, pending, discarded,
    sign: make("sign"), install: make("install"),
    discard: (r) => discarded.push(r.id),
    signed(id, extra = {}) { pending.sign.get(id).resolve({ token: `t-${id}`, bundleId: id, ...extra }); },
    installed(id, extra = {}) { pending.install.get(id).resolve({ installed: true, ...extra }); },
  };
}

const jobs = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase(), mode: "install", url: `https://x/${id}.ipa` }));

test("signs ahead (2 at a time), installs one at a time in order, iFizBox last", async () => {
  const ph = phone();
  const rows = appRows(jobs(SELF_ID, "a", "b", "c"));
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", SELF_ID]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "sign:b"]);
  ph.signed("b");
  await flush();
  // b is signed, but a isn't yet: nothing goes to iOS before a; c starts signing in b's place
  assert.deepEqual(ph.events, ["sign:a", "sign:b", "sign:c"]);
  assert.equal(rows[1].state, "signed");
  assert.equal(rowStatus(rows[1]), "Signed");
  ph.signed("a");
  await flush();
  assert.deepEqual(ph.events.slice(3), ["sign:" + SELF_ID, "install:a"]);
  assert.equal(rowStatus(rows[0]), "Tap Install on the iOS prompt");
  ph.signed("c");
  ph.signed(SELF_ID);
  await flush();
  // b waits for a's install, even though everything is signed
  assert.equal(ph.events.filter((e) => e.startsWith("install")).length, 1);
  ph.installed("a");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:b"]);
  ph.installed("b");
  await flush();
  ph.installed("c");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:b", "install:c", `install:${SELF_ID}`]);
  ph.installed(SELF_ID);
  await end;
  assert.equal(run.running, false);
  assert.equal(summaryLine(rows), "4 installed");
});

test("a row's stop cancels only that app, at any phase; the next goes on", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, ahead: 3 });
  const end = run.start();
  await flush();
  // b stopped while it downloads/signs: its job is aborted
  run.stop("b");
  await flush();
  assert.ok(ph.events.includes("abort-sign:b"));
  assert.equal(rows[1].state, "cancelled");
  ph.signed("a");
  ph.signed("c");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a"]);
  // a stopped at iOS's prompt: its install is aborted and c goes to iOS
  run.stop("a");
  await flush();
  assert.ok(ph.events.includes("abort-install:a"));
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:c"]);
  ph.installed("c");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["cancelled", "cancelled", "installed"]);
  assert.equal(summaryLine(rows), "1 installed, 2 cancelled");
});

test("a signed app stopped before its turn frees its signed copy", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  ph.signed("b");
  await flush();
  run.stop("b");
  assert.deepEqual(ph.discarded, ["b"]);
  ph.installed("a");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "cancelled"]);
});

test("Cancel abandons the rest: in-flight jobs aborted, signed copies freed, finished apps stay finished", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c", "d"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  ph.signed("b");
  await flush();
  ph.installed("a");
  await flush();
  // b is with iOS, c and d sign
  assert.equal(run.current.id, "b");
  assert.equal(run.cancel(), true);
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "cancelled", "cancelled", "cancelled"]);
  assert.ok(ph.events.includes("abort-install:b"));
  assert.ok(ph.events.includes("abort-sign:c") && ph.events.includes("abort-sign:d"));
  assert.equal(run.running, false);
});

test("a failure ends its row only; Retry All runs failed and cancelled rows again", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, ahead: 3 });
  const end = run.start();
  await flush();
  ph.pending.sign.get("a").reject(new Error("The IPA couldn't be downloaded"));
  ph.signed("b");
  ph.signed("c");
  await flush();
  ph.pending.install.get("b").resolve({ installed: false });
  await flush();
  ph.installed("c");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "failed", "installed"]);
  assert.equal(rowStatus(rows[0]), "Failed: The IPA couldn't be downloaded");
  assert.equal(rowStatus(rows[1]), "Failed: iOS didn't install it");
  const again = run.retryAll();
  await flush();
  assert.ok(again);
  ph.signed("a");
  ph.signed("b");
  await flush();
  ph.installed("a");
  await flush();
  ph.installed("b");
  await again;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "installed", "installed"]);
});

test("a phase that stops sending progress times out into its row's failure, and the queue moves on", async () => {
  const ph = phone();
  const timers = [];
  const later = (f, ms) => { timers.push({ f, ms, on: true }); return timers.length - 1; };
  const clear = (i) => { if (timers[i]) timers[i].on = false; };
  const rows = appRows([{ id: "p", name: "Partyboard", mode: "resign" }, { id: "q", name: "Q", mode: "install", url: "u" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, later, clear, stallMs: 1000 });
  const end = run.start();
  await flush();
  ph.pending.sign.get("p").hooks.progress("signing", 0.5);
  ph.signed("q");
  await flush();
  // fire the newest live timer (p's, armed by its 50%)
  const live = timers.filter((t) => t.on);
  assert.equal(live.length, 1);
  live[0].on = false;
  live[0].f();
  await flush();
  assert.equal(rows[0].state, "failed");
  assert.equal(rows[0].error, stallText({ phase: "signing", fraction: 0.5 }, 1000));
  assert.match(rows[0].error, /Signing 50%/);
  assert.ok(ph.events.includes("abort-sign:p"));
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:q"]);
  ph.installed("q");
  await end;
});

test("the log: one line per phase per app, never one per percent", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows([{ id: "d", name: "Delta", mode: "install", url: "u", size: 48 * 1024 * 1024 },
    { id: "r", name: "Partyboard", mode: "resign" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  const d = ph.pending.sign.get("d").hooks;
  for (const f of [0.1, 0.2, 0.3]) d.progress("downloading", f);
  assert.equal(rowStatus(rows[0]), "Downloading 14.4 of 48.0 MB");
  for (const f of [0.1, 0.6]) d.progress("signing", f);
  ph.signed("d");
  ph.signed("r", { expires: "2026-12-03T12:00:00Z" });
  await flush();
  const i = ph.pending.install.get("d").hooks;
  i.progress("asking", 0);
  i.progress("installing", 0.3);
  i.progress("installing", 0.7);
  ph.installed("d");
  await flush();
  ph.installed("r");
  await end;
  assert.deepEqual(lines, ["Downloading Delta 48.0 MB", "Signing Delta", "Signed Delta", "Signed Partyboard", "Asked iOS to install Delta",
    "iOS is installing Delta", "Installed Delta", "Re-signed Partyboard, expires Dec 3, 2026"]);
  assert.equal(rowStatus(rows[1], { timeZone: "UTC" }), "Re-signed, expires Dec 3, 2026");
  assert.equal(summaryLine(rows), "1 installed, 1 re-signed");
});

test("status and percent while it runs", () => {
  const rows = appRows(jobs("a", "b"));
  rows[0].state = "asking";
  rows[1].state = "signing";
  rows[1].fraction = 0.5;
  assert.equal(runStatus(rows), "Tap Install for A (1 of 2)");
  assert.equal(runPercent(rows), Math.round(((0.5 + 0.375) / 2) * 100));
  rows[0].state = "installed";
  assert.equal(runStatus(rows), "Signing B (2 of 2)");
});
