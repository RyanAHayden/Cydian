// F235: the IPA queue's run page (screens/apprun.js) over fake phone lanes: a queue of 3 apps with one stopped installs
// the other two and clears them from the queue; Cancel abandons the rest and reopens Confirm with what finished
// cleared; Retry All after a failure; and the phone lanes (signing-client.js) against a fake bridge: per-app tags,
// signing.cancel {tag} on a stop, the record-based Re-sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, phoneLanes } from "./apprun.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { prepareParams, prepareOnDevice, openPrepared } from "../signing-client.js";

function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, dataset: {}, parentNode: null,
      textContent: "", hidden: false, disabled: false, type: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      append(...c) { for (const x of c) { if (typeof x !== "object") continue; x.parentNode = e; e.children.push(x); } },
      get firstChild() { return e.children[0] ?? null; },
      remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      click() { for (const f of e.listeners.click ?? []) f({}); },
    };
    return e;
  };
  return { body: make("body"), createElement: make };
}

function fakePage() {
  const p = {
    lines: [], statuses: [], finished: null, bars: [], closers: [], closed: false, panes: [], views: [], filtered: null,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status(t) { p.statuses.push(t); }, progress() {},
    pane(n) { p.panes.push(n); return n; }, view(v) { p.views.push(v); },
    segmented(labels, onPick) { p.seg = { labels, onPick }; return { select: (i) => { p.selected = i; } }; },
    filter(id) { p.filtered = id; },
    bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

async function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try { await fn(); } finally { globalThis.document = saved; }
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Lanes the test drives: sign answers at once (or fails for `bad`); install waits until released.
function lanes({ bad = [] } = {}) {
  const calls = { sign: [], install: [], discard: [], aborted: [] };
  const waits = new Map();
  return {
    calls, waits,
    sign: async (r, { signal, progress }) => {
      calls.sign.push(r.id);
      progress("downloading", 0.5);
      progress("signing", 0.5);
      if (bad.includes(r.id)) throw new Error(`${r.name} couldn't be downloaded`);
      return { token: `t-${r.id}`, bundleId: r.id, expires: "2026-12-03T12:00:00Z" };
    },
    install: (r, { signal, progress }) => new Promise((resolve, reject) => {
      calls.install.push(r.id);
      progress("asking", 0);
      signal.addEventListener("abort", () => { calls.aborted.push(r.id); reject(new Error("cancelled")); });
      waits.set(r.id, () => resolve({ installed: true, expires: "2026-12-03T12:00:00Z" }));
    }),
    discard: (r) => calls.discard.push(r.id),
    release: async (id) => { for (let i = 0; i < 30 && !waits.has(id); i++) await settle(1); waits.get(id)(); await settle(); },
  };
}

const app = (id, name, mode = "install") => ({ id, name, mode, url: mode === "resign" ? null : `https://x/${id}.ipa`, version: "1.0" });

function setup(jobs, opts) {
  const queue = createAppQueue();
  for (const j of jobs) queue.add(j);
  return { queue, page: fakePage(), l: lanes(opts), recorded: [], reopened: [] };
}

const rowsOf = (page) => page.panes[0].children[0].children.filter((li) => li.className === "qr-row");
const statusOf = (li) => li.children[0].children[1].textContent;

test("a queue of 3 with one stopped at iOS's prompt installs the other two, in order, and clears them", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta"), app("c", "Gamma")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    reopenConfirm: (f) => s.reopened.push(f) });
  await settle();
  // all three are signed ahead; only Alpha is with iOS
  assert.deepEqual(s.l.calls.sign, ["a", "b", "c"]);
  assert.deepEqual(s.l.calls.install, ["a"]);
  const rows = rowsOf(s.page);
  assert.equal(statusOf(rows[0]), "Tap Install on the iOS prompt");
  assert.equal(statusOf(rows[1]), "Signed");
  await s.l.release("a");
  assert.deepEqual(s.l.calls.install, ["a", "b"]);
  // Beta's round stop button: only Beta is cancelled, Gamma goes to iOS
  const stop = rows[1].children[1];
  assert.equal(stop.hidden, false);
  stop.click();
  await settle();
  assert.deepEqual(s.l.calls.aborted, ["b"]);
  assert.deepEqual(s.l.calls.install, ["a", "b", "c"]);
  await s.l.release("c");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => [x.id, x.state]), [["a", "installed"], ["b", "cancelled"], ["c", "installed"]]);
  assert.deepEqual(s.queue.list().map((j) => j.id), ["b"]);
  assert.deepEqual(s.recorded.sort(), ["a", "c"]);
  assert.equal(s.page.bars.at(-1).left.textContent, "Close");
  assert.equal(s.page.bars.at(-1).right.textContent, "Retry All");
  assert.match(s.page.finished.label, /^Return to /);
  assert.equal(s.page.lines.at(-1).text, "2 installed, 1 cancelled");
  // one line per phase per app, never a percent
  assert.ok(!s.page.lines.some((l) => /\d+%/.test(l.text)));
  assert.deepEqual(s.page.lines.filter((l) => l.id === "a").map((l) => l.text),
    ["Downloading Alpha", "Signing Alpha", "Signed Alpha", "Asked iOS to install Alpha", "Installed Alpha"]);
  assert.deepEqual(s.page.seg.labels, ["Apps", "Log"]);
}));

