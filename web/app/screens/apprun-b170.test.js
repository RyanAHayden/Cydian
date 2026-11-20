// B170: apps whose install was cancelled still got marked Installed. Installed's record follows a run's row only when
// the user didn't cancel it and iOS confirmed it: the round stop and the red Cancel never record (even when the shell
// answers installed afterwards), a row iOS gave no answer for (the user's Cancel on iOS's own prompt) or one handed off
// while iFizBox was away is recorded only once apps.isInstalled says true, and a record iOS later reports missing is
// undone (the record it replaced comes back).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, followHandoff } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryAppStore, recordInstall } from "../core/installed.js";

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

test("B170: a row's stop at iOS's prompt is never recorded, even when the shell answers installed and iOS has it", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta")], { deaf: true });
  const doc = fakeDoc();
  const isInstalled = async () => ({ a: true, b: true });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    doc, isInstalled, store: async () => memoryAppStore() });
  await settle();
  rowsOf(s.page)[0].children[1].click(); // Alpha's round stop while iOS's prompt is up
  await settle();
  await s.l.release("a"); // the shell answers installed after all
  await s.l.release("b");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => [x.id, x.state]), [["a", "cancelled"], ["b", "installed"]]);
  await flip(doc);
  assert.deepEqual(s.recorded, ["b"]);
  s.page.close();
}));

test("B170: the red Cancel records nothing it cancelled", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta")], { deaf: true });
  const doc = fakeDoc();
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    doc, isInstalled: async () => ({ a: true, b: true }), reopenConfirm: () => {}, store: async () => memoryAppStore() });
  await settle();
  s.page.bars.at(-1).right.click(); // Cancel while Alpha is with iOS
  const r = await done;
  assert.deepEqual(r.rows.map((x) => x.state), ["cancelled", "cancelled"]);
  await s.l.release("a");
  await settle();
  assert.deepEqual(s.recorded, []);
}));

test("B170: iOS's own prompt cancelled (no answer from iOS): Sent to iOS, not recorded until apps.isInstalled says true", () => withDom(async () => {
  const s = setup([app("a", "Alpha")], { answers: { a: { installed: null } } });
  const doc = fakeDoc();
  let has = {}; // apps.isInstalled with no answer for it
  const asked = [];
  const isInstalled = async (ids) => { asked.push(ids); return has; };
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    doc, isInstalled, store: async () => memoryAppStore() });
  await settle();
  await s.l.release("a");
  await done;
  await settle();
  assert.equal(statusOf(rowsOf(s.page)[0]), "Sent to iOS");
  assert.ok(asked.length >= 1, "iOS was asked once the row ended");
  assert.deepEqual(s.recorded, []);
  has = { a: null }; // iOS can't say
  await flip(doc);
  assert.deepEqual(s.recorded, []);
  has = { a: false };
  await flip(doc);
  assert.deepEqual(s.recorded, []);
  has = { a: true };
  await flip(doc);
  assert.equal(statusOf(rowsOf(s.page)[0]), "Installed");
  assert.deepEqual(s.recorded, ["a"]);
  s.page.close();
}));

test("B170: an app handed to iOS while iFizBox was away (.away()) is recorded only once iOS has it", () => withDom(async () => {
  const s = setup([app("a", "Alpha")], { answers: { a: { installed: false } } });
  const doc = fakeDoc();
  let has = { a: null };
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    doc, isInstalled: async () => has, store: async () => memoryAppStore() });
  await settle();
  doc.set("hidden"); // the user left iFizBox mid-install
  await s.l.release("a");
  await done;
  assert.equal(statusOf(rowsOf(s.page)[0]), "Sent to iOS");
  doc.set("visible");
  await settle();
  assert.deepEqual(s.recorded, []);
  has = { a: true };
  await flip(doc);
  assert.deepEqual(s.recorded, ["a"]);
  s.page.close();
}));

test("B170: iOS reporting a recorded app missing undoes the record (the one it replaced comes back), then records again", () => withDom(async () => {
  const mem = memoryAppStore();
  await recordInstall(mem, { id: "a", name: "Alpha", version: "0.9" }, 1000);
  const store = async () => mem;
  const s = setup([app("a", "Alpha"), app("b", "Beta")], { answers: { a: { installed: null }, b: { installed: null } } });
  const doc = fakeDoc();
  let has = { a: true, b: true };
  const record = (j) => recordInstall(mem, { id: j.id, name: j.name, version: j.version });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record, open: () => s.page, doc, isInstalled: async () => has, store });
  await settle();
  await s.l.release("a");
  await s.l.release("b");
  await done;
  await settle();
  const ver = async () => Object.fromEntries((await mem.all()).map((x) => [x.id, x.version]));
  assert.deepEqual(await ver(), { a: "1.0", b: "1.0" });
  has = { a: false, b: false }; // gone
  await flip(doc);
  assert.deepEqual(await ver(), { a: "0.9" }, "Alpha's older record is back, Beta's is removed");
  assert.equal(statusOf(rowsOf(s.page)[0]), "Sent to iOS");
  assert.ok(s.page.lines.some((l) => l.id === "a" && l.text === "iOS doesn't have Alpha now"));
  assert.ok(s.page.lines.some((l) => l.id === "b" && l.text === "Beta is no longer recorded as installed"));
  has = { a: true, b: false };
  await flip(doc);
  assert.deepEqual(await ver(), { a: "1.0" });
  assert.equal(statusOf(rowsOf(s.page)[0]), "Installed");
  s.page.close();
}));

test("B170: followHandoff asks again after no answer, never confirms on it, and each return to the front starts over", async () => {
  const doc = fakeDoc();
  const timers = [];
  const rows = [{ id: "a", bundleId: "a", state: "installed", unsure: true, mode: "install" }];
  const confirmed = [];
  const heard = [];
  const run = { confirm: (id) => confirmed.push(id), unconfirm: () => false, away: () => {} };
  const h = followHandoff(run, rows, { isInstalled: async () => ({}), doc, answered: (r, v) => heard.push(v), tries: 1,
    later: (f) => { timers.push(f); return timers.length; }, clear: () => {} });
  await h.check();
  assert.deepEqual(heard, [null]);
  assert.equal(timers.length, 1, "asked again later");
  await timers.shift()();
  assert.equal(timers.length, 0, "tries used up");
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.equal(timers.length, 1, "back in front: the tries start over");
  assert.deepEqual(confirmed, []);
  h.stop();
});
