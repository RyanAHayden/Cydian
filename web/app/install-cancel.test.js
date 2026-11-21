// F188: the running IPA install's progress page has Cancel at the top right from the first step to the end (iOS's own
// "Install?" prompt can be cancelled, which left the page waiting for ever), Done in its place once it has finished
// or failed. Cancel stops what it can and closes the page: the website's download, Web Worker and upload, the
// sideload build's bridge call (signing.cancel asked for, its answer ignored), the jailbreak build's ipa.install run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openProgress, progressHUD } from "./nav/progress.js";
import { signInBrowser, installOnDevice, installFromLibrary, runInWorker, downloadIpa, untilCancel } from "./signing-client.js";
import { runIpaInstall } from "./ipa-install.js";

// ---- a fake DOM, enough for nav/progress.js ----------------------------------------------------------------------
function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, parentNode: null,
      textContent: "", hidden: false, disabled: false, type: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => (on ?? !e._cls.has(c) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
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

const buttons = (sheet) => {
  const all = [];
  const walk = (n) => { for (const k of n.children) { if (k._cls.has("bar-button")) all.push(k); walk(k); } };
  walk(sheet);
  return all;
};
// The nav bar's right button (the second bar button: Cancel at the left stays the queue's), as the user sees it.
const right = (page) => buttons(page.sheet)[1];
const shown = (page) => (right(page).hidden ? null : right(page).textContent);
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- the page ----------------------------------------------------------------------------------------------------

test("openProgress: a stoppable page has Cancel at the top right while it runs, Done once finished; Cancel closes it", withDom(async () => {
  const page = openProgress();
  assert.equal(shown(page), null, "a page that isn't stoppable (the queue's) keeps the right side empty while it runs");
  let stopped = 0;
  page.stoppable(() => { stopped++; });
  assert.equal(shown(page), "Cancel");
  page.status("Signing");
  page.progress(40);
  assert.equal(shown(page), "Cancel");
  page.finish({ status: "Failed" });
  assert.equal(shown(page), "Done", "Done replaces Cancel once it has ended");
  page.reopen();
  assert.equal(shown(page), "Cancel", "the next job of a run can be cancelled again");
  right(page).click();
  assert.equal(stopped, 1);
  assert.equal(page.closed, true, "Cancel goes back to the page under it");

  const p2 = openProgress();
  p2.stoppable(() => { stopped++; });
  p2.finish({});
  right(p2).click();
  assert.equal(stopped, 1, "Done only closes: nothing is stopped after the end");
  assert.equal(p2.closed, true);

  const p3 = openProgress();
  p3.finish({});
  assert.equal(shown(p3), "Close", "the queue's page still ends on Close");
}));

test("progressHUD: Cancel in every state of a job; its tap aborts the signal, runs the job's stops, and later steps are ignored", withDom(async () => {
  const h = progressHUD("Downloading");
  const page = h.page;
  for (const t of ["Downloading 40%", "Signing", "Uploading 50%", "Installing", "Waiting for iOS"]) {
    h.set(t);
    assert.equal(shown(page), "Cancel", `Cancel while "${t}"`);
  }
  const stops = [];
  h.onCancel(() => stops.push("worker"));
  assert.equal(h.cancelled, false);
  right(page).click();
  assert.equal(h.cancelled, true);
  assert.equal(h.signal.aborted, true);
  assert.deepEqual(stops, ["worker"]);
  assert.equal(page.closed, true);
  h.onCancel(() => stops.push("late"));
  assert.deepEqual(stops, ["worker", "late"], "a stop added after Cancel runs at once");
  h.set("Installed");
  h.done("Done");
  h.fail("boom");
  assert.equal(page.finished, false, "nothing finishes a cancelled job's page");

  const ok = progressHUD("Downloading");
  ok.done("Done");
  assert.equal(shown(ok.page), "Done");
  ok.page.close();
  const bad = progressHUD("Signing");
  bad.fail("zsign: no");
  assert.equal(shown(bad.page), "Done", "a failed job ends on Done too");
  right(bad.page).click();
  assert.equal(bad.cancelled, false, "Done after the end isn't a Cancel");
}));

test("untilCancel: the job's promise, or a cancelled rejection the moment Cancel is tapped; no Cancel, just the promise", async () => {
  const stops = [];
  const h = { onCancel: (f) => stops.push(f) };
  const p = untilCancel(h, new Promise(() => {}));
  stops.forEach((f) => f());
  await assert.rejects(p, (e) => e.code === "cancelled");
  assert.equal(await untilCancel({}, Promise.resolve(3)), 3);
});

// ---- the website --------------------------------------------------------------------------------------------------

// A HUD as progressHUD makes it, on a page that records what it shows (the page tests above cover the DOM).
function hudWithPage() {
  const page = { calls: [], stop: null, finished: false, closed: false, line() {}, step() {}, error() {}, status() {},
    progress() {}, reopen() {}, onClose() {}, finish() { page.finished = true; },
    stoppable(fn) { page.stop = fn; }, close() { page.closed = true; } };
  const tap = () => { page.stop?.(); page.close(); };
  let h;
  return { page, tap, hud: (t) => (h = progressHUD(t, { open: () => page })), get h() { return h; } };
}

const ID = { p12: new Uint8Array([0x30, 1]), profile: new Uint8Array([2, 3]), password: "pw" };
const IPA = new Uint8Array([0x50, 0x4b, 3, 4]);

test("website: Cancel while signing ends the Web Worker; nothing is uploaded, no alert, false", async () => {
  const x = hudWithPage();
  const calls = [];
  const alerts = [];
  let worker = null;
  const fetcher = async (url, init = {}) => { calls.push(`${init.method ?? "GET"} ${new URL(url, "https://s.example").pathname}`); return new Response(IPA); };
  const run = signInBrowser({ url: "https://a.example/x.ipa", name: "X" }, {
    hud: x.hud, fetcher, identity: async () => ID, alert: async (a) => { alerts.push(a); return { index: 0 }; },
    transfer: async () => null, now: () => null,
    worker: (job, opts) => runInWorker(job, { ...opts, make: () => (worker = { terminated: false, terminate() { this.terminated = true; }, postMessage() {} }) }),
  });
  for (let i = 0; i < 20 && !worker; i++) await tick();
  assert.ok(worker, "the signer started");
  assert.equal(x.page.stop != null, true, "Cancel is up while it signs");
  x.tap();
  assert.equal(await run, false);
  assert.equal(worker.terminated, true, "zsign's worker is ended");
  assert.deepEqual(calls, ["GET /api/fetch"], "no upload after Cancel");
  assert.deepEqual(alerts, []);
});

test("website: Cancel while downloading aborts the fetch", async () => {
  const x = hudWithPage();
  let signal = null;
  const fetcher = (url, init) => new Promise((resolve, reject) => {
    signal = init.signal;
    if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const alerts = [];
  const run = signInBrowser({ url: "https://a.example/x.ipa" }, { hud: x.hud, fetcher, identity: async () => ID,
    alert: async (a) => { alerts.push(a); return { index: 0 }; }, worker: async () => assert.fail("no signing"), now: () => null });
  for (let i = 0; i < 20 && !signal; i++) await tick();
  x.tap();
  assert.equal(await run, false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(alerts, []);
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher, signal: AbortSignal.abort(), wait: async () => {} }), (e) => e.code === "cancelled");
});

// ---- the sideload build (the phone signs) ------------------------------------------------------------------------

function hangingNative() {
  const calls = [];
  return { calls, call: (method, params) => { calls.push(method); return method === "signing.cancel" ? Promise.reject(new Error("unknown method")) : new Promise(() => {}); } };
}

test("sideload: Cancel while signing.install runs asks the shell to stop, ends at once, and frees the next install", async () => {
  const x = hudWithPage();
  const native = hangingNative();
  const alerts = [];
  const deps = { native, hud: x.hud, alert: async (a) => { alerts.push(a); return { index: 0 }; }, later: () => {} };
  const run = installOnDevice({ url: "https://a.example/x.ipa", name: "X", onInstalled: () => assert.fail("not installed") }, deps);
  await tick();
  x.tap();
  assert.equal(await run, false);
  // B252: the page's hold from Confirm, let go once the install ended (Cancel)
  assert.deepEqual(native.calls, ["signing.hold", "signing.install", "signing.cancel", "signing.hold"]);
  assert.deepEqual(alerts, []);
  // the one-install lock came free: a second Install starts
  const y = hudWithPage();
  const again = installOnDevice({ url: "https://a.example/x.ipa" }, { ...deps, hud: y.hud });
  await tick();
  assert.equal(native.calls.filter((m) => m === "signing.install").length, 2);
  y.tap();
  assert.equal(await again, false);
});

test("sideload: My IPAs' Install can be cancelled while it signs", async () => {
  const x = hudWithPage();
  const native = hangingNative();
  const run = installFromLibrary({ file: "a.ipa", name: "A", onInstalled: () => assert.fail("not installed") },
    { native, hud: x.hud, check: async () => false, reachable: async () => assert.fail("not reached"), alert: async () => assert.fail("no alert") });
  await tick();
  await tick();
  x.tap();
  assert.equal(await run, false);
  assert.deepEqual(native.calls, ["library.sign", "signing.cancel"]);
});

// ---- the jailbreak build (ipa.install) ---------------------------------------------------------------------------

test("jailbreak: runIpaInstall ends on Cancel without waiting for ipa.install; its later lines are dropped", async () => {
  let emit = null;
  const native = { call: (m, p, onEvent) => { emit = onEvent; return new Promise(() => {}); } };
  const seen = [];
  const view = { line: (t, s) => seen.push([t, s]), status: (s) => seen.push(["status", s]), progress: () => {} };
  const ctl = new AbortController();
  const run = runIpaInstall({ url: "https://a.example/A.ipa", name: "A" }, view, { native, signal: ctl.signal });
  await tick();
  emit({ fd: "status", line: "dlstatus:ipa:0:Downloading" });
  ctl.abort();
  const r = await run;
  assert.equal(r.cancelled, true);
  assert.equal(r.ok, false);
  assert.match(r.log, /Cancelled$/);
  const before = seen.length;
  emit({ fd: "out", line: "late" });
  assert.equal(seen.length, before, "nothing drawn after Cancel");
  const pre = await runIpaInstall({ url: "https://a.example/A.ipa" }, view, { native, signal: AbortSignal.abort() });
  assert.equal(pre.cancelled, true);
});