test("Cancel abandons the rest and reopens Confirm with what finished cleared", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta"), app("c", "Gamma")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page, reopenConfirm: (f) => s.reopened.push(f) });
  await settle();
  await s.l.release("a");
  const cancel = s.page.bars.at(-1).right;
  assert.equal(cancel.textContent, "Cancel");
  assert.ok(cancel.className.includes("red"));
  cancel.click();
  const r = await done;
  assert.equal(r.stopped, true);
  assert.deepEqual(r.rows.map((x) => x.state), ["installed", "cancelled", "cancelled"]);
  assert.deepEqual(s.l.calls.aborted, ["b"]);
  assert.deepEqual(s.l.calls.discard, ["c"]); // Gamma's signed copy goes
  assert.equal(s.page.closed, true);
  assert.deepEqual(s.queue.list().map((j) => j.id), ["b", "c"]);
  assert.deepEqual(s.reopened, ["Stopped. 1 installed and cleared from the queue."]);
}));

test("a failed app ends its row only; Retry All signs it again; a clean run ends on Done; re-sign rows show the expiry", () => withDom(async () => {
  const s = setup([app("a", "Alpha", "resign"), app("b", "Beta")], { bad: ["b"] });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page });
  await settle();
  await s.l.release("a");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => x.state), ["installed", "failed"]);
  const rows = rowsOf(s.page);
  assert.match(statusOf(rows[0]), /^Re-signed, expires Dec [23], 2026$/);
  assert.equal(statusOf(rows[1]), "Failed: Beta couldn't be downloaded");
  s.l.calls.sign.length = 0;
  s.l.sign = async (row) => { s.l.calls.sign.push(row.id); return { token: "t2", bundleId: row.id }; };
  s.page.bars.at(-1).right.click(); // Retry All
  await settle();
  await s.l.release("b");
  await settle();
  assert.deepEqual(s.l.calls.sign, ["b"]);
  assert.equal(s.page.bars.at(-1).right.textContent, "Done");
  assert.equal(s.queue.size, 0);
}));

test("iFizBox's own IPA goes last and ends the page locked on Closing", () => withDom(async () => {
  const s = setup([app(SELF_ID, "iFizBox"), app("a", "Alpha")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page });
  await settle();
  assert.deepEqual(s.l.calls.install, ["a"]);
  await s.l.release("a");
  assert.deepEqual(s.l.calls.install, ["a", SELF_ID]);
  await s.l.release(SELF_ID);
  await done;
  assert.equal(s.page.finished.locked, true);
}));

// ---- the phone lanes against a fake bridge ----

function fakeNative(script = {}) {
  const calls = [];
  return {
    calls,
    call(method, params, onEvent) {
      calls.push([method, params]);
      const f = script[method];
      return f ? f(params, onEvent) : Promise.resolve({});
    },
  };
}

