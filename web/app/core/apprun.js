// F235: the IPA queue's run (My IPAs installs, app pages, Changes' upgrades, Re-sign All) on F234's black page with
// rows. Pure JS, no DOM: the rows, the run, and the words the rows and the log show. The page is screens/apprun.js;
// the phone's calls are signing-client.js prepareOnDevice / openPrepared (native signing.prepare / signing.open).
//
//   appRows(jobs)              -> [row]  one row per queued app (core/appqueue.js jobs), in runOrder (iFizBox last)
//   row: { id, name, mode, job, size, state, phase, fraction, error, token, bundleId, expires, unsure, dismissed }
//   createAppRun({ rows, sign, install, discard, reprompt, ahead = 2, stallMs, later, clear, onChange, onLog })
//       sign(row, hooks)    -> { token, bundleId?, expires?, name? }  the download and the signing, ahead of the installs
//                              (hooks: { signal, progress(phase "downloading" | "signing", fraction 0..1) })
//       install(row, hooks) -> { installed: true | false | null, expires? }  hands the signed app to iOS and waits for
//                              its install (hooks: { signal, progress("asking" | "installing", fraction) }): "asking"
//                              while iOS's Install prompt is up, "installing" once iOS reports progress. null: iOS
//                              can't be asked whether it installed (the row ends as sent). handedOff: true (the
//                              shell's word that iOS had the whole IPA, or iFizBox was in the background) turns a
//                              false into "sent" too (B76, below). dismissed: true (B85: the user closed iOS's
//                              prompt) ends the row Cancelled ("Cancelled on the iOS prompt", retryable) and the
//                              next app goes on.
//       discard(row)        frees a signed copy that will never be installed (its row stopped, or the run cancelled)
//       reprompt(row)       -> true | false: B85, iOS's prompt for the app with iOS ("asking") again
//     .start() -> a promise for the end (every row installed, failed or cancelled)
//     .stop(id)   the working row's round stop button: aborts that app only (its download, signing or iOS's prompt);
//                 the next one goes on
//     .cancel()   the red Cancel: every app not finished is abandoned (in-flight ones aborted)
//     .retry(id) / .retryAll()   failed and cancelled rows go again (a new pass when the run had ended)
//     .away()     B76: iFizBox went to the background while a row was with iOS: that row is handed off to iOS
//     .confirm(id) B76: iOS has an app whose row ended "Sent to iOS" (apps.isInstalled on the way back): Installed
//     .reprompt(id) B85: the "Tap Install on the iOS prompt" row's tap: reprompt(row), logged -> a promise for true | false
//     .rows / .running / .stopping / .current (the row with iOS)
//
// B76: a stock phone can't watch iOS's install once iFizBox is in the background, so installed: false after a handoff
// (handedOff, or .away() during the watch) means "lost sight", not "refused": the row ends Done as sent (unsure) and
// leaves the queue. Failed stays for a refusal seen while iFizBox stayed in front (iOS never fetched the IPA).
//   rowStatus(row, { locale, timeZone }) -> the row's grey line ("Downloading 12.0 of 48.0 MB", "Tap Install on the
//                              iOS prompt", "Re-signed, expires Dec 3, 2026")
//   summaryLine(rows)          -> "2 installed, 1 re-signed, 1 failed, 1 cancelled"
//   runStatus(rows) / runPercent(rows)   the bottom status and bar
//
// Two lanes. Signing: `ahead` apps at a time in the run's order are downloaded and signed. Installing: one app at a
// time, strictly in order: the first row that hasn't ended is handed to iOS once it is signed, and the next waits for
// iOS to finish it (or for it to fail or be stopped). iFizBox's own IPA is last (runOrder), so iOS closing iFizBox to
// install it can't cut the others off. A download or signing phase that sends no progress for `stallMs` fails its row
// ("stopped at Signing 50%"), and that app's job is aborted, so the queue moves on. The log gets one line per phase per
// app (Downloading Delta 48 MB, Signed Delta, Asked iOS to install Delta, Installed Delta / the reason it failed);
// percents only move the row's bar and the bottom status.
// SPDX-License-Identifier: GPL-3.0-or-later
import { runOrder, sizeText, SELF_ID } from "./appqueue.js";

export const APP_STATES = ["waiting", "downloading", "signing", "signed", "asking", "installing", "installed", "failed", "cancelled"];
const ENDED = new Set(["installed", "failed", "cancelled"]);
export const ended = (row) => ENDED.has(row?.state);
const SIGNING = new Set(["downloading", "signing"]);
const WITH_IOS = new Set(["asking", "installing"]);
// B65's limit for a phase that goes quiet (core/signing.js STALL_LIMIT), kept here so this module stays pure.
export const APP_STALL = 180_000;

