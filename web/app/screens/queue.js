// The install queue's screens (N4), Cydia's flow (docs/cydia.md, "Install queue"):
//
//   1. A package page's Install / Modify sheet, its Version History or an F18 "Remove X" row queues a package
//      (getBackend().queue, backend-native.js); the Confirm sheet opens at once.
//   2. Confirm: apt-get -s over the whole queue (cydian-helper simulate). Its Modifications (Install, Reinstall,
//      Upgrade, Downgrade, Remove, one row each with the names), the queue itself (tap one to clear it), and
//      Continue Queuing. When apt refuses, the sheet is "Cannot Comply": F18's plain-language explanation of each
//      problem with its action (core/deps.js explainApt through the catalog) above apt's own output, which always
//      shows; never a silent failure (Zebra #2052). Cancel clears the queue; Confirm runs it.
//   3. The console ("Running", then "Complete"): apt's and dpkg's lines streamed over the bridge as they come, the
//      status fd's lines in white, errors in red, a progress bar, then the finish button: Restart SpringBoard when
//      a changed package hooks SpringBoard (or a script asked, $CYDIA), else Return to Cydian. The run's output is
//      kept (queue.js runLogs) for Settings > Console Logs (logsPage below). A conffile changed by both the user and
//      the package opens Cydia's Configuration Upgrade alert (F63): Keep My Old Copy or Accept The New Copy, sent
//      back to dpkg through backend.answerConffile while the run waits. While apt is still downloading (no dpkg
//      status line yet) the bar has Cydia's Cancel (F64, backend.cancelApply): the run stops, nothing is installed
//      and the queue stays.
//
// While the queue holds packages: they are marked in every list (browse.js), the Installed tab's badge reads Q'd
// and its nav bar has a Queue button that reopens Confirm. Styles: queue.css.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { format, settingsRoute } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog } from "../catalog.js";
import { installQueue, runLogs } from "../queue.js";
import { MODES, MODE_LABEL, changeCount, parseStatusLine, consoleText, finishOf, FINISH_LABEL, runTitle, createRepeatFilter, CONFFILE_TITLE,
  CONFFILE_BUTTONS, conffileMessage, conffileAnswer, conffileLine, debUrlOf } from "../core/queue.js";
import { appQueue } from "../app-queue.js";
import { appPlan, runOrder, sizeText, SELF_ID, customParams, APP_MODES, APP_MODE_LABEL } from "../core/appqueue.js";

const EASE = "cubic-bezier(.25,.1,.25,1)";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function barButton(label, cls = "") {
  const b = el("button", `bar-button${cls ? ` ${cls}` : ""}`, label);
  b.type = "button";
  return b;
}

let ctxRef = null;
// F86: who waits for a Confirm sheet (either kind) to go away, and how: "confirm" | "cancel" | "closed".
let confirmWaiters = [];
function confirmEnded(how) {
  const w = confirmWaiters;
  confirmWaiters = [];
  for (const f of w) f(how);
}
// The Essential Upgrade alert (essential-ui.js) waits here after queuing: Cancel brings it back when forced.
export const whenConfirmEnds = () => new Promise((resolve) => confirmWaiters.push(resolve));

let confirm = null;   // the open Confirm sheet: { refresh(), close() }
let running = false;  // a console is up: nothing else opens over it

// app.js calls this once (jailbreak build: the backend has a queue). Queuing opens Confirm; every change redraws
// the badge and the Installed tab's Queue button.
export function initQueue(ctx) {
  ctxRef = ctx;
  installQueue.subscribe((e) => {
    if (e.type === "add") {
      nameJobs([e.job.id]);
      if (confirm) confirm.refresh();
      else if (!running) openConfirm();
    }
    if (e.type === "clear" && confirm) confirm.refresh();
    if (e.type !== "name") updateChrome();
  });
  // A tab's nav bar is built when it is first shown, so the Queue button is put in after each route change too.
  globalThis.addEventListener?.("hashchange", () => requestAnimationFrame(updateChrome));
  requestAnimationFrame(updateChrome);
}

