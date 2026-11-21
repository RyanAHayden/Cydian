// B278: a run in the background on the This iPhone route ends each app confirmed (installd's answer), so its record is
// written at once, but that write can fail while iOS suspends the page (IndexedDB aborted mid-write). The app stayed at
// its old version in Installed and Changes kept its upgrade; nothing asked for its record again. A failed record is
// now written again, a few times apart and on each return to the front.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, RECORD_TRIES } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryAppStore, recordInstall } from "../core/installed.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

function fakePage() {
  const p = {
    lines: [], closers: [], closed: false, panes: [], finished: null,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status() {}, progress() {},
    pane(n) { p.panes.push(n); return n; }, view() {},
    segmented() { return { select() {} }; },
    filter() {}, bar() {}, reopen() {}, finish(f) { p.finished = f; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

function fakeDoc() {
  const d = { visibilityState: "visible", listeners: [],
    addEventListener(t, f) { if (t === "visibilitychange") d.listeners.push(f); },
    removeEventListener(t, f) { d.listeners = d.listeners.filter((x) => x !== f); },
    set(state) { d.visibilityState = state; for (const f of [...d.listeners]) f(); } };
  return d;
}

async function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try { await fn(); } finally { globalThis.document = saved; }
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// This iPhone lanes: sign at once, install answers installed: true (installd has it) when released.
function lanes() {
  const waits = new Map();
  return {
    sign: async (r) => ({ token: `t-${r.id}`, bundleId: r.id }),
    install: (r, { progress }) => new Promise((resolve) => { progress("copying", 0); waits.set(r.id, () => resolve({ installed: true })); }),
    discard: () => {},
    release: async (id) => { for (let i = 0; i < 30 && !waits.has(id); i++) await settle(1); waits.get(id)(); await settle(); },
  };
}

const app = (id, name, version) => ({ id, name, mode: "install", url: `https://x/${id}.ipa`, version, installed: "1.0" });

// later() that keeps the timers for the test to fire
function timers() {
  const t = { list: [], later: (f) => { t.list.push(f); return t.list.length; }, clear: () => {},
    fire: async () => { const fs = t.list.splice(0); for (const f of fs) f(); await settle(); } };
  return t;
}

async function setup({ fails }) {
  const mem = memoryAppStore();
  await recordInstall(mem, { id: "a", name: "Alpha", version: "1.0" }, 1000);
  await recordInstall(mem, { id: "b", name: "Beta", version: "1.0" }, 1000);
  const queue = createAppQueue();
  queue.add(app("a", "Alpha", "2.0"));
  queue.add(app("b", "Beta", "2.0"));
  const page = fakePage();
  const l = lanes();
  const doc = fakeDoc();
  const t = timers();
  const tries = { a: 0, b: 0 };
  const ends = [];
  const record = async (j) => {
    tries[j.id]++;
    if (fails(j.id, tries[j.id])) throw new Error("transaction aborted");
    await recordInstall(mem, { id: j.id, name: j.name, version: j.version });
  };
  const done = runAppRun(queue.list(), { queue, lanes: l, record, open: () => page, doc, later: t.later, clear: t.clear,
    isInstalled: async () => ({}), store: async () => mem, onAppEnd: (r, p) => ends.push([r.id, p]) });
  const version = async (id) => (await mem.all()).find((x) => x.id === id)?.version;
  return { mem, page, l, doc, t, tries, ends, done, version };
}

test("B278: a record that failed in the background is written again; the other app's is untouched", () => withDom(async () => {
  const s = await setup({ fails: (id, n) => id === "a" && n === 1 });
  s.doc.set("hidden");
  await s.l.release("a");
  await s.l.release("b");
  await s.done;
  assert.equal(await s.version("b"), "2.0");
  assert.equal(await s.version("a"), "1.0", "Alpha's first write failed");
  assert.ok(s.page.lines.some((x) => x.kind === "raw" && x.id === "a" && /Couldn't record Alpha as installed/.test(x.text)));
  const before = s.ends.length;
  await s.t.fire(); // the retry
  assert.equal(s.tries.a, 2);
  assert.equal(await s.version("a"), "2.0", "Alpha recorded on the retry");
  assert.ok(s.ends.length > before && s.ends.at(-1)[0] === "a", "the badge counts again once it is written");
  assert.equal(s.doc.listeners.filter((f) => f.name === "onFront").length, 0, "nothing left to retry");
}));

test("B278: retries run out while hidden; the return to the front writes it", () => withDom(async () => {
  let open = false;
  const s = await setup({ fails: (id) => id === "a" && !open });
  s.doc.set("hidden");
  await s.l.release("a");
  await s.l.release("b");
  await s.done;
  for (let i = 0; i < RECORD_TRIES + 2; i++) await s.t.fire();
  assert.equal(s.tries.a, RECORD_TRIES + 1, "the first write and RECORD_TRIES retries, then it stops");
  assert.equal(s.t.list.length, 0);
  assert.equal(await s.version("a"), "1.0");
  open = true;
  s.doc.set("visible");
  await settle();
  assert.equal(await s.version("a"), "2.0", "written on the return to the front");
}));

test("B278: a record that never fails is written once, with no retry", () => withDom(async () => {
  const s = await setup({ fails: () => false });
  await s.l.release("a");
  await s.l.release("b");
  await s.done;
  await s.t.fire(); // only the run's own (spent) stall timers
  assert.deepEqual(s.tries, { a: 1, b: 1 });
  assert.equal(await s.version("a"), "2.0");
}));
