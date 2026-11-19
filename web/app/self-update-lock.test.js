// B49: iFizBox's own sideload update, once iOS has the install link, ends its progress page locked: the finish
// button reads "Closing iFizBox" and is disabled, and Close (or Done/Cancel) at the top right is greyed and does
// nothing, until iOS closes the app (user 2026-11-18: a Close tap during 0.9.6 -> 0.9.7 lost the update). A Close
// comes back only after LOCK_LIMIT, so a prompt that never came can't trap the page. Other installs are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openProgress, progressHUD, lockSelfUpdate, CLOSING_LABEL, LOCK_LIMIT } from "./nav/progress.js";
import { installOnDevice } from "./signing-client.js";
import { resignApp } from "./screens/queue.js";
import { NAME, BUNDLE_ID } from "./brand.js";

// ---- a fake DOM, enough for nav/progress.js (as install-cancel.test.js's) ---------------------------------------
function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, parentNode: null,
      textContent: "", hidden: false, disabled: false, type: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      append(...c) {
        for (const x of c) {
          if (x?.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          if (typeof x !== "object") continue;
          x.parentNode = e;
          e.children.push(x);
        }
      },
      remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      get childElementCount() { return e.children.length; },
      get firstElementChild() { return e.children[0] ?? null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      animate: () => ({ finished: Promise.resolve() }),
      click() { if (e.onclick) e.onclick(); for (const f of e.listeners.click ?? []) f({}); },
    };
    return e;
  };
  const body = make("body");
  return { body, createElement: make, createDocumentFragment: () => Object.assign(make("#fragment"), { isFragment: true }) };
}

function withDom(fn) {
  return async () => {
    const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.document = fakeDom();
    globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    try { await fn(globalThis.document); } finally {
      globalThis.document = saved.document;
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
    }
  };
}

const find = (n, cls) => { for (const k of n.children) { if (k._cls.has(cls)) return k; const f = find(k, cls); if (f) return f; } return null; };
const bars = (n, all = []) => { for (const k of n.children) { if (k._cls.has("bar-button")) all.push(k); bars(k, all); } return all; };
const right = (page) => bars(page.sheet)[1];
const finishButton = (page) => find(page.sheet, "progress-finish");
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("the label is Closing <name>; the safety limit is long enough for iOS's prompt", () => {
  assert.equal(CLOSING_LABEL, `Closing ${NAME}`);
  assert.ok(LOCK_LIMIT >= 60_000);
});

test("openProgress: a locked finish greys the button and Close; neither closes the page", withDom(async () => {
  const page = openProgress();
  page.finish({ label: CLOSING_LABEL, status: "Done", locked: true, unlockAfter: 0 });
  const b = finishButton(page);
  assert.equal(b.textContent, CLOSING_LABEL);
  assert.equal(b.hidden, false);
  assert.equal(b.disabled, true);
  assert.ok(b._cls.has("is-locked"));
  b.click();
  assert.equal(right(page).hidden, false);
  assert.equal(right(page).textContent, "Close");
  assert.equal(right(page).disabled, true);
  right(page).click();
  await wait();
  assert.equal(page.closed, false, "no tap closes the page while iOS installs iFizBox");
}));

test("openProgress: a stoppable page's Cancel is greyed too once locked, and its stop isn't run", withDom(async () => {
  const page = openProgress();
  let stopped = 0;
  page.stoppable(() => { stopped++; });
  page.finish({ label: CLOSING_LABEL, locked: true, unlockAfter: 0 });
  assert.equal(right(page).disabled, true);
  right(page).click();
  assert.equal(stopped, 0);
  assert.equal(page.closed, false);
}));

test("openProgress: after the safety limit Close works again (iOS never took over); the button stays locked", withDom(async () => {
  const page = openProgress();
  page.finish({ label: CLOSING_LABEL, locked: true, unlockAfter: 5 });
  await wait(20);
  assert.equal(right(page).disabled, false);
  assert.equal(finishButton(page).disabled, true);
  right(page).click();
  await wait();
  assert.equal(page.closed, true);
}));