// Names for the marks and the sheet come from the catalog, once it answers.
function nameJobs(ids) {
  catalog.queueInfo(ids).then((info) => {
    for (const id of ids) if (info?.[id]?.name) installQueue.name(id, info[id].name);
  }, () => {});
}

// Cydia's Q'd badge (on its Manage tab; ours on Installed, where its Queue button lives) and the Queue button.
function updateChrome() {
  const n = installQueue.size;
  ctxRef?.setBadge?.("installed", n && !confirm && !running ? "Q'd" : null);
  const right = document.querySelector('.nav-stack[data-tab="installed"] > .nav-item:first-child .nav-right');
  if (!right) return;
  let b = right.querySelector(".queue-button");
  if (n && !b) {
    b = barButton("Queue", "done queue-button");
    b.addEventListener("click", () => openConfirm());
    right.prepend(b);
  } else if (!n && b) b.remove();
}

// ---- a modal sheet with Cancel on the left and a Done-style button on the right ----------------------------------

export function modal({ title, left = null, right = null, cls = "" }) {
  const sheet = el("div", `sheet ${cls}`.trim());
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);
  const bar = el("header", "navbar sheet-bar");
  const row = el("div", "sheet-bar-row");
  const l = el("div", "sheet-left");
  const h1 = el("h1", "nav-title", title);
  const r = el("div", "sheet-right");
  if (left) l.append(left);
  if (right) r.append(right);
  row.append(l, h1, r);
  bar.append(row);
  const body = el("div", "sheet-body");
  const scroll = el("div", "sheet-scroll page-body grouped"); // page-body: clears the sheet's nav bar
  body.append(scroll);
  sheet.append(bar, body);
  document.body.append(sheet);
  sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 350, easing: EASE });
  let closed = false;
  return {
    sheet, scroll, h1, left: l, right: r,
    setTitle(t) { h1.textContent = t; sheet.setAttribute("aria-label", t); },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 300, easing: EASE, fill: "forwards" });
      return a.finished.then(() => sheet.remove(), () => sheet.remove());
    },
  };
}

// ---- Confirm ---------------------------------------------------------------------------------------------------

export function openConfirm() {
  if (confirm || running) { confirm?.refresh(); return; }
  if (!installQueue.size) return;
  const cancel = barButton("Cancel");
  const ok = barButton("Confirm", "done");
  ok.hidden = true;
  const m = modal({ title: "Confirm", left: cancel, right: ok, cls: "confirm-sheet" });
  let generation = 0;
  let ready = null; // { jobs, plan, ids } once apt agreed
  const close = (how = "closed") => { confirm = null; updateChrome(); confirmEnded(how); return m.close(); };
  cancel.addEventListener("click", () => { installQueue.clearAll(); close("cancel"); });
  ok.addEventListener("click", () => {
    if (!ready) return;
    const run = ready;
    close("confirm").then(() => runConsole(run));
  });

  async function refresh() {
    const gen = ++generation;
    ready = null;
    ok.hidden = true;
    if (!installQueue.size) { close("cancel"); return; }
    m.setTitle("Confirm");
    m.scroll.replaceChildren(loading("Checking with apt"));
    const jobs = await withDebUrls(installQueue.list());
    if (gen !== generation) return;
    let r, err = null;
    try { r = await getBackend().simulate(jobs); } catch (e) { err = e; }
    if (gen !== generation) return; // the queue changed while apt was asked; a newer answer is coming
    // F131: apt would pull in a package it can't download (its Filename is a full URL): queue it, so the shell
    // fetches it; the add redraws this sheet.
    if (r?.ok && (await queueLinkedDeps(r.plan, jobs)) && gen !== generation) return;
    const names = await namesFor([...jobs.map((j) => j.id), ...(r ? planIds(r.plan) : [])]);
    if (gen !== generation) return;
    m.scroll.replaceChildren();
    if (err) {
      m.setTitle("Cannot Comply");
      m.scroll.append(grouped([{ header: "Couldn't Ask apt", rows: [{ label: err.message || String(err) }],
        footer: "Nothing was changed. Cydian runs apt through its helper (cydian-helper); reinstalling Cydian puts it back." }]));
    } else if (!r.ok || r.plan.essential.length) {
      m.setTitle("Cannot Comply");
      await drawIssues(m.scroll, r, names, () => close());
      if (gen !== generation) return;
    } else if (!changeCount(r.plan)) {
      m.scroll.append(grouped([{ header: "Modifications", rows: [{ label: "Nothing to change" }],
        footer: "apt says everything queued is already as asked." }]));
    } else {
      m.scroll.append(continueGroup(close), statistics(r.plan), modifications(r.plan, names));
      ready = { jobs, plan: r.plan, ids: planIds(r.plan) };
      ok.hidden = false;
    }
    // Cydia on the 4S (docs/cydia-4s/queue-81.png, queue-83.png): Continue Queuing, Statistics, Modifications and no
    // list of the queue; a package comes out of it from its own page (Modify > Clear).
    if (r && (!r.ok || r.plan.essential.length)) m.scroll.append(rawOutput(r.output));
  }

  confirm = { refresh, close };
  updateChrome();
  refresh();
}

