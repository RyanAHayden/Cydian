// B90: iOS's Install prompt (opened at the tap by the early link) cancelled while the website still downloads, signs
// or uploads: watchPrompt reads the Worker's "asked" mark (iOS's first app.ipa request) and the page coming back,
// and signInBrowser stops and ends "Not Installed" / "Cancelled in iOS." with Try Again above Return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInBrowser, watchPrompt, PROMPT_GRACE, PROMPT_CAP, IOS_CANCELLED_TITLE, IOS_CANCELLED_TEXT } from "./signing-client.js";
import { TRY_AGAIN_LABEL } from "./nav/progress.js";

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// a clock moved by sleep, a status answer per look, and focus events the test fires
function rig(answers) {
  let t = 0;
  const looks = [];
  const wl = {}, dl = {}; // window's and document's listeners
  const win = { addEventListener: (k, f) => { (wl[k] ??= new Set()).add(f); }, removeEventListener: (k, f) => wl[k]?.delete(f) };
  const doc = { visibilityState: "visible", addEventListener: (k, f) => { (dl[k] ??= new Set()).add(f); }, removeEventListener: (k, f) => dl[k]?.delete(f) };
  const focus = () => { for (const f of wl.focus ?? []) f(); };
  const visible = () => { doc.visibilityState = "visible"; for (const f of dl.visibilitychange ?? []) f(); };
  const hooks = { onLook: null };
  const fetcher = async (url) => {
    looks.push({ url, t });
    hooks.onLook?.(looks.length, t);
    const a = typeof answers === "function" ? answers(looks.length, t) : answers;
    return a === null ? json({ error: "no" }, 404) : json(a);
  };
  const sleep = async (ms) => { t += ms; await new Promise((r) => setImmediate(r)); };
  const opts = { fetcher, sleep, clock: () => t, win, doc };
  const listening = () => (wl.focus?.size ?? 0) + (wl.pageshow?.size ?? 0) + (dl.visibilitychange?.size ?? 0);
  return { opts, looks, focus, visible, hooks, listening, now: () => t };
}
const until = async (fn, n = 2000) => { for (let i = 0; i < n && !fn(); i++) await new Promise((r) => setImmediate(r)); };

test("watchPrompt: manifest seen, the page back in front, no 'asked' within the grace: cancelled once", async () => {
  const r = rig({ manifest: true, asked: false, started: false, finished: false });
  let cancels = 0;
  r.hooks.onLook = (n) => { if (n === 3) r.focus(); };
  const w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++ });
  await until(() => w.state !== "watching");
  assert.equal(w.state, "cancelled");
  assert.equal(cancels, 1);
  assert.ok(r.now() >= PROMPT_GRACE && r.now() < PROMPT_CAP, `after the grace, not the cap (${r.now()})`);
  assert.match(r.looks[0].url, /\/sign\/up\/(ab){24}\/status$/);
  assert.equal(r.listening(), 0, "listeners removed");
});

test("watchPrompt: visibilitychange to visible counts as back too", async () => {
  const r = rig({ manifest: true, asked: false });
  r.hooks.onLook = (n) => { if (n === 2) r.visible(); };
  const w = watchPrompt("ab".repeat(24), { ...r.opts });
  await until(() => w.state !== "watching");
  assert.equal(w.state, "cancelled");
  assert.ok(r.now() < PROMPT_CAP);
});

test("watchPrompt: a late 'asked' inside the grace carries on", async () => {
  let back = -1;
  const r = rig((n) => ({ manifest: true, asked: back >= 0 && n >= back + 4, started: false, finished: false }));
  r.hooks.onLook = (n) => { if (n === 2) { r.focus(); back = n; } };
  let cancels = 0;
  const w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++ });
  await until(() => w.state !== "watching");
  assert.equal(w.state, "asked");
  assert.equal(cancels, 0);
  assert.equal(r.listening(), 0);
});

test("watchPrompt: no focus event at all: cancelled at the cap after the manifest", async () => {
  const r = rig((n) => ({ manifest: n >= 3, asked: false }));
  let cancels = 0;
  const w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++ });
  await until(() => w.state !== "watching", 20000);
  assert.equal(w.state, "cancelled");
  assert.equal(cancels, 1);
  assert.ok(r.now() >= PROMPT_CAP + 2000, `the cap counts from the manifest (${r.now()})`);
});