test("prepareParams: url with edits, a record for a plain re-sign, a My IPAs file", () => {
  assert.deepEqual(prepareParams({ id: "a", mode: "install", url: "u" }), { url: "u" });
  assert.deepEqual(prepareParams({ id: "a", mode: "resign", url: null }), { record: "a" });
  assert.deepEqual(prepareParams({ id: "a", mode: "resign", url: "v" }), { url: "v" });
  assert.deepEqual(prepareParams({ id: "a", mode: "install", url: "u", options: { token: "t", edits: { name: "N", token: "x" } } }), { url: "u", name: "N" });
  assert.deepEqual(prepareParams({ id: "a", mode: "install", library: "f.ipa" }), { library: "f.ipa" });
});

test("a stop sends signing.cancel with that app's tag and nothing else", async () => {
  let release;
  const native = fakeNative({
    "signing.prepare": (p, on) => { on({ phase: "downloading", progress: 0.3 }); on({ log: "Downloading u" }); return new Promise((r) => { release = r; }); },
  });
  const ctl = new AbortController();
  const seen = [];
  const logs = [];
  const p = prepareOnDevice({ id: "a", name: "Alpha", mode: "install", url: "u" }, { tag: "a#1", signal: ctl.signal, native,
    progress: (ph, f) => seen.push([ph, f]), log: (t) => logs.push(t) });
  ctl.abort();
  await assert.rejects(p, (e) => e.code === "cancelled");
  assert.deepEqual(native.calls, [["signing.prepare", { url: "u", tag: "a#1" }], ["signing.cancel", { tag: "a#1" }]]);
  assert.deepEqual(seen, [["downloading", 0.3]]);
  assert.deepEqual(logs, ["Downloading u"]);
  release({});
});

test("openPrepared opens the kept copy, then waits for iOS's install under the same tag", async () => {
  const native = fakeNative({
    "signing.open": () => Promise.resolve({ bundleId: "com.a", expires: "2026-12-03T00:00:00Z" }),
    "signing.progress": (p, on) => { on({ phase: "installing", progress: 0.5 }); return Promise.resolve({ installed: true }); },
  });
  const seen = [];
  const r = await openPrepared({ id: "a", name: "Alpha", token: "t1" }, { tag: "a#2", native, progress: (ph, f) => seen.push([ph, f]) });
  assert.deepEqual(r, { installed: true, expires: "2026-12-03T00:00:00Z" });
  assert.equal(native.calls[0][0], "signing.open");
  assert.equal(native.calls[0][1].token, "t1");
  assert.equal(native.calls[0][1].tag, "a#2");
  assert.deepEqual(native.calls[1], ["signing.progress", { bundleId: "com.a", wait: 600, tag: "a#2" }]);
  assert.deepEqual(seen, [["asking", 0], ["installing", 0.5]]);
});

test("phoneLanes: each try gets its own tag; iFizBox's own is hosted and not watched", async () => {
  const sc = { prepareOnDevice: async (job, o) => o.tag, openPrepared: async (row, o) => [o.tag, o.host], discardPrepared: () => {} };
  const l = phoneLanes(sc);
  const row = { id: "a", job: {} };
  assert.equal(await l.sign(row, {}), "a#1");
  assert.equal(await l.sign(row, {}), "a#2");
  assert.deepEqual(await l.install({ id: SELF_ID }, {}), [`${SELF_ID}#3`, true]);
});

test("runAppQueueRun: the Signing walkthrough first; then the queued jobs to the run, one run at a time", async () => {
  const { runAppQueueRun, appQueueRunning } = await import("./queue.js");
  const q = createAppQueue();
  q.add(app("a", "Alpha"));
  q.add(app("b", "Beta"));
  assert.equal(await runAppQueueRun(q.list(), { queue: q, ready: async () => false, lanes: {}, run: async () => assert.fail("ran") }), null);
  assert.equal(appQueueRunning(), false);
  let deps = null;
  const jobs = q.list();
  q.clear("b"); // cleared before Confirm's run starts
  const r = await runAppQueueRun(jobs, { queue: q, ready: async () => true, lanes: { x: 1 },
    run: async (js, d) => { deps = d; return { ok: true, ids: js.map((j) => j.id) }; } });
  assert.deepEqual(r.ids, ["a"]);
  assert.equal(appQueueRunning(), true); // until the page closes
  assert.equal(await runAppQueueRun(jobs, { queue: q, ready: async () => true, lanes: {}, run: async () => assert.fail("twice") }), null);
  deps.onClose();
  assert.equal(appQueueRunning(), false);
});