// F131: each install job whose version's Filename is a full URL gets that link as `debUrl` (core/queue.js debUrlOf);
// the native backend downloads those itself, since apt would join the link to the repo's URL and 404.
async function withDebUrls(jobs) {
  return Promise.all(jobs.map(async (j) => {
    if (j.op !== "install") return j;
    try {
      const url = debUrlOf(await catalog.history(j.id), j.version);
      return url ? { ...j, debUrl: url } : j;
    } catch {
      return j;
    }
  }));
}

// F131: packages apt-get -s would install or upgrade that aren't queued but whose Filename is a full URL go into the
// queue for that version. True when one was added.
async function queueLinkedDeps(plan, jobs) {
  const queued = new Set(jobs.map((j) => j.id));
  let added = false;
  for (const e of [...plan.installs, ...plan.upgrades, ...plan.downgrades]) {
    if (queued.has(e.id)) continue;
    let url = null;
    try { url = debUrlOf(await catalog.history(e.id), e.to); } catch { url = null; }
    if (!url) continue;
    installQueue.add({ op: "install", id: e.id, version: e.to, installed: e.from });
    queued.add(e.id);
    added = true;
  }
  return added;
}

function loading(text) {
  const p = el("div", "loading");
  p.append(el("span", "loading-spinner"), el("span", null, text));
  return p;
}

const planIds = (plan) => MODES.flatMap((mode) => plan[`${mode}s`].map((e) => e.id));

async function namesFor(ids) {
  const out = {};
  for (const j of installQueue.list()) if (j.name) out[j.id] = j.name;
  try {
    const info = await catalog.queueInfo([...new Set(ids)]);
    for (const [id, v] of Object.entries(info ?? {})) if (v?.name) out[id] = v.name;
  } catch { /* names fall back to ids */ }
  return out;
}

// Cydia's Statistics group: the download size, when apt says one.
function statistics(plan) {
  return plan.download ? grouped([{ header: "Statistics", rows: [{ label: "Downloading", detail: plan.download }] }]) : document.createDocumentFragment();
}

// Cydia's Modifications: one row per non-empty list, its names one per line.
// F91: the app queue's Confirm passes its own modes (core/appqueue.js APP_MODES: Re-sign among them).
function modifications(plan, names, modes = MODES, labels = MODE_LABEL) {
  const rows = [];
  for (const mode of modes) {
    const list = plan[`${mode}s`] ?? [];
    if (!list.length) continue;
    rows.push({ label: labels[mode], detail: list.map((e) => names[e.id] || e.id).join("\n") });
  }
  const frag = grouped([{ header: "Modifications", rows }]);
  frag.querySelectorAll(".cell").forEach((c) => c.classList.add("confirm-mods"));
  return frag;
}


function continueGroup(close) {
  const g = grouped([{ rows: [{ label: "Continue Queuing", chevron: true, onClick: () => close() }] }]);
  g.querySelector(".group")?.classList.add("confirm-continue"); // centred, Cydia's blue-grey (queue.css)
  return g;
}

