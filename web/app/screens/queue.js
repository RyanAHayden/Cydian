// The install queue's screens (N4), Cydia's flow (docs/cydia.md, "Install queue"):
//
//   1. A package page's Install / Modify sheet, its Version History or an F18 "Remove X" row queues a package
//      (getBackend().queue, backend-native.js); the Confirm sheet opens at once.
//   2. Confirm: apt-get -s over the whole queue (ifizbox-helper simulate). Its Modifications (Install, Reinstall,
//      Upgrade, Downgrade, Remove, one row each with the names), the queue itself (tap one to clear it), and
//      Continue Queuing. When apt refuses, the sheet is "Cannot Comply": F18's plain-language explanation of each
//      problem with its action (core/deps.js explainApt through the catalog) above apt's own output, which always
//      shows; never a silent failure (Zebra #2052). Cancel clears the queue; Confirm runs it.
//   3. The console ("Running", then "Complete"; F151: nav/progress.js): apt's and dpkg's lines streamed over the
//      bridge as they come, the status fd's steps in bold white, dpkg's own output in monospace, errors in red, a
//      progress bar, then the finish button (core/progress.js chooseFinish): Restart SpringBoard when a changed
//      package is a tweak, Reload Data (uicache) for an app, or what a script asked ($CYDIA's finish: words, up to
//      Reboot Device), else Close iFizBox. The run's output is
//      kept (queue.js runLogs) for Settings > Console Logs (logsPage below). A conffile changed by both the user and
//      the package opens Cydia's Configuration Upgrade alert (F63): Keep My Old Copy or Accept The New Copy, sent
//      back to dpkg through backend.answerConffile while the run waits. While apt is still downloading (no dpkg
//      status line yet) the bar has Cydia's Cancel (F64, backend.cancelApply): the run stops, nothing is installed
//      and the queue stays.
//
// While the queue holds packages: they are marked in every list (browse.js), the Installed tab's badge reads Q'd
// and its nav bar has a Queue button that reopens Confirm. Styles: queue.css.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el, barButton } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { openProgress, progressHUD } from "../nav/progress.js";
import { classify, chooseFinish } from "../core/progress.js";
import { format, settingsRoute } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog } from "../catalog.js";
import { installQueue, runLogs } from "../queue.js";
import { MODES, MODE_LABEL, changeCount, runTitle, createRepeatFilter, CONFFILE_TITLE,
  CONFFILE_BUTTONS, conffileMessage, conffileAnswer, conffileLine, debUrlOf, debLinkOf } from "../core/queue.js";
import { appQueue } from "../app-queue.js";
import { appPlan, runOrder, sizeText, SELF_ID, customParams, APP_MODES, APP_MODE_LABEL } from "../core/appqueue.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";

const EASE = "cubic-bezier(.25,.1,.25,1)";

let ctxRef = null;
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
      else if (!running && !e.quiet) openConfirm(); // F193: a row's swipe queues without the sheet
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

function openConfirm() {
  if (confirm || running) { confirm?.refresh(); return; }
  if (!installQueue.size) return;
  const cancel = barButton("Cancel");
  const ok = barButton("Confirm", "done");
  ok.hidden = true;
  const m = modal({ title: "Confirm", left: cancel, right: ok, cls: "confirm-sheet" });
  let generation = 0;
  let ready = null; // { jobs, plan, ids } once apt agreed
  const close = () => { confirm = null; updateChrome(); return m.close(); };
  cancel.addEventListener("click", () => { installQueue.clearAll(); close(); });
  ok.addEventListener("click", () => {
    if (!ready) return;
    const run = ready;
    close().then(() => runConsole(run));
  });

  async function refresh() {
    const gen = ++generation;
    ready = null;
    ok.hidden = true;
    if (!installQueue.size) { close(); return; }
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
        footer: `Nothing was changed. ${NAME} runs apt through its helper (ifizbox-helper); reinstalling ${NAME} puts it back.` }]));
    } else if (!r.ok || r.plan.essential.length) {
      m.setTitle("Cannot Comply");
      await drawIssues(m.scroll, r, names, () => close());
      if (gen !== generation) return;
    } else if (!changeCount(r.plan)) {
      m.scroll.append(grouped([{ header: "Modifications", rows: [{ label: "Nothing to change" }],
        footer: "apt says everything queued is already as asked." }]));
    } else {
      m.scroll.append(continueGroup(close), statistics(r.plan), withWaitNotes(modifications(r.plan, names), planIds(r.plan)));
      ready = { jobs, plan: r.plan, ids: planIds(r.plan) };
      ok.hidden = false;
    }
    // Cydia on the 4S (ref/4s/screens/queue-81.png, queue-83.png): Continue Queuing, Statistics, Modifications and no
    // list of the queue; a package comes out of it from its own page (Modify > Clear).
    if (r && (!r.ok || r.plan.essential.length)) m.scroll.append(rawOutput(r.output));
  }

  confirm = { refresh, close };
  updateChrome();
  refresh();
}

