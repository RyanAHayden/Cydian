// B236: iOS 27 never answers apps.isInstalled (null for every app, B229). An install whose IPA iOS fetched in full
// (handedOff: the shell's served word) is recorded on that no-answer, with the version installed; one iOS never fetched
// (B170: the user's Cancel on iOS's prompt) still is not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryAppStore, recordInstall } from "../core/installed.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

function fakePage() {
  const p = {
    lines: [], bars: [], closers: [], closed: false, panes: [], finished: null,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status() {}, progress() {},
    pane(n) { p.panes.push(n); return n; }, view() {},
    segmented() { return { select() {} }; },
    filter() {}, bar(b) { p.bars.push(b); }, reopen() {}, finish(f) { p.finished = f; },
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

// Lanes: sign answers at once; install waits until released with the answer `answers[id]` (default installed: true).
// `deaf`: install ignores the abort (the shell answers anyway after a stop or Cancel).
function lanes({ answers = {}, deaf = false } = {}) {
  const calls = { install: [], aborted: [] };
  const waits = new Map();
  return {
    calls, waits,
    sign: async (r, { progress }) => { progress("signing", 0.5); return { token: `t-${r.id}`, bundleId: r.id }; },
    install: (r, { signal, progress }) => new Promise((resolve, reject) => {
      calls.install.push(r.id);
      progress("asking", 0);
      signal.addEventListener("abort", () => { calls.aborted.push(r.id); if (!deaf) reject(new Error("cancelled")); });
      waits.set(r.id, () => resolve(answers[r.id] ?? { installed: true }));
    }),
    discard: () => {},
    release: async (id) => { for (let i = 0; i < 30 && !waits.has(id); i++) await settle(1); waits.get(id)(); await settle(); },
  };
}

const app = (id, name) => ({ id, name, mode: "install", url: `https://x/${id}.ipa`, version: "1.0" });
function setup(jobs, opts) {
  const queue = createAppQueue();
  for (const j of jobs) queue.add(j);
  return { queue, page: fakePage(), l: lanes(opts), recorded: [] };
}
const rowsOf = (page) => page.panes[0].children[0].children.filter((li) => li.className === "qr-row");
const statusOf = (li) => li.children[0].children[1].textContent;
const flip = async (doc) => { doc.set("hidden"); doc.set("visible"); await settle(); };

test("B236: iOS fetched the whole IPA and apps.isInstalled can't answer: the new version is recorded", () => withDom(async () => {
  const mem = memoryAppStore();
  await recordInstall(mem, { id: "a", name: "Alpha", version: "1.8.4" }, 1000);
  const s = setup([{ ...app("a", "Alpha"), version: "1.8.3" }, app("b", "Beta")],
    { answers: { a: { installed: null, handedOff: true }, b: { installed: null } } });
  const doc = fakeDoc();
  const record = (j) => recordInstall(mem, { id: j.id, name: j.name, version: j.version });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record, open: () => s.page, doc,
    isInstalled: async () => ({ a: null, b: null }), store: async () => mem });
  await settle();
  await s.l.release("a");
  await s.l.release("b");
  await done;
  await settle();
  const ver = async () => Object.fromEntries((await mem.all()).map((x) => [x.id, x.version]));
  assert.deepEqual(await ver(), { a: "1.8.3" }, "Alpha's downgrade is recorded; Beta, never fetched, is not");
  await flip(doc);
  assert.deepEqual(await ver(), { a: "1.8.3" }, "asking again changes nothing");
  assert.equal(statusOf(rowsOf(s.page)[1]), "Sent to iOS");
  s.page.close();
}));

test("B236: a fetched install iOS says it doesn't have (false) waits, as before", () => withDom(async () => {
  const s = setup([app("a", "Alpha")], { answers: { a: { installed: null, handedOff: true } } });
  const doc = fakeDoc();
  let has = { a: false };
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    doc, isInstalled: async () => has, store: async () => memoryAppStore() });
  await settle();
  await s.l.release("a");
  await done;
  await settle();
  assert.deepEqual(s.recorded, []);
  has = { a: true };
  await flip(doc);
  assert.deepEqual(s.recorded, ["a"]);
  s.page.close();
}));