// Cannot Comply: F18's sentences (and actions) first, then what Cydia would also call an issue: essentials.
async function drawIssues(box, r, names, close) {
  const frag = document.createDocumentFragment();
  let problems = [];
  if (!r.ok) {
    try { problems = (await catalog.aptProblems(r.output)) ?? []; } catch { problems = []; }
  }
  const sentences = [
    ...(r.issues ?? []).map((sentence) => ({ sentence })), // F131: a link that couldn't be downloaded
    ...r.plan.essential.map((id) => ({ sentence: `Removing ${names[id] || id} would take away part of the jailbreak itself (an essential package), so Cydian won't do it.` })),
    ...problems,
  ];
  if (!sentences.length) sentences.push({ sentence: `apt refused this queue${r.code ? ` (exit ${r.code})` : ""}. Its own words are below.` });
  sentences.forEach((p, i) => {
    const row = actionRow(p, close);
    const t = grouped([{ rows: row ? [row] : [] }]).firstElementChild;
    const ul = t.querySelector("ul") ?? el("ul", "table grouped");
    const li = el("li", "cell");
    li.append(el("div", "pkg-description", p.sentence));
    ul.prepend(li);
    if (!ul.parentNode) t.append(ul);
    t.classList.add("confirm-problem");
    if (i === 0) { t.classList.add("confirm-issues"); t.prepend(el("h2", "group-header", "Can't Do This Yet")); }
    if (p.detail) t.append(el("p", "group-footer", p.detail));
    frag.append(t);
  });
  box.append(frag);
}

// F18's actions: open | remove | add-source | settings (the last has no page in the app: the iOS version is known).
function actionRow(p, close) {
  const a = p.action;
  if (!a) return null;
  switch (a.kind) {
    case "open": return { label: a.label, chevron: true, onClick: () => close().then(() => ctxRef?.go({ tab: "search", path: [`package:${a.id}`] })) };
    case "remove": return { label: a.label, onClick: () => getBackend().queue({ op: "remove", id: a.id }) };
    case "add-source": return { label: a.label, subtitle: a.url, chevron: true, onClick: () => close().then(async () => {
      const { addSource } = await import("./manage.js");
      addSource(ctxRef, { url: a.url });
    }) };
    case "settings": return null;
    default: return null;
  }
}

function rawOutput(text) {
  const g = el("div", "group");
  g.append(el("h2", "group-header", "apt's Output"));
  const pre = el("pre", "table grouped confirm-raw", String(text ?? "").trim() || "(no output)");
  g.append(pre);
  return g;
}

// ---- the sideload app's (and the website's) queue: apps signed on the phone (F80) -------------------------------
//
// Cydia's flow without apt: an app page's Install / Upgrade / Reinstall (altstore.js appPageAction) and Changes'
// Upgrade (N) queue apps (app-queue.js) and open this Confirm sheet: Statistics (the download), Modifications
// (Install, Upgrade... with the names, and a tweak's dependencies once tweaks have them: core/appqueue.js appPlan),
// the Queue (tap one to clear it) and Continue Queuing; Cancel at the top left clears the queue, Confirm at the top
// right installs it in turn (runAppQueue), each signed on the phone, Cydian itself last.

let appConfirm = null;  // the open Confirm sheet for apps: { refresh(), close() }
let appRunning = false; // Confirm's installs are going: queuing adds without opening a second sheet

// Queues an app (a core/appqueue.js job) and opens Confirm, or redraws the open one. -> the job.
export function queueApp(job, { queue = appQueue, open = openAppConfirm } = {}) {
  const j = queue.add(job);
  if (!appRunning) open(queue);
  return j;
}