const PHASE_WORD = { downloading: "Downloading", signing: "Signing", asking: "Asking iOS", installing: "Installing" };

export function appRows(jobs = []) {
  return runOrder(jobs).map((j) => ({
    id: j.id, name: j.name || j.id, mode: j.mode || "install", job: j, size: Number(j.size) > 0 ? Number(j.size) : null,
    state: "waiting", phase: null, fraction: 0, error: null, token: null, bundleId: null, expires: null, unsure: false,
    dismissed: false,
  }));
}

const label = (r) => r.name || r.id;
const pct = (f) => Math.round((Number(f) || 0) * 100);

// "Stopped at Signing 50%: nothing moved for 3 minutes." (B65's words, for one row)
export function stallText(row, limit = APP_STALL) {
  const mins = Math.round(limit / 60_000);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.round(limit / 1000)} seconds`;
  const p = pct(row?.fraction);
  const where = `${PHASE_WORD[row?.phase] ?? "the start"}${p > 0 && p < 100 ? ` ${p}%` : ""}`;
  return `stopped at ${where}: nothing moved for ${span}`;
}

export function createAppRun({ rows, sign, install, discard = () => {}, reprompt = null, ahead = 2, stallMs = APP_STALL,
  later = setTimeout, clear = clearTimeout, onChange = () => {}, onLog = () => {} }) {
  const flights = new Map(); // id -> { ctl: AbortController, timer, why }
  let running = false;
  let stopping = false;
  let resolveEnd = null;
  let endPromise = null;

  const changed = (r) => { try { onChange(r); } catch { /* the page's bug isn't the run's */ } };
  const log = (r, kind, text) => { try { onLog({ id: r?.id ?? null, kind, text }); } catch { /* as above */ } };

  const set = (r, patch) => { Object.assign(r, patch); changed(r); };

  const finishRow = (r, state, patch = {}) => {
    const f = flights.get(r.id);
    if (f) { if (f.timer != null) clear(f.timer); flights.delete(r.id); }
    set(r, { state, ...patch });
  };

  // One phase's progress: a new phase gets its log line once; a percent only moves the bar.
  const progressOf = (r, f) => (phase, fraction = 0) => {
    if (f.ctl.signal.aborted || ended(r)) return;
    const first = r.phase !== phase;
    if (first && helperRow(r)) { // B71a: the jailbreak app's helper: one step per app, no signing, no iOS prompt
      if (phase === "installing") log(r, "step", `${r.mode === "remove" ? "Removing" : "Installing"} ${label(r)}`);
    } else if (first) {
      if (phase === "downloading") log(r, "step", `Downloading ${label(r)}${r.size ? ` ${sizeText(r.size)}` : ""}`);
      else if (phase === "signing") log(r, "step", `Signing ${label(r)}`);
      else if (phase === "asking") log(r, "step", `Asked iOS to install ${label(r)}`);
      else if (phase === "installing") log(r, "step", `iOS is installing ${label(r)}`);
    }
    const state = SIGNING.has(phase) || WITH_IOS.has(phase) ? phase : r.state;
    set(r, { phase, state, fraction: Math.max(0, Math.min(1, Number(fraction) || 0)) });
    if (SIGNING.has(phase)) arm(r, f);
  };

  // B65: a download or signing phase that goes quiet fails its row (and aborts its job); iOS's prompt waits for the user.
  const arm = (r, f) => {
    if (f.timer != null) clear(f.timer);
    f.timer = later(() => {
      f.timer = null;
      if (f.ctl.signal.aborted || ended(r)) return;
      f.why = "stalled";
      f.ctl.abort();
      fail(r, stallText(r, stallMs));
    }, stallMs);
  };

  const fail = (r, why) => {
    if (ended(r)) return;
    const text = String(why || "failed");
    finishRow(r, "failed", { error: text });
    log(r, "error", `${label(r)}: ${text}`);
    pump();
  };

  const cancelRow = (r) => {
    if (ended(r)) return;
    const f = flights.get(r.id);
    if (f) { f.why = "cancelled"; f.ctl.abort(); }
    if (r.state === "signed" && r.token) { try { discard(r); } catch { /* the token runs out on its own */ } }
    finishRow(r, "cancelled", { token: null });
    log(r, "step", `Cancelled ${label(r)}`);
  };

  const fly = (r) => {
    const f = { ctl: new AbortController(), timer: null, why: null };
    flights.set(r.id, f);
    return f;
  };

  async function startSign(r) {
    const f = fly(r);
    set(r, { state: "downloading", phase: null, fraction: 0, error: null });
    arm(r, f);
    let res;
    try {
      res = await sign(r, { signal: f.ctl.signal, progress: progressOf(r, f) });
    } catch (e) {
      if (f.why || ended(r)) return; // stopped, cancelled or timed out: its row says so already
      fail(r, e?.message || String(e));
      return;
    }
    if (f.why || ended(r)) { if (res?.token) { try { discard({ ...r, token: res.token }); } catch { /* runs out */ } } return; }
    if (f.timer != null) clear(f.timer);
    flights.delete(r.id);
    if (!res?.token) { fail(r, "nothing was signed"); return; }
    set(r, { state: "signed", phase: null, fraction: 1, token: res.token, bundleId: res.bundleId ?? r.bundleId,
      expires: res.expires ?? r.expires, name: r.job?.name ? r.name : res.name || r.name });
    if (!helperRow(r)) log(r, "step", `Signed ${label(r)}`);
    pump();
  }

  async function startInstall(r) {
    const f = fly(r);
    set(r, { state: "asking", phase: null, fraction: 0 });
    let res;
    try {
      res = await install(r, { signal: f.ctl.signal, progress: progressOf(r, f) });
    } catch (e) {
      if (f.why || ended(r)) return;
      fail(r, e?.message || String(e));
      return;
    }
    if (f.why || ended(r)) return;
    if (res?.dismissed && res?.installed !== true) {
      // B85: the user closed iOS's prompt: that app is cancelled (retryable), and the next one goes on
      finishRow(r, "cancelled", { token: null, dismissed: true, phase: null, fraction: 0 });
      log(r, "step", `Cancelled ${label(r)} on the iOS prompt`);
      pump();
      return;
    }
    const expires = res?.expires ?? r.expires;
    const handedOff = Boolean(res?.handedOff || f.away);
    if (res?.installed === false && !handedOff) { fail(r, "iOS didn't install it"); return; }
    const unsure = res?.installed !== true;
    finishRow(r, "installed", { token: null, expires, unsure, phase: null, fraction: 1 });
    if (r.mode === "resign") log(r, "step", `Re-signed ${label(r)}${expires ? `, expires ${dateText(expires)}` : ""}`);
    else if (r.mode === "remove") log(r, "step", `Removed ${label(r)}`);
    else log(r, "step", unsure ? `Sent ${label(r)} to iOS` : `Installed ${label(r)}`);
    pump();
  }

  function pump() {
    if (!running) return;
    if (!stopping) {
      // the signing lane: `ahead` at a time, in order
      let busy = rows.filter((r) => SIGNING.has(r.state)).length;
      for (const r of rows) {
        if (busy >= ahead) break;
        if (r.state === "waiting") { busy++; startSign(r); }
      }
      // the install lane: the first row that hasn't ended, once signed; nothing while one is with iOS
      if (!rows.some((r) => WITH_IOS.has(r.state))) {
        const next = rows.find((r) => !ended(r));
        if (next?.state === "signed") startInstall(next);
      }
    }
    if (rows.every(ended) && !flights.size) {
      running = false;
      stopping = false;
      const done = resolveEnd;
      resolveEnd = null;
      endPromise = null;
      done?.();
    }
  }

  function start() {
    if (running) return endPromise;
    running = true;
    stopping = false;
    endPromise = new Promise((res) => { resolveEnd = res; });
    const p = endPromise;
    // a microtask later, so the caller can draw the rows first
    Promise.resolve().then(pump);
    return p;
  }

  return {
    rows,
    get running() { return running; },
    get stopping() { return stopping; },
    get current() { return rows.find((r) => WITH_IOS.has(r.state)) ?? null; },
    start,
    away() {
      let n = 0;
      for (const r of rows) {
        const f = WITH_IOS.has(r.state) ? flights.get(r.id) : null;
        if (f) { f.away = true; n++; }
      }
      return n > 0;
    },
    confirm(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "installed" || !r.unsure) return false;
      set(r, { unsure: false });
      if (r.mode !== "resign") log(r, "step", `Installed ${label(r)}`);
      return true;
    },
    async reprompt(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "asking" || !reprompt || !flights.has(r.id)) return false;
      let ok = false;
      try { ok = Boolean(await reprompt(r)); } catch { ok = false; }
      if (r.state !== "asking") return false;
      log(r, "step", ok ? `Asked iOS again to install ${label(r)}` : `iOS's prompt for ${label(r)} can't be shown again`);
      return ok;
    },
    stop(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || ended(r)) return false;
      cancelRow(r);
      pump();
      return true;
    },
    cancel() {
      if (!running || stopping) return false;
      stopping = true;
      for (const r of rows) cancelRow(r);
      pump();
      return true;
    },
    retry(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || !["failed", "cancelled"].includes(r.state)) return null;
      set(r, { state: "waiting", phase: null, fraction: 0, error: null, token: null, unsure: false, dismissed: false });
      if (running) { pump(); return endPromise; }
      return start();
    },
    retryAll() {
      const again = rows.filter((r) => ["failed", "cancelled"].includes(r.state));
      if (!again.length) return null;
      for (const r of again) set(r, { state: "waiting", phase: null, fraction: 0, error: null, token: null, unsure: false, dismissed: false });
      if (running) { pump(); return endPromise; }
      return start();
    },
  };
}

// ---- words ----------------------------------------------------------------------------------------------------

export function dateText(iso, { locale = undefined, timeZone = undefined } = {}) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(locale ?? "en-US", { year: "numeric", month: "short", day: "numeric", timeZone });
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);

// B71a: a row of the jailbreak app's run (job.helper: the helper installs the IPA or uninstalls the app, no signing).
export const helperRow = (row) => Boolean(row?.job?.helper);
function helperStatus(row) {
  const p = pct(row.fraction);
  const verb = row.mode === "remove" ? "Removing" : "Installing";
  switch (row.state) {
    case "waiting": case "signed": return "Waiting";
    case "downloading": case "signing": return "Checking";
    case "asking": return verb;
    case "installing": return p > 0 && p < 100 ? `${verb} ${p}%` : verb;
    case "installed": return row.mode === "remove" ? "Removed" : "Installed";
    default: return null;
  }
}

export function rowStatus(row, opts = {}) {
  const p = pct(row.fraction);
  if (helperRow(row)) { const h = helperStatus(row); if (h != null) return h; }
  switch (row.state) {
    case "waiting": return "Waiting";
    case "downloading":
      if (row.size && row.fraction > 0) return `Downloading ${mb(row.size * row.fraction)} of ${mb(row.size)} MB`;
      return p > 0 ? `Downloading ${p}%` : "Downloading";
    case "signing": return p > 0 && p < 100 ? `Signing ${p}%` : "Signing";
    case "signed": return "Signed";
    case "asking": return "Tap Install on the iOS prompt";
    case "installing": return p > 0 && p < 100 ? `Installing ${p}%` : "Installing";
    case "installed":
      if (row.mode === "resign") return row.expires ? `Re-signed, expires ${dateText(row.expires, opts)}` : "Re-signed";
      return row.unsure ? "Sent to iOS" : "Installed";
    case "failed": return row.error ? `Failed: ${row.error}` : "Failed";
    case "cancelled": return row.dismissed ? "Cancelled on the iOS prompt" : "Cancelled";
    default: return "";
  }
}

export function summaryLine(rows) {
  const n = (f) => rows.filter(f).length;
  const parts = [
    [n((r) => r.state === "installed" && r.mode !== "resign" && r.mode !== "remove"), "installed"],
    [n((r) => r.state === "installed" && r.mode === "remove"), "removed"],
    [n((r) => r.state === "installed" && r.mode === "resign"), "re-signed"],
    [n((r) => r.state === "failed"), "failed"],
    [n((r) => r.state === "cancelled"), "cancelled"],
  ].filter(([c]) => c);
  return parts.length ? parts.map(([c, w]) => `${c} ${w}`).join(", ") : "Nothing to do";
}

export function runStatus(rows) {
  const pos = (r) => `${rows.indexOf(r) + 1} of ${rows.length}`;
  const ios = rows.find((r) => WITH_IOS.has(r.state));
  if (ios && helperRow(ios)) return `${ios.mode === "remove" ? "Removing" : "Installing"} ${label(ios)} (${pos(ios)})`;
  if (ios) return ios.state === "asking" ? `Tap Install for ${label(ios)} (${pos(ios)})` : `Installing ${label(ios)} (${pos(ios)})`;
  const s = rows.filter((r) => SIGNING.has(r.state));
  if (s.length && s.every(helperRow)) return "Preparing";
  if (s.length === 1) return `${s[0].state === "signing" ? "Signing" : "Downloading"} ${label(s[0])} (${pos(s[0])})`;
  if (s.length) return `Signing ${s.length} apps`;
  return "Preparing";
}

// Each row counts 1 once ended: half for its download and signing, half for iOS's install.
export function runPercent(rows) {
  if (!rows.length) return 100;
  let n = 0;
  for (const r of rows) {
    if (ended(r)) n += 1;
    else if (r.state === "downloading") n += 0.25 * (r.fraction || 0);
    else if (r.state === "signing") n += 0.25 + 0.25 * (r.fraction || 0);
    else if (r.state === "signed" || r.state === "asking") n += 0.5;
    else if (r.state === "installing") n += 0.5 + 0.5 * (r.fraction || 0);
  }
  return Math.round((n / rows.length) * 100);
}

export const isSelf = (row) => row?.id === SELF_ID;