// ---- F189: work waiting on a queued package (an IPA install on AppSync Unified, screens/ipa-install.js) ---------
//
// whenQueueRuns(id, { note }) -> a promise for what became of the queued package `id`: "installed" (a queue run with
// it went through: its console closes at once, so what waits opens its own), "failed" (the run failed: once its
// console is closed), "cancelled" (cleared from the queue, Confirm's Cancel among them, or the run's Cancel). `note`
// is shown under Confirm's Modifications while it waits.
const waiting = new Map(); // id -> [{ id, note, resolve(outcome), off() }]

export function whenQueueRuns(id, { note = "", queue = installQueue } = {}) {
  return new Promise((resolve) => {
    const entry = { id, note, resolve };
    entry.off = queue.subscribe((e) => {
      if ((e.type === "clear" && e.id === id) || e.type === "clearAll") { detach(id, entry); resolve("cancelled"); }
    });
    waiting.set(id, [...(waiting.get(id) ?? []), entry]);
  });
}

function detach(id, entry) {
  entry.off();
  const list = (waiting.get(id) ?? []).filter((x) => x !== entry);
  if (list.length) waiting.set(id, list); else waiting.delete(id);
}

// The waiters on any of `ids`, taken out (so the run's own clearAll doesn't cancel them); each gets resolve(outcome).
export function takeWaiters(ids) {
  const out = [];
  for (const id of new Set(ids)) {
    for (const entry of [...(waiting.get(id) ?? [])]) { detach(id, entry); out.push(entry); }
  }
  return out;
}

// Confirm's Modifications group (`frag`) with the waiters' notes on `ids` as its footer.
function withWaitNotes(frag, ids) {
  const notes = [...new Set(ids.flatMap((id) => (waiting.get(id) ?? []).map((x) => x.note).filter(Boolean)))];
  if (notes.length) frag.querySelector(".group")?.append(el("p", "group-footer", notes.join("\n")));
  return frag;
}

// F131: each install job whose version's Filename is a full URL gets that link as `debUrl` (core/queue.js debUrlOf);
// the native backend downloads those itself, since apt would join the link to the repo's URL and 404. F133: with the
// stanza's hashes (debSha256, debMd5), which the shell checks the download against.
async function withDebUrls(jobs) {
  return Promise.all(jobs.map(async (j) => {
    if (j.op !== "install") return j;
    try {
      const link = debLinkOf(await catalog.history(j.id), j.version);
      return link ? { ...j, ...link } : j;
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
    ...r.plan.essential.map((id) => ({ sentence: `Removing ${names[id] || id} would take away part of the jailbreak itself (an essential package), so ${NAME} won't do it.` })),
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
// right installs it in turn (runAppQueue), each signed on the phone, iFizBox itself last.

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
  const close = () => { off(); if (appConfirm === sheet) appConfirm = null; return m.close(); };
  cancel.addEventListener("click", () => { close(); queue.clearAll(); });
  ok.addEventListener("click", () => {
    const jobs = queue.list();
    close().then(() => runAppQueue(jobs, { queue }));
  });
  function refresh() {
    const jobs = queue.list();
    if (!jobs.length) { close(); return; }
    const names = {};
    for (const j of jobs) {
      if (j.name) names[j.id] = j.name;
      for (const d of j.deps ?? []) if (d?.name) names[d.id] = d.name;
    }
    // As Cydia's (ref/4s/screens/queue-81.png): Continue Queuing first, then Statistics and Modifications.
    m.scroll.replaceChildren(continueGroup(close), statistics(appPlan(jobs)), modifications(appPlan(jobs), names, APP_MODES, APP_MODE_LABEL));
  }
  const sheet = { refresh, close };
  appConfirm = sheet;
  refresh();
}


// One app: signed on the phone in the sideload app (installOnDevice; iFizBox's own IPA through signAndInstall, which
// hosts it on the Signing Server). The website queues nothing (F89). True once iOS was asked.
async function installApp(job) {
  const sc = await import("../signing-client.js");
  if (job.mode === "resign") return resignApp(job, { sc });
  if (job.options && sc.localSigning()) return installCustom(job, { sc });
  if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "" });
  return sc.signAndInstall({ url: job.url, name: job.name || "" });
}

// F84: a Custom Install job: signing.install with its own options (core/appqueue.js customParams: the look's token
// while fresh, else the url, and the edits), then iOS's progress on the HUD as the sheet did (signing-sheet.js
// followInstall). The token is spent by the try, so a failed run that keeps the job queued downloads it again next time.
export async function installCustom(job, { sc, follow = null, now = Date.now(), native = globalThis.ifizboxNative } = {}) {
  const params = customParams(job, now);
  if (params.token) job.options.token = null;
  const after = follow ?? (async (result, h) => (await import("../signing-sheet.js")).followInstall(native, result?.bundleId || job.options.signsAs || "", h));
  return sc.installOnDevice({ url: job.url, name: job.options.name || job.name || "", params,
    after, ...(sc.isSelfIpa(job.url) ? { host: true } : {}) });
}

// F91: a "resign" job: signing.resign {bundleId} signs the app again from the phone's record (Re-sign All's path,
// one app) and opens iOS's install, the HUD following it; iFizBox's own is hosted on the Signing Server, as its
// install is (iOS closes iFizBox). True once iOS was asked.
export async function resignApp(job, { sc, native = globalThis.ifizboxNative, hud = null, alert = showAlert } = {}) {
  sc ??= await import("../signing-client.js");
  const { resignLabel, deviceError } = await import("../core/signing.js");
  const h = hud ? hud("Re-signing") : progressHUD("Re-signing"); // F151: the progress page
  const fail = (message) => (typeof h.fail === "function" ? h.fail(message) : h.hide());
  let r;
  try {
    if (!native?.call) throw new Error(`Re-signing needs the ${NAME} app.`);
    r = await native.call("signing.resign", { bundleId: job.id, manifestServer: sc.getServer(), ...(job.id === SELF_ID ? { host: true } : {}) },
      (ev) => { const t = resignLabel(ev); if (t) h.set(t.replace(/ \(1 of 1\)$/, "")); });
  } catch (e) {
    const why = deviceError(e, job.name || job.id);
    fail(why.message);
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message: why.message, buttons: ["OK"] });
    return false;
  }
  const failed = Array.isArray(r?.failed) ? r.failed : [];
  if (failed.length || !(r?.done ?? []).length) {
    const message = failed.map((f) => f.error || "failed").join("\n") || "Nothing was signed.";
    fail(message);
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message, buttons: ["OK"] });
    return false;
  }
  if (typeof h.done === "function") h.done("Done"); else h.hide();
  return true;
}