export function openAppConfirm(queue = appQueue) {
  if (appConfirm) { appConfirm.refresh(); return; }
  if (!queue.size) return;
  const cancel = barButton("Cancel");
  const ok = barButton("Confirm", "done");
  const m = modal({ title: "Confirm", left: cancel, right: ok, cls: "confirm-sheet" });
  // A Clear (here or on an app page's Modify) or a run's progress redraws it; an add redraws it through queueApp.
  const off = queue.subscribe((e) => { if (e.type !== "add") refresh(); });
  const close = (how = "closed") => { off(); if (appConfirm === sheet) appConfirm = null; confirmEnded(how); return m.close(); };
  cancel.addEventListener("click", () => { close("cancel"); queue.clearAll(); });
  ok.addEventListener("click", () => {
    const jobs = queue.list();
    close("confirm").then(() => runAppQueue(jobs, { queue }));
  });
  function refresh() {
    const jobs = queue.list();
    if (!jobs.length) { close("cancel"); return; }
    const names = {};
    for (const j of jobs) {
      if (j.name) names[j.id] = j.name;
      for (const d of j.deps ?? []) if (d?.name) names[d.id] = d.name;
    }
    // As Cydia's (docs/cydia-4s/queue-81.png): Continue Queuing first, then Statistics and Modifications.
    m.scroll.replaceChildren(continueGroup(close), statistics(appPlan(jobs)), modifications(appPlan(jobs), names, APP_MODES, APP_MODE_LABEL));
  }
  const sheet = { refresh, close };
  appConfirm = sheet;
  refresh();
}


// One app: signed on the phone in the sideload app (installOnDevice; Cydian's own IPA through signAndInstall, which
// hosts it on the Signing Server). The website queues nothing (F89). True once iOS was asked.
async function installApp(job) {
  const sc = await import("../signing-client.js");
  if (job.mode === "resign") return resignApp(job, { sc });
  if (job.options && sc.localSigning()) return installCustom(job, { sc });
  if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "" });
  return sc.signAndInstall({ url: job.url, name: job.name || "" });
}

// F84: Custom Install's words on its Queue row: what it signs as, where that differs.
export function customLabel(job) {
  const o = job?.options;
  if (!o) return null;
  const e = o.edits ?? {};
  const bits = [e.name && `as "${e.name}"`, e.bundleId, e.icon && "new icon",
    e.removeExtensions?.length && `${e.removeExtensions.length} extension${e.removeExtensions.length === 1 ? "" : "s"} left out`].filter(Boolean);
  return bits.length ? `Custom: ${bits.join(", ")}` : "Custom Install";
}

// F84: a Custom Install job: signing.install with its own options (core/appqueue.js customParams: the look's token
// while fresh, else the url, and the edits), then iOS's progress on the HUD as the sheet did (signing-sheet.js
// followInstall). The token is spent by the try, so a failed run that keeps the job queued downloads it again next time.
export async function installCustom(job, { sc, follow = null, now = Date.now(), native = globalThis.cydianNative } = {}) {
  const params = customParams(job, now);
  if (params.token) job.options.token = null;
  const after = follow ?? (async (result, h) => (await import("../signing-sheet.js")).followInstall(native, result?.bundleId || job.options.signsAs || "", h));
  return sc.installOnDevice({ url: job.url, name: job.options.name || job.name || "", params,
    after, ...(sc.isSelfIpa(job.url) ? { host: true } : {}) });
}

// F91: a "resign" job: signing.resign {bundleId} signs the app again from the phone's record (Re-sign All's path,
// one app) and opens iOS's install, the HUD following it; Cydian's own is hosted on the Signing Server, as its
// install is (iOS closes Cydian). True once iOS was asked.
export async function resignApp(job, { sc, native = globalThis.cydianNative, hud = null, alert = showAlert } = {}) {
  sc ??= await import("../signing-client.js");
  const { resignLabel, deviceError } = await import("../core/signing.js");
  const h = hud ? hud("Re-signing") : liveHUD("Re-signing");
  let r;
  try {
    if (!native?.call) throw new Error("Re-signing needs the Cydian app.");
    r = await native.call("signing.resign", { bundleId: job.id, manifestServer: sc.getServer(), ...(job.id === SELF_ID ? { host: true } : {}) },
      (ev) => { const t = resignLabel(ev); if (t) h.set(t.replace(/ \(1 of 1\)$/, "")); });
  } catch (e) {
    h.hide();
    const why = deviceError(e, job.name || job.id);
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message: why.message, buttons: ["OK"] });
    return false;
  }
  h.hide();
  const failed = Array.isArray(r?.failed) ? r.failed : [];
  if (failed.length || !(r?.done ?? []).length) {
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message: failed.map((f) => f.error || "failed").join("\n") || "Nothing was signed.", buttons: ["OK"] });
    return false;
  }
  return true;
}