test("watchPrompt: a return before the manifest was seen doesn't count", async () => {
  const r = rig((n) => ({ manifest: n >= 4, asked: false }));
  r.hooks.onLook = (n) => { if (n === 1) r.focus(); };
  const w = watchPrompt("ab".repeat(24), { ...r.opts });
  await until(() => w.state !== "watching", 20000);
  assert.equal(w.state, "cancelled");
  assert.ok(r.now() >= PROMPT_CAP, `only the cap ended it (${r.now()})`);
});

test("watchPrompt: an older Worker (no 'asked' key) never cancels; nor does no status at all", async () => {
  let r = rig({ manifest: true, started: false, finished: false });
  r.hooks.onLook = () => r.focus();
  let cancels = 0;
  let w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++ });
  await until(() => w.state !== "watching");
  assert.equal(w.state, "unknown");
  assert.equal(r.looks.length, 1);
  r = rig(null);
  w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++, upTo: 60000 });
  await until(() => w.state !== "watching", 20000);
  assert.equal(w.state, "stopped");
  assert.equal(cancels, 0);
});

test("watchPrompt: stop() ends it before anything is decided", async () => {
  const r = rig({ manifest: true, asked: false });
  let cancels = 0;
  const w = watchPrompt("ab".repeat(24), { ...r.opts, onCancel: () => cancels++ });
  w.stop();
  await until(() => false, 50);
  assert.equal(w.state, "stopped");
  assert.equal(cancels, 0);
  assert.equal(r.listening(), 0);
});

// ---- signInBrowser ------------------------------------------------------------------------------------------------

const profile = (appId) => new TextEncoder().encode(`junk<?xml version="1.0"?><plist version="1.0"><dict>
<key>TeamIdentifier</key><array><string>TEAM1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM1.${appId}</string></dict></dict></plist>junk`);
const ID = { p12: new Uint8Array([0x30, 1]), profile: profile("com.you.*"), password: "pw", passwordOk: true };
const SELF = "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa";

function server() {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    calls.push({ method: init.method ?? "GET", path: u.pathname });
    if (u.pathname === "/api/fetch") return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    if (u.pathname === "/sign/upload") return json({ token: u.searchParams.get("token"), reserved: true, partSize: 4, parts: 1 });
    if (/\/fail$/.test(u.pathname) || /^\/sign\/upload\/\w+\/\d+$/.test(u.pathname)) return json({ ok: true });
    return json({ error: "no" }, 404);
  };
  return { fetcher, calls };
}

// a progressHUD-like HUD: finish records its options; the signal aborts on Cancel
function hudRig() {
  const log = { steps: [], errors: [], finishes: [] };
  const make = (t) => {
    log.steps.push(t);
    return { set: (x) => log.steps.push(x), hide: () => log.steps.push("hide"), done: (x) => log.steps.push("done " + x),
      fail: (m) => log.errors.push("fail " + m), finish: (o) => log.finishes.push(o), signal: null,
      page: { error: (m) => log.errors.push(m), raw: () => {} } };
  };
  return { make, log };
}