// F30/I3: the version Install put on the phone, so Installed and Changes follow it (iFizBox records itself).
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

// Confirm's run: each app in turn (runOrder: iFizBox last), each one out of the queue once iOS has it; the first
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
// F151: the page is nav/progress.js (steps bold, dpkg's output monospace, errors red with the x badge, auto-scroll),
// and its button follows what was done (core/progress.js chooseFinish): the scripts' finish: lines and the kinds of
// package changed (a tweak: Restart SpringBoard; an app: Reload Data).
async function runConsole({ jobs, ids, keepQueue = false, asks = true, title = null, run = (onEvent) => getBackend().apply(jobs, onEvent) }) {
  running = true;
  updateChrome();
  // F64: Cancel while apt only downloads (a queue run, apply-ask: the helper reads its stdin); gone once dpkg starts.
  const canCancel = asks && typeof getBackend().cancelApply === "function";
  let onCancel = () => {};
  const page = openProgress({ onCancel: () => onCancel() });
  page.cancellable(canCancel);

  const log = [];
  const fresh = createRepeatFilter(); // C6: apt's "Retrieving file 1 of N" shows once, not once per percent
  const line = (type, text) => {
    if (!fresh(type, text)) return;
    log.push(type === "info" ? text : type === "error" ? `E: ${text}`.replace(/^E: E: /, "E: ") : type === "warning" ? text : `» ${text}`);
    page.line(type === "status" ? "step" : type === "info" ? "raw" : type, text);
  };
  page.progress(0);

  const names = await namesFor(ids);
  const label = (pkg) => names[pkg] || pkg;
  const levels = [];
  let kinds = [];
  try {
    const info = await catalog.queueInfo(ids);
    kinds = Object.values(info ?? {}).map((v) => v?.kind ?? (v?.restart ? "tweak" : "package"));
  } catch { /* the scripts' own finish lines still count */ }

  let result = null, error = null, ended = false;
  let cancelled = false, dpkg = false;
  let cancelling = false;
  const dpkgStarted = () => { dpkg = true; page.cancellable(false); };
  onCancel = async () => {
    if (cancelling || dpkg || ended) return;
    cancelling = true;
    page.cancellable(true, { disabled: true });
    page.status("Cancelling");
    try {
      await getBackend().cancelApply();
      cancelled = true;
      page.cancellable(false);
    } catch (e) {
      if (ended) return;
      line("error", `Couldn't cancel: ${e.message || String(e)}`);
      if (dpkg) page.cancellable(false); else { page.cancellable(true); cancelling = false; }
    }
  };
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
      if (fd === "status" && !dpkg && /^pm(status|conffile|error):/.test(String(raw ?? ""))) dpkgStarted();
      const c = classify({ fd, line: raw });
      if (!c) return;
      switch (c.kind) {
        case "finish": levels.push(c.finish); return;
        case "conffile":
          if (c.percent != null) page.progress(c.percent);
          page.status(`Configuration file ${c.file}`);
          if (canAsk) ask(c.file);
          else line("status", conffileLine(c.file, "keep"));
          return;
        case "step": {
          const text = c.pkg ? c.text.replaceAll(c.pkg, label(c.pkg)) : c.text;
          if (c.percent != null && !c.download) page.progress(c.percent);
          page.status(text);
          line("status", text);
          return;
        }
        case "error": line("error", c.pkg ? `${label(c.pkg)}: ${c.text}` : c.text); return;
        case "warning": line("warning", c.text); return;
        default: line("info", c.text);
      }
    });
  } catch (e) {
    error = e;
  }
  ended = true;
  page.cancellable(false);

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

  const choice = chooseFinish({ ok, levels, kinds });
  runLogs.add({ title: title ? title(names) : runTitle(jobs.map((j) => ({ ...j, name: j.name || names[j.id] }))), jobs: jobs.map((j) => ({ op: j.op, id: j.id, version: j.version, mode: j.mode })),
    code: error ? -1 : result.code, finish: choice.level, text: log.join("\n") });
  // F189: what waited on a package of this run (whenQueueRuns), out before clearAll would cancel it.
  const waiters = keepQueue ? [] : takeWaiters(ids);
  // A run that went through empties the queue; one apt stopped keeps it, so Confirm can show what's left to fix.
  if (ok && !keepQueue) installQueue.clearAll();
  const reloaded = catalog.reloadInstalled?.().catch(() => {});

  page.onClose(() => { running = false; updateChrome(); });
  if (waiters.length) {
    const outcome = ok ? "installed" : stopped ? "cancelled" : "failed";
    page.onClose(() => { for (const w of waiters) w.resolve(outcome); });
    // It went through and held only what was waited on: straight on to what waited (the IPA's own console); this
    // run's output is in Console Logs. With other packages queued too, their finish button (a respring) comes first.
    const waited = new Set(waiters.map((w) => w.id));
    if (ok && jobs.every((j) => waited.has(j.id))) { await reloaded; page.close(); return { ok, reloaded }; }
  }
  page.finish({ label: choice.label, status: ok ? "Done" : stopped ? "Cancelled" : "Failed", action: () => finishAction(choice) });
  return { ok, reloaded };
}

