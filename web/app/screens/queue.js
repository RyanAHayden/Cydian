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
//      back to dpkg through backend.answerConffile while the run waits.
//
// While the queue holds packages: they are marked in every list (browse.js), the Installed tab's badge reads Q'd
// and its nav bar has a Queue button that reopens Confirm. Styles: queue.css.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog } from "../catalog.js";
import { installQueue, runLogs } from "../queue.js";
import { MODES, MODE_LABEL, changeCount, parseStatusLine, consoleText, finishOf, FINISH_LABEL, runTitle, CONFFILE_TITLE,
  CONFFILE_BUTTONS, conffileMessage, conffileAnswer, conffileLine } from "../core/queue.js";

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
    const jobs = installQueue.list();
    if (!jobs.length) { close(); return; }
    m.setTitle("Confirm");
    m.scroll.replaceChildren(loading("Checking with apt"));
    let r, err = null;
    try { r = await getBackend().simulate(jobs); } catch (e) { err = e; }
    if (gen !== generation) return; // the queue changed while apt was asked; a newer answer is coming
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
      m.scroll.append(statistics(r.plan), modifications(r.plan, names));
      ready = { jobs, plan: r.plan, ids: planIds(r.plan) };
      ok.hidden = false;
    }
    m.scroll.append(queueGroup(jobs, names), continueGroup(close));
    if (r && (!r.ok || r.plan.essential.length)) m.scroll.append(rawOutput(r.output));
  }

  confirm = { refresh, close };
  updateChrome();
  refresh();
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
function modifications(plan, names) {
  const rows = [];
  for (const mode of MODES) {
    const list = plan[`${mode}s`];
    if (!list.length) continue;
    rows.push({ label: MODE_LABEL[mode], detail: list.map((e) => names[e.id] || e.id).join("\n") });
  }
  const frag = grouped([{ header: "Modifications", rows }]);
  frag.querySelectorAll(".cell").forEach((c) => c.classList.add("confirm-mods"));
  return frag;
}

// The queue as the user asked it; tapping a package offers to take it out (the sheet asks apt again).
function queueGroup(jobs, names) {
  return grouped([{ header: "Queue", rows: jobs.map((j) => ({
    label: names[j.id] || j.name || j.id,
    detail: MODE_LABEL[j.mode] + (j.version && j.mode !== "remove" ? ` ${j.version}` : ""),
    onClick: async () => {
      const i = await showActionSheet({ title: names[j.id] || j.id, buttons: ["Clear"], destructive: 0 });
      if (i === 0) installQueue.clear(j.id);
    },
  })), footer: "Tap a package to take it out of the queue." }]);
}

function continueGroup(close) {
  return grouped([{ rows: [{ label: "Continue Queuing", onClick: () => close() }] }]);
}

// Cannot Comply: F18's sentences (and actions) first, then what Cydia would also call an issue: essentials.
async function drawIssues(box, r, names, close) {
  const frag = document.createDocumentFragment();
  let problems = [];
  if (!r.ok) {
    try { problems = (await catalog.aptProblems(r.output)) ?? []; } catch { problems = []; }
  }
  const sentences = [
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
  const m = modal({ title: "Running", right: close, cls: "console" });
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
  const line = (type, text) => {
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
  flush();

  const ok = result?.code === 0 && !error;
  if (error) line("error", error.message || String(error));
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
  statusText.textContent = ok ? "Done" : "Failed";

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
  return grouped([{ header: "Console", rows: [{ label: "Console Logs", detail: list.length ? String(list.length) : "None", href: format({ tab: "settings", path: [LOGS] }) }],
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
      href: format({ tab: "settings", path: [LOGS, e.id] }) })), footer: "The newest 20 runs." },
    { rows: [{ label: "Clear Logs", onClick: async () => {
      const i = await showActionSheet({ buttons: ["Clear Logs"], destructive: 0 });
      if (i === 0) { runLogs.clear(); redraw(); }
    } }] },
  ]);
}