function liveHUD(text) {
  const hide = showHUD(text);
  const label = typeof document === "undefined" ? null : [...document.querySelectorAll(".hud-label")].at(-1);
  return { set: (t) => { if (label) label.textContent = t; }, hide };
}

// F30/I3: the version Install put on the phone, so Installed and Changes follow it (Cydian records itself).
async function recordApp(job) {
  if (job.id === SELF_ID || job.mode === "resign") return; // F91: a re-sign changes no version
  const { apps, recordInstall } = await import("../core/installed.js");
  await recordInstall(await apps(), { id: job.id, name: job.name, version: job.version, key: job.key, source: job.source,
    sourceName: job.sourceName || "", icon: job.icon });
}

// The sideload app's first install with something missing opens the Signing walkthrough (F75) instead: nothing runs.
async function readyToInstall() {
  const sc = await import("../signing-client.js");
  return !(sc.localSigning() && await sc.firstInstallCheck());
}

// Confirm's run: each app in turn (runOrder: Cydian last), each one out of the queue once iOS has it; the first
// failure (its alert already shown) stops the run and leaves the rest queued. -> how many were installed.
export async function runAppQueue(jobs, { queue = appQueue, install = installApp, record = recordApp, ready = readyToInstall } = {}) {
  if (appRunning) return 0;
  appRunning = true;
  let done = 0;
  try {
    if (!(await ready())) return 0;
    for (const j of runOrder(jobs)) {
      if (!queue.get(j.id)) continue; // cleared meanwhile
      let ok = false;
      try { ok = await install(j); } catch { ok = false; }
      if (!ok) break;
      done++;
      queue.clear(j.id);
      try { await record(j); } catch { /* no store: Installed won't list it */ }
    }
  } finally {
    appRunning = false;
  }
  return done;
}

// ---- the console -----------------------------------------------------------------------------------------------

const MAX_LINES = 1500; // lines kept on screen; the log keeps everything (trimmed only past core/queue.js's cap)

// F71: Roll Back runs in the same console: one stored .deb through backend.rollback, outside the queue (whatever is
// queued stays queued). False when a console is already up.
export function runRollback({ id, version, installed = null, name = "" }) {
  if (running) return false;
  const jobs = [{ op: "install", id, version, installed, name, mode: "rollback" }];
  runConsole({ jobs, ids: [id], keepQueue: true, asks: false, title: (names) => `Roll Back ${name || names[id] || id} to ${version}`,
    run: (onEvent) => getBackend().rollback(id, version, onEvent) });
  return true;
}

// F74: a paid package's Download & Install (screens/extras.js) in the same console: `run(onEvent)` is the shell's
// paid.install with stream on (its dlstatus/pmstatus lines like ipa.install). Outside the queue. Null when a console
// is already up; else a promise for the run's end ({ ok, reloaded }: reloaded settles once dpkg status is read again).
export function runPaidInstall({ id, version, name = "", run }) {
  if (running) return null;
  const jobs = [{ op: "install", id, version, installed: null, name, mode: "install" }];
  return runConsole({ jobs, ids: [id], keepQueue: true, asks: false, title: (names) => `Install ${name || names[id] || id} ${version}`, run });
}