// The finish button's action. -> true to keep the page up (the action failed and said so).
async function finishAction({ level, uicache }) {
  const b = getBackend();
  if (uicache || level === "uicache") {
    const hide = showHUD("Reloading Data");
    try {
      if (typeof b.uicache === "function") await b.uicache();
      await catalog.reloadInstalled?.();
    } catch (e) {
      hide();
      await showAlert({ title: "Reload Data", message: e.message || String(e), buttons: ["OK"] });
      return true;
    }
    hide();
  }
  if (level === "restart" || level === "reload") {
    const hide = showHUD("Loading");
    try {
      await b.respring();
    } catch (e) {
      hide();
      await showAlert({ title: "Restart SpringBoard", message: e.message || String(e), buttons: ["OK"] });
      return true;
    }
    hide();
    return false;
  }
  if (level === "reboot") {
    if (typeof b.userspaceReboot === "function") {
      const { index } = await showAlert({ title: "Reboot Device", message: "A package asked for a reboot to finish. A userspace reboot restarts iOS and keeps the jailbreak.",
        buttons: ["Later", "Reboot"], cancel: 0 });
      if (index !== 1) return false;
      try {
        await b.userspaceReboot();
      } catch (e) {
        await showAlert({ title: "Reboot Device", message: e.message || String(e), buttons: ["OK"] });
        return true;
      }
      return false;
    }
    await showAlert({ title: "Reboot Device", message: "A package asked for a reboot to finish. Restart the iPhone, then jailbreak it again with your jailbreak app if it needs that.", buttons: ["OK"] });
  }
  return false;
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
  return grouped([{ header: "Console", rows: [{ label: "Console Logs", detail: list.length ? String(list.length) : "None", href: format(settingsRoute([LOGS])), icon: rowIcon("logs") }],
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