test("openProgress: an unlocked finish (any other install) still closes on its button", withDom(async () => {
  const page = openProgress();
  page.finish({ label: "Close", status: "Done" });
  assert.equal(finishButton(page).disabled, false);
  assert.equal(right(page).disabled, false);
  await finishButton(page).onclick();
  assert.equal(page.closed, true);
}));

test("lockSelfUpdate on a progressHUD page: Done, then the locked Closing button; Cancel greyed", withDom(async () => {
  const h = progressHUD("Uploading");
  assert.equal(lockSelfUpdate(h), true);
  const page = h.page;
  assert.equal(finishButton(page).textContent, CLOSING_LABEL);
  assert.equal(finishButton(page).disabled, true);
  assert.equal(right(page).disabled, true);
  right(page).click();
  assert.equal(h.cancelled, false);
  assert.equal(page.closed, false);
  page.close();
}));

test("progressHUD: a page with iFizBox's own job ends locked even when another job ends after it", () => {
  const calls = [];
  const page = { closed: false, closers: [], step() {}, status() {}, progress() {}, line() {}, error() {}, stoppable() {}, reopen() {},
    finish(o) { calls.push(o); }, onClose(f) { page.closers.push(f); }, close() { page.closed = true; page.closers.forEach((f) => f()); } };
  const other = progressHUD("Downloading", { open: () => page });
  const self = progressHUD("Downloading", { open: () => page });
  lockSelfUpdate(self);
  assert.equal(calls.length, 0, "the other job still runs");
  other.done("Done");
  assert.deepEqual([calls[0].label, calls[0].locked], [CLOSING_LABEL, true]);
  page.close();
});

test("lockSelfUpdate: a HUD without finish ends on Done after 1.2 s as before", () => {
  const timers = [];
  let done = 0;
  assert.equal(lockSelfUpdate({ set() {}, done: () => { done++; } }, { later: (f, ms) => timers.push([f, ms]) }), false);
  assert.equal(timers[0][1], 1200);
  timers[0][0]();
  assert.equal(done, 1);
});

// ---- the callers ---------------------------------------------------------------------------------------------------

const fakeNative = (answers) => ({ mode: "sideload", async call(m) { return answers[m] ?? null; } });
const recHud = (finished) => () => ({ set() {}, hide() {}, done() {}, finish: (o) => finished.push(o), page: null });

test("installOnDevice: iFizBox's own IPA (by URL or by the ID iOS gets) ends locked; another app doesn't", async () => {
  const self = "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa";
  for (const [url, answer] of [[self, { bundleId: "com.x" }], ["https://e.example/c.ipa", { bundleId: BUNDLE_ID }]]) {
    const finished = [];
    assert.equal(await installOnDevice({ url, name: NAME }, { native: fakeNative({ "signing.install": answer }), hud: recHud(finished),
      later: () => assert.fail("no timer"), follow: () => assert.fail("not followed") }), true);
    assert.deepEqual([finished[0]?.label, finished[0]?.locked], [CLOSING_LABEL, true], url);
  }
  const finished = [];
  const followed = [];
  await installOnDevice({ url: "https://e.example/a.ipa", name: "A" }, { native: fakeNative({ "signing.install": { bundleId: "com.a" } }),
    hud: recHud(finished), follow: (n, id) => followed.push(id) });
  assert.deepEqual(followed, ["com.a"]);
  assert.equal(finished.length, 0);
});

test("resignApp: iFizBox's own re-sign (hosted) ends locked; another app's ends on Done", async () => {
  const native = { async call() { return { done: [{ bundleId: "x" }], failed: [] }; } };
  const sc = { getServer: () => "https://sign.example" };
  const finished = [];
  let done = 0;
  const hud = () => ({ set() {}, hide() {}, done: () => { done++; }, fail() {}, finish: (o) => finished.push(o) });
  assert.equal(await resignApp({ id: BUNDLE_ID, name: NAME }, { sc, native, hud }), true);
  assert.deepEqual([finished[0]?.label, finished[0]?.locked], [CLOSING_LABEL, true]);
  assert.equal(done, 0);
  assert.equal(await resignApp({ id: "com.a", name: "A" }, { sc, native, hud }), true);
  assert.equal(done, 1);
  assert.equal(finished.length, 1);
});