test("signInBrowser: iOS's prompt cancelled mid-signing stops the signer, drops the link, ends Not Installed with Try Again", async () => {
  const srv = server(), hr = hudRig(), opened = [];
  let signerSignal = null, prompts = [];
  const fakePrompt = (token, { onCancel }) => { const p = { token, onCancel, stopped: false, stop() { p.stopped = true; } }; prompts.push(p); return p; };
  const d = {
    hud: hr.make, alert: async () => { throw new Error("no alert"); }, open: (u) => opened.push(u), go: () => {},
    now: () => ID, identity: async () => ID, fetcher: srv.fetcher, transfer: async () => null, origin: () => "https://ifizbox.example",
    phone: async () => null, prompt: fakePrompt,
    worker: (job, { signal }) => new Promise((_, reject) => {
      signerSignal = signal;
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { code: "cancelled" })));
    }),
  };
  const run = signInBrowser({ url: SELF, name: "iFizBox" }, d);
  await until(() => signerSignal);
  assert.equal(opened.length, 1);
  assert.equal(prompts.length, 1);
  prompts[0].onCancel(); // the watcher read a cancel
  assert.equal(await run, false);
  assert.equal(signerSignal.aborted, true, "the signer was stopped");
  assert.ok(srv.calls.some((c) => c.method === "POST" && c.path === `/sign/upload/${prompts[0].token}/fail`), "the link dropped");
  assert.deepEqual(hr.log.errors, [IOS_CANCELLED_TEXT]);
  assert.equal(hr.log.finishes.length, 1);
  const f = hr.log.finishes[0];
  assert.equal(f.title, IOS_CANCELLED_TITLE);
  assert.equal(f.also.label, TRY_AGAIN_LABEL);
  assert.equal(f.label, undefined, "Return, the HUD's own finish label, under it");
  assert.ok(prompts[0].stopped);
  // Try Again: the install again from that tap, so a fresh early link opened inside it; the page stays up
  assert.equal(f.also.action(), true);
  assert.equal(opened.length, 2, "opened at once, inside the tap");
  assert.notEqual(opened[1], opened[0]);
  await until(() => prompts.length === 2 && signerSignal && !signerSignal.aborted);
  prompts[1].onCancel();
  await until(() => hr.log.finishes.length === 2);
});

test("signInBrowser: a prompt that was answered (no cancel) carries on into watchInstall", async () => {
  const srv = server(), hr = hudRig(), prompts = [];
  const fakePrompt = (token) => { const p = { token, stopped: false, stop() { p.stopped = true; } }; prompts.push(p); return p; };
  let watched = null;
  const d = {
    hud: hr.make, alert: async () => ({ index: 0 }), open: () => {}, go: () => {},
    now: () => ID, identity: async () => ID, fetcher: srv.fetcher, transfer: async () => null, origin: () => "https://ifizbox.example",
    phone: async () => null, prompt: fakePrompt,
    worker: async () => ({ ok: true, ipa: new Uint8Array([0x50, 0x4b, 1, 2]), bundleId: "com.ryha.ifizbox", name: "iFizBox", version: "1" }),
    watch: (token) => { watched = token; return { first: Promise.resolve() }; },
  };
  // the upload's done answers with a link
  const fetcher = async (url, init) => (/\/done$/.test(url) ? json({ itms: "itms-services://x", expiresIn: 600 }) : srv.fetcher(url, init));
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, { ...d, fetcher }), true);
  assert.equal(watched, prompts[0].token);
  assert.ok(prompts[0].stopped, "the prompt watcher stops once uploaded");
  assert.equal(hr.log.finishes.length, 0);
  assert.ok(!srv.calls.some((c) => /\/fail$/.test(c.path)));
});

test("signInBrowser without a finish HUD: the Not Installed alert, Try Again re-runs from its tap", async () => {
  const srv = server(), opened = [], alerts = [];
  let prompts = [], signals = [];
  const fakePrompt = (token, { onCancel }) => { const p = { token, onCancel, stop() {} }; prompts.push(p); return p; };
  const d = {
    hud: () => ({ set: () => {}, hide: () => {}, done: () => {}, signal: null }),
    alert: async (a) => { alerts.push(a); if (alerts.length === 1) a.onTap?.(1); return { index: alerts.length === 1 ? 1 : 0 }; },
    open: (u) => opened.push(u), go: () => {}, now: () => ID, identity: async () => ID, fetcher: srv.fetcher, transfer: async () => null,
    origin: () => "https://ifizbox.example", phone: async () => null, prompt: fakePrompt,
    worker: (job, { signal }) => new Promise((_, reject) => { signals.push(signal); signal.addEventListener("abort", () => reject(new Error("Cancelled"))); }),
  };
  const run = signInBrowser({ url: SELF, name: "iFizBox" }, d);
  await until(() => signals.length === 1);
  prompts[0].onCancel();
  assert.equal(await run, false);
  assert.equal(alerts[0].title, IOS_CANCELLED_TITLE);
  assert.equal(alerts[0].message, IOS_CANCELLED_TEXT);
  assert.deepEqual(alerts[0].buttons, ["Cancel", TRY_AGAIN_LABEL]);
  assert.equal(opened.length, 2, "Try Again opened a fresh link from the tap");
  await until(() => signals.length === 2);
  prompts[1].onCancel();
  await until(() => alerts.length === 2);
});