// asks: the run is apply-ask (F63), so a conffile line opens the Configuration Upgrade alert and its answer goes back
// through backend.answerConffile; otherwise dpkg keeps the old copy (--force-confold) and the console says so.
async function runConsole({ jobs, ids, keepQueue = false, asks = true, title = null, run = (onEvent) => getBackend().apply(jobs, onEvent) }) {
  running = true;
  updateChrome();
  const close = barButton("Close");
  close.hidden = true;
  // F64: Cancel while apt only downloads (a queue run, apply-ask: the helper reads its stdin); gone once dpkg starts.
  const canCancel = asks && typeof getBackend().cancelApply === "function";
  const cancel = barButton("Cancel");
  cancel.hidden = !canCancel;
  const m = modal({ title: "Running", left: cancel, right: close, cls: "console" });
  m.scroll.className = "sheet-scroll console-scroll";
  const out = el("div", "console-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  const foot = el("div", "console-foot");
  const statusText = el("div", "console-status", "Preparing");
  const bar = el("div", "console-progress");
  const fill = el("div", "console-fill");
  bar.append(fill);
  foot.append(statusText, bar);
  m.scroll.append(out, foot);

  const log = [];
  let pending = [];
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending.length) return;
    const frag = document.createDocumentFragment();
    for (const [type, text] of pending) frag.append(el("div", `console-line ${type}`, text));
    pending = [];
    out.append(frag);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    m.scroll.scrollTop = m.scroll.scrollHeight;
  };
  const fresh = createRepeatFilter(); // C6: apt's "Retrieving file 1 of N" shows once, not once per percent
  const line = (type, text) => {
    if (!fresh(type, text)) return;
    log.push(type === "info" ? text : type === "error" ? `E: ${text}`.replace(/^E: E: /, "E: ") : `» ${text}`);
    pending.push([type, text]);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const setProgress = (pct) => { fill.style.transform = `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`; };
  setProgress(0);

  const names = await namesFor(ids);
  const label = (pkg) => names[pkg] || pkg;
  let finish = "return";
  try {
    const info = await catalog.queueInfo(ids);
    if (Object.values(info ?? {}).some((v) => v?.restart)) finish = "restart";
  } catch { /* the scripts' own finish lines still count */ }

  let result = null, error = null, ended = false;
  let cancelled = false, dpkg = false;
  const dpkgStarted = () => { dpkg = true; cancel.hidden = true; };
  cancel.addEventListener("click", async () => {
    if (cancel.disabled || dpkg || ended) return;
    cancel.disabled = true;
    statusText.textContent = "Cancelling";
    try {
      await getBackend().cancelApply();
      cancelled = true;
      cancel.hidden = true;
    } catch (e) {
      if (ended) return;
      line("error", `Couldn't cancel: ${e.message || String(e)}`);
      if (dpkg) cancel.hidden = true; else cancel.disabled = false;
    }
  });
  // F63: dpkg waits on one question at a time; alerts are shown one after another all the same.
  let asking = Promise.resolve();
  const ask = (file) => {
    asking = asking.then(async () => {
      const { index } = await showAlert({ title: CONFFILE_TITLE, message: conffileMessage(file), buttons: CONFFILE_BUTTONS, cancel: 0, stacked: true });
      if (ended) return;
      const answer = conffileAnswer(index);
      try {
        await getBackend().answerConffile(answer);
        line("status", conffileLine(file, answer));
      } catch (e) {
        line("error", `Configuration file ${file}: ${e.message || String(e)}`);
      }
    });
  };
  const canAsk = asks && typeof getBackend().answerConffile === "function";
  try {
    result = await run(({ fd, line: raw }) => {
      if (fd === "status") {
        if (!dpkg && /^pm(status|conffile|error):/.test(raw)) dpkgStarted();
        const s = parseStatusLine(raw);
        if (s.type === "finish") { finish = finishOf(finish, s.finish); return; }
        if (s.type === "conffile") {
          if (s.percent != null) setProgress(s.percent);
          statusText.textContent = `Configuration file ${s.file}`;
          if (canAsk) ask(s.file);
          else line("status", conffileLine(s.file, "keep"));
        } else if (s.type === "status") {
          const text = s.pkg && s.text ? s.text.replaceAll(s.pkg, label(s.pkg)) : s.text;
          if (s.percent != null && !s.download) setProgress(s.percent);
          statusText.textContent = text;
          line("status", text);
        } else if (s.type === "error") line("error", `${label(s.pkg)}: ${s.text}`);
        else line("info", s.text);
        return;
      }
      const text = consoleText(raw);
      if (!text) return;
      line(fd === "err" && /^(E:|dpkg: error)/.test(text) ? "error" : fd === "err" && /^W:/.test(text) ? "warning" : "info", text);
    });
  } catch (e) {
    error = e;
  }
  ended = true;
  cancel.hidden = true;
  flush();

  const ok = result?.code === 0 && !error;
  // F64: the helper stopped apt before dpkg ran (SIGINT: exit 130). A run that went through anyway counts as done.
  const stopped = cancelled && !ok && !dpkg;
  if (error) line("error", error.message || String(error));
  else if (stopped) line("status", "Cancelled. Nothing was installed or removed; the queue is kept.");
  else if (!ok) {
    line("error", `apt-get stopped with exit code ${result.code}. Nothing after the error above was done.`);
    try {
      const problems = (await catalog.aptProblems([result.stdout, result.stderr].join("\n"))) ?? [];
      for (const p of problems) line("error", p.sentence);
    } catch { /* the raw lines above say it */ }
  }
  flush();
  setProgress(100);
  m.setTitle("Complete");
  statusText.textContent = ok ? "Done" : stopped ? "Cancelled" : "Failed";

  runLogs.add({ title: title ? title(names) : runTitle(jobs.map((j) => ({ ...j, name: j.name || names[j.id] }))), jobs: jobs.map((j) => ({ op: j.op, id: j.id, version: j.version, mode: j.mode })),
    code: error ? -1 : result.code, text: log.join("\n") });
  // A run that went through empties the queue; one apt stopped keeps it, so Confirm can show what's left to fix.
  if (ok && !keepQueue) installQueue.clearAll();
  const reloaded = catalog.reloadInstalled?.().catch(() => {});

  const done = () => { running = false; updateChrome(); return m.close(); };
  const level = ok ? finish : "return";
  const button = el("button", "console-finish", FINISH_LABEL[level]);
  button.type = "button";
  button.addEventListener("click", () => finishAction(level, done));
  bar.replaceWith(button);
  close.hidden = false;
  close.addEventListener("click", () => done());
  return { ok, reloaded };
}

