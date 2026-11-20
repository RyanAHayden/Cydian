// B153: a new pass of the IPA queue's run never shows the last one's lines. A one-app run that ended
// "X: Cancelled / 1 failed" and goes again (Retry All, the row's tap) starts with an empty Log and its row back at the
// start; a second run (a new page) starts empty too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, clearLog } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";

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
      remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      click() { for (const f of e.listeners.click ?? []) f({}); },
    };
    return e;
  };
  return { body: make("body"), createElement: make };
}

// The progress page as the run sees it: lines wait in a buffer until a flush (one paint a frame) puts them in `out`.
function fakePage() {
  const p = {
    pending: [], shown: [], bars: [], closers: [], panes: [], finished: null, closed: false,
    get lines() { return [...p.shown, ...p.pending]; },
    line(kind, text, id) { if (!p.closed) p.pending.push({ kind, text, id }); },
    flush() { p.shown.push(...p.pending.splice(0)); },
    out: { replaceChildren() { p.shown.length = 0; } },
    status() {}, progress() {},
    pane(n) { p.panes.push(n); return n; }, view() {},
    segmented() { return { select() {} }; },
    filter() {}, bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.flush(); p.finished = f; },
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

// X downloads, then its install fails the way the user's did ("Cancelled."); `ok` turns the next try into an install.
function lanes() {
  const l = {
    ok: false,
    sign: async (r, { progress }) => { progress("downloading", 0.5); return { token: `t-${r.id}`, bundleId: r.id }; },
    install: async (r, { progress }) => {
      progress("asking", 0);
      if (!l.ok) throw new Error("Cancelled.");
      return { installed: true };
    },
    discard() {},
  };
  return l;
}

const X = { id: "com.example.x", name: "X", mode: "install", url: "https://x/x.ipa", version: "1.0" };
const rowOf = (page) => page.panes[0].children[0].children.find((li) => li.className === "qr-row");
const statusOf = (li) => li.children[0].children[1].textContent;

test("B153: Retry All after 'X: Cancelled / 1 failed' starts with an empty Log; the row and lines are the new pass's", () => withDom(async () => {
  const queue = createAppQueue();
  queue.add(X);
  const page = fakePage();
  const l = lanes();
  const r = await runAppRun(queue.list(), { queue, lanes: l, open: () => page });
  assert.equal(r.ok, false);
  const before = page.lines.map((x) => x.text);
  assert.ok(before.includes("Downloading X"));
  assert.ok(before.includes("X: Cancelled."));
  assert.equal(before.at(-1), "1 failed");
  assert.equal(statusOf(rowOf(page)), "Failed: Cancelled.");

  l.ok = true;
  page.bars.at(-1).right.click(); // Retry All
  await settle();
  const after = page.lines.map((x) => x.text);
  assert.equal(after[0], "Downloading X", "the new pass's first line opens the log");
  for (const old of ["X: Cancelled.", "1 failed"]) assert.ok(!after.includes(old), `"${old}" is the last pass's`);
  assert.equal(after.filter((t) => t === "Downloading X").length, 1);
  assert.equal(after.at(-1), "1 installed");
  assert.equal(statusOf(rowOf(page)), "Installed");
}));

test("B153: the failed row's tap after the run ended also starts a clean Log", () => withDom(async () => {
  const queue = createAppQueue();
  queue.add(X);
  const page = fakePage();
  const l = lanes();
  await runAppRun(queue.list(), { queue, lanes: l, open: () => page });
  l.ok = true;
  rowOf(page).children[0].click(); // the row: retry
  await settle();
  const texts = page.lines.map((x) => x.text);
  assert.ok(!texts.includes("X: Cancelled.") && !texts.includes("1 failed"));
  assert.deepEqual(texts.slice(0, 1), ["Downloading X"]);
}));

test("B153: a second run on a new page starts empty, with the app Waiting", () => withDom(async () => {
  const queue = createAppQueue();
  queue.add(X);
  const first = fakePage();
  await runAppRun(queue.list(), { queue, lanes: lanes(), open: () => first });
  await first.close();
  const second = fakePage();
  let seen = null;
  const done = runAppRun(queue.list(), { queue, lanes: lanes(), open: () => second });
  seen = { lines: second.lines.length, status: statusOf(rowOf(second)) };
  await done;
  assert.deepEqual(seen, { lines: 0, status: "Waiting" });
  assert.equal(second.lines.filter((x) => x.text === "X: Cancelled.").length, 1);
}));

test("B153: clearLog flushes the waiting lines first, then empties the page; a page's own clear() wins", () => {
  const page = fakePage();
  page.line("step", "old");
  page.flush();
  page.line("step", "waiting");
  clearLog(page);
  assert.deepEqual(page.lines, []);
  let cleared = 0;
  clearLog({ clear: () => { cleared++; } });
  assert.equal(cleared, 1);
  clearLog(null);
});