async function finishAction(level, done) {
  if (level === "restart" || level === "reload") {
    const hide = showHUD("Loading");
    try {
      await getBackend().respring();
    } catch (e) {
      hide();
      await showAlert({ title: "Restart SpringBoard", message: e.message || String(e), buttons: ["OK"] });
      return;
    }
    hide();
    return;
  }
  if (level === "reboot") {
    await showAlert({ title: "Reboot Device", message: "A package asked for a reboot to finish. Restart the iPhone, then jailbreak it again with your jailbreak app if it needs that.", buttons: ["OK"] });
  }
  done();
}

// ---- Settings > Console Logs -----------------------------------------------------------------------------------

export const LOGS = "logs"; // #/settings/logs and #/settings/logs/<id>

export function logsTitle(id) {
  return id ? "Console Log" : "Console Logs";
}

// The root of Settings: one row to the list (only where runs happen: the jailbreak build, or logs exist).
export function logsSection(mode) {
  const list = runLogs.list();
  if (mode !== "jailbreak" && !list.length) return document.createDocumentFragment();
  return grouped([{ header: "Console", rows: [{ label: "Console Logs", detail: list.length ? String(list.length) : "None", href: format(settingsRoute([LOGS])) }],
    footer: "The output of every install, upgrade and removal, kept on this iPhone." }]);
}

const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function logsPage(id, redraw = () => {}) {
  if (id) {
    const e = runLogs.get(decodeURIComponent(id));
    if (!e) return grouped([{ rows: [{ label: "This log is gone" }], footer: "Logs past the newest 20 are dropped." }]);
    const frag = document.createDocumentFragment();
    frag.append(grouped([{ rows: [{ label: e.title || "Run", subtitle: when(e.at), detail: e.ok ? "Completed" : `Failed (${e.code})` }] }]));
    const g = el("div", "group");
    g.append(el("pre", "table grouped console-log", e.text || "(no output)"));
    frag.append(g);
    return frag;
  }
  const list = runLogs.list();
  if (!list.length) return grouped([{ rows: [{ label: "No Logs Yet" }], footer: "Each run of the install queue keeps its console output here." }]);
  return grouped([
    { rows: list.map((e) => ({ label: e.title || "Run", subtitle: `${when(e.at)} · ${e.ok ? "Completed" : `Failed (${e.code})`}`,
      href: format(settingsRoute([LOGS, e.id])) })), footer: "The newest 20 runs." },
    { rows: [{ label: "Clear Logs", onClick: async () => {
      const i = await showActionSheet({ buttons: ["Clear Logs"], destructive: 0 });
      if (i === 0) { runLogs.clear(); redraw(); }
    } }] },
  ]);
}
