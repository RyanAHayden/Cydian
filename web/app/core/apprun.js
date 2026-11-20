// F235: the IPA queue's run (My IPAs installs, app pages, Changes' upgrades, Re-sign All) on F234's black page with
// rows. Pure JS, no DOM: the rows, the run, and the words the rows and the log show. The page is screens/apprun.js;
// the phone's calls are signing-client.js prepareOnDevice / openPrepared (native signing.prepare / signing.open).
//
//   appRows(jobs)              -> [row]  one row per queued app (core/appqueue.js jobs), in runOrder (iFizBox last)
//   row: { id, name, mode, job, size, state, phase, fraction, error, token, bundleId, expires, unsure, dismissed, again }
//   createAppRun({ rows, sign, install, discard, reprompt, ahead = 2, stallMs, later, clear, onChange, onLog })
//       sign(row, hooks)    -> { token, bundleId?, expires?, name? }  the download and the signing, ahead of the installs
//                              (hooks: { signal, progress(phase "downloading" | "signing", fraction 0..1) })
//       install(row, hooks) -> { installed: true | false | null, expires? }  hands the signed app to iOS and waits for
//                              its install (hooks: { signal, progress("asking" | "installing", fraction) }): "asking"
//                              while iOS's Install prompt is up, "installing" once iOS reports progress. null: iOS
//                              can't be asked whether it installed (the row ends as sent). B111, This iPhone: no
//                              prompt; progress("copying", f) then ("installing", installd's f), the row's `here`
//                              turns true and its words say Copying to iPhone / Installing. handedOff: true (the
//                              shell's word that iOS had the whole IPA, or iFizBox was in the background) turns a
//                              false into "sent" too (B76, below). dismissed: true (B85: iOS's prompt closed and
//                              iOS never asked for the IPA) ends the row Failed ("Failed: iOS didn't download it":
//                              B91, the user's Cancel and a frozen server look the same) and the next app goes on.
//                              hooks.again (B91): that row's Try Again: no new signing; the shell's IPA (still
//                              served) is offered again (signing.reprompt), and the call throws code "gone" when it
//                              isn't served any more (the row then signs again from the start)
//       discard(row)        frees a signed copy that will never be installed (its row stopped, or the run cancelled)
//       reprompt(row)       -> true | false: B85, iOS's prompt for the app with iOS ("asking") again
//       local(row)          -> true when the row's install goes the This iPhone route (B137: its row and the bottom
//                              status say Installing, never Tap Install, until iOS's prompt really shows: promptUp)
//     .start() -> a promise for the end (every row installed, failed or cancelled)
//     .stop(id)   the working row's round stop button: aborts that app only (its download, signing or iOS's prompt);
//                 the next one goes on
//     .cancel()   the red Cancel: every app not finished is abandoned (in-flight ones aborted)
//     .retry(id) / .retryAll()   failed and cancelled rows go again (a new pass when the run had ended); B91: a row
//                 iOS didn't download (dismissed) goes back to iOS's prompt without signing again (hooks.again)
//     .away()     B76: iFizBox went to the background while a row was with iOS: that row is handed off to iOS
//     .confirm(id) B76: iOS has an app whose row ended "Sent to iOS" (apps.isInstalled on the way back): Installed
//     .reprompt(id) B85: the "Tap Install on the iOS prompt" row's tap: reprompt(row), logged -> a promise for true | false
//     .notTaken(id, why) B123: an ended run's "Sent to iOS" row that iOS never took turns Failed (why) -> true | false
//     .ownIdRetry(id) B151: a row the App Store's install coordinator blocked (IX Code 46: row.busy, coordinatorBusy)
//                 goes again with Keep Bundle IDs off for that app (its own bundle ID) -> the end promise | null
//     .rows / .running / .stopping / .current (the row with iOS)
//
// B76: a stock phone can't watch iOS's install once iFizBox is in the background, so installed: false after a handoff
// (handedOff, or .away() during the watch) means "lost sight", not "refused": the row ends Done as sent (unsure) and
// leaves the queue. Failed stays for a refusal seen while iFizBox stayed in front (iOS never fetched the IPA).
//   rowStatus(row, { locale, timeZone }) -> the row's grey line ("Downloading 12.0 of 48.0 MB", "Tap Install on the
//                              iOS prompt", "Re-signed, expires Dec 3, 2026")
//   summaryLine(rows)          -> "2 installed, 1 re-signed, 1 failed, 1 cancelled"
//   runStatus(rows) / runPercent(rows)   the bottom status and bar
//   helperRow(row)             B71a: a jailbreak app run's row (job.helper: the root helper installs the IPA or, mode
//                              "remove", uninstalls the app): Waiting, Checking, Installing 40% / Removing, Installed /
//                              Removed; "N removed" in the summary; no Signed line in the log
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
import { VPN_WAIT } from "./installroute.js";
import { NAME } from "../brand.js";

// B136: an install that failed must not leave the app recorded as installed (Installed's record decides the Search
// row's swipe: a recorded, up-to-date app has none). recordWhen(row, onPhone) says when a row's app goes into that
// record: "now" for an install iOS confirmed (and for rows iOS can't be asked about: re-signs, removes, iFizBox
// itself, rows with no bundle ID, and an `onPhone` of null: apps.isInstalled had no answer); "wait" for a "Sent to
// iOS" row iOS hasn't confirmed (onPhone undefined: not asked yet, or false: iOS doesn't have it, which is how an
// install looks that iOS never fetched, B128's ECONNREFUSED); "never" for a row that didn't end installed.
export function recordWhen(row, onPhone) {
  if (row?.state !== "installed") return "never";
  if (!row.unsure || row.mode === "resign" || row.mode === "remove" || !row.bundleId || isSelf(row)) return "now";
  if (onPhone === true || onPhone === null) return "now";
  return "wait";
}

export const APP_STATES = ["waiting","downloading", "signing", "signed", "asking", "installing", "installed", "failed", "cancelled"];
const ENDED = new Set(["installed", "failed", "cancelled"]);
export const ended = (row) => ENDED.has(row?.state);
const SIGNING = new Set(["downloading", "signing"]);
const WITH_IOS = new Set(["asking", "installing"]);
// B65's limit for a phase that goes quiet (core/signing.js STALL_LIMIT), kept here so this module stays pure.
export const APP_STALL = 180_000;

const PHASE_WORD = { downloading: "Downloading", signing: "Signing", asking: "Asking iOS", installing: "Installing",
  copying: "Copying to iPhone" };

export function appRows(jobs = []) {
  return runOrder(jobs).map((j) => ({
    id: j.id, name: j.name || j.id, mode: j.mode || "install", job: j, size: Number(j.size) > 0 ? Number(j.size) : null,
    state: "waiting", phase: null, fraction: 0, error: null, token: null, bundleId: null, expires: null, unsure: false,
    dismissed: false, again: false, here: false, local: false, busy: false,
  }));
}

// B111: the This iPhone route (installd over LocalDevVPN): no iOS prompt. install's progress goes "copying" (the IPA's
// bytes to iOS) then "installing" (installd's percent), and the row's `here` says it took that route.
export const SELF_RESTART = `${NAME} will restart`;
export const copyingText = (row) => `Copying ${label(row)} to this iPhone`;

// B91: a row whose iOS prompt closed without iOS asking for the IPA: the user's Cancel or a frozen server, iFizBox
// can't tell which, so it doesn't say Cancelled.
export const DIDNT_DOWNLOAD = "iOS didn't download it";

// B139: only the user's Cancel or a row's stop marks an app Cancelled (cancelRow). A call that answers "cancelled"
// when neither was tapped (the shell's job for it was stopped from elsewhere) fails the row with these words instead,
// and the next app goes on.
export const NOT_YOU = "stopped before it finished (not by Cancel)";
const errorText = (e) => (e?.code === "cancelled" || /^cancel+ed$/i.test(String(e?.message ?? "").trim())
  ? NOT_YOU : e?.message || String(e));

// B151: installd refuses an app whose bundle ID has an install coordinator someone else holds: "IXErrorDomain
// Code=46 A coordinated app install already exists for <id> (creator App Store) but request by
// mobile_installation_proxy had scope requirement ...". The App Store's (a download, update or placeholder that never
// finished) outlives deleting the app and restarting the iPhone, and nothing installation_proxy or lockdown offers
// lists or cancels it. A different bundle ID has no coordinator, so the row offers that (ownIdRetry): its tap
// signs and installs the app again with Keep Bundle IDs off for this app only.
export const coordinatorBusy = (text) => {
  const s = String(text ?? "");
  return /coordinated app install already exists/i.test(s) || /IXErrorDomain\b[\s\S]{0,40}\bCode[ =]*46\b/i.test(s);
};
export const BUSY_ROW = "the App Store holds this app's install. Tap to install it with its own bundle ID";
export const BUSY_ROW_KEPT = "the App Store holds this app's install. Cancel its download, then Retry";
// The coordinator's bundle ID, as installd names it ("... already exists for com.atebits.Tweetie2 (creator ...").
export function busyBundleId(text) {
  const m = /already exists for ([A-Za-z0-9.-]+)/.exec(String(text ?? ""));
  return m ? m[1] : null;
}
// The Log's line under the app: what happened and both ways out.
export function busyText(row, raw = "", { own = true } = {}) {
  const id = busyBundleId(raw) || row?.bundleId || row?.id || "";
  return `the App Store holds an install of ${id || "this app"} (a download or update that never finished), so iOS ` +
    "won't take another app with that bundle ID; deleting the app or restarting the iPhone doesn't clear it. " +
    (own ? "Tap the app's row to install it with its own bundle ID (Keep Bundle IDs off for this app), or cancel"
      : "Cancel") + " the App Store's download (long-press its icon on the Home Screen, or in the App Store), then Retry.";
}
// Whether a row can go again under its own bundle ID: an install with an IPA (a link or My IPAs), not iFizBox
// itself, not the jailbreak app's helper, not a re-sign of a recorded app, and not already off.
export function ownIdOk(row) {
  const j = row?.job;
  if (!j || isSelf(row) || helperRow(row) || row.mode === "remove") return false;
  if (!j.url && !j.library) return false;
  return j.options?.edits?.keepBundleId !== false;
}
// The job with Keep Bundle IDs off for this app (signing-client.js prepareParams sends edits.keepBundleId).
export function ownIdJob(job) {
  const options = job?.options ?? {};
  return { ...job, options: { ...options, edits: { ...(options.edits ?? {}), keepBundleId: false } } };
}

const label = (r) => r.name || r.id;
const pct =(f) => Math.round((Number(f) || 0) * 100);

// "Stopped at Signing 50%: nothing moved for 3 minutes." (B65's words, for one row)
export function stallText(row, limit = APP_STALL) {
  const mins = Math.round(limit / 60_000);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.round(limit / 1000)} seconds`;
  const p = pct(row?.fraction);
  const where = `${PHASE_WORD[row?.phase] ?? "the start"}${p > 0 && p < 100 ? ` ${p}%` : ""}`;
  return `stopped at ${where}: nothing moved for ${span}`;
}

export function createAppRun({ rows, sign, install, discard = () => {}, reprompt = null, ahead = 2, stallMs = APP_STALL,
  later = setTimeout, clear = clearTimeout, onChange = () => {}, onLog = () => {}, local = () => false }) {
  const flights = new Map(); // id -> { ctl: AbortController, timer, why }
  let running = false;
  let stopping = false;
  let resolveEnd = null;
  let endPromise = null;

  const changed = (r) => { try { onChange(r); } catch { /* the page's bug isn't the run's */ } };
  const log = (r, kind, text) => { try { onLog({ id: r?.id ?? null, kind, text }); } catch { /* as above */ } };

  const set = (r, patch) => { Object.assign(r, patch); changed(r); };
  // B137: the row's install starts on the This iPhone route (Settings > Installation): no iOS prompt to tap
  const localRoute = (r) => { try { return Boolean(local(r)); } catch { return false; } };

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
      else if (phase === "copying") log(r, "step", copyingText(r)); // B111: This iPhone
      else if (phase === "installing" && r.here) {
        log(r, "step", `Installing ${label(r)}`);
        if (isSelf(r)) log(r, "step", SELF_RESTART); // installd ends iFizBox once it has installed the new one
      } else if (phase === "installing") log(r, "step", `iOS is installing ${label(r)}`);
      else if (phase === "vpn") log(r, "step", VPN_WAIT); // B110: Open LocalDevVPN: the row waits for it
    }
    const here = r.here || phase === "copying";
    const state = phase === "copying" ? "installing" : SIGNING.has(phase) || WITH_IOS.has(phase) ? phase : r.state;
    set(r, { phase, state, here, fraction: Math.max(0, Math.min(1, Number(fraction) || 0)) });
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
    if (coordinatorBusy(text)) { // B151: our words, never installd's dump, as the row's line
      const own = ownIdOk(r);
      finishRow(r, "failed", { error: own ? BUSY_ROW : BUSY_ROW_KEPT, busy: own });
      log(r, "error", `${label(r)}: ${busyText(r, text, { own })}`);
      pump();
      return;
    }
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
      fail(r, errorText(e));
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
    const again = Boolean(r.again);
    set(r, { state: "asking", phase: null, fraction: 0, again: false, here: false, local: localRoute(r) });
    let res;
    try {
      res = await install(r, { signal: f.ctl.signal, progress: progressOf(r, f), ...(again ? { again: true } : {}) });
    } catch (e) {
      if (f.why || ended(r)) return;
      if (again && e?.code === "gone") {
        // B91: the shell no longer serves that IPA: the row signs it again from the start
        finishRow(r, "waiting", { token: null, dismissed: false, phase: null, fraction: 0 });
        log(r, "step", `${label(r)} is no longer with iOS; signing it again`);
        pump();
        return;
      }
      fail(r, errorText(e));
      return;
    }
    if (f.why || ended(r)) return;
    if (res?.dismissed && res?.installed !== true) {
      // B85: iOS's prompt closed and iOS never asked for the IPA. B91: Cancel and a frozen server look the same, so
      // not "Cancelled": Failed, and its Try Again offers the same IPA again. The next app goes on.
      finishRow(r, "failed", { token: null, dismissed: true, error: DIDNT_DOWNLOAD, phase: null, fraction: 0 });
      log(r, "error", `${label(r)}: ${DIDNT_DOWNLOAD}`);
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

  // A failed or cancelled row going again: from the start, or (B91) a row iOS didn't download straight back to iOS's
  // prompt with the IPA the shell still serves ("signed" with `again`: the install lane offers it in turn).
  const retryPatch = (r) => {
    const back = r.state === "failed" && r.dismissed && Boolean(reprompt) && Boolean(r.bundleId) && !helperRow(r);
    return { state: back ? "signed" : "waiting", again: back, phase: null, fraction: back ? 1 : 0, error: null,
      token: null, unsure: false, dismissed: false, busy: false };
  };

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
      if (!r || r.state !== "asking" || !reprompt || !flights.has(r.id) || !promptUp(r)) return false;
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
      set(r, retryPatch(r));
      if (running) { pump(); return endPromise; }
      return start();
    },
    // B123: iFizBox's own row was sent to iOS but iOS never took it (signing.selfUpdate notStarted / stalled): the
    // ended run's row turns Failed with `why`, so its tap and Retry All sign and send it again
    notTaken(id, why) {
      const r = rows.find((x) => x.id === id);
      if (!r || running || r.state !== "installed" || !r.unsure) return false;
      set(r, { state: "failed", unsure: false, dismissed: false, error: why, phase: null, fraction: 0 });
      log(r, "error", `${label(r)}: ${why}`);
      return true;
    },
    // B151: a row the App Store's install coordinator blocked (row.busy): signed and installed again from the start
    // with Keep Bundle IDs off for this app only, so it gets its own bundle ID -> the run's end promise | null
    ownIdRetry(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "failed" || !ownIdOk(r)) return null;
      r.job = ownIdJob(r.job);
      set(r, { ...retryPatch(r), state: "waiting", again: false, fraction: 0, bundleId: null });
      log(r, "step", `Installing ${label(r)} with its own bundle ID`);
      if (running) { pump(); return endPromise; }
      return start();
    },
    retryAll() {
      const again = rows.filter((r) => ["failed", "cancelled"].includes(r.state));
      if (!again.length) return null;
      for (const r of again) set(r, retryPatch(r));
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
    case "asking":
      if (row.phase === "vpn") return VPN_WAIT;
      return promptUp(row) ? "Tap Install on the iOS prompt" : "Installing"; // B137: This iPhone has no prompt
    case "installing":
      if (row.phase === "copying") return p > 0 && p < 100 ? `Copying to iPhone ${p}%` : "Copying to iPhone";
      if (row.here && isSelf(row) && p >= 100) return SELF_RESTART;
      return p > 0 && p < 100 ? `Installing ${p}%` : "Installing";
    case "installed":
      if (row.mode === "resign") return row.expires ? `Re-signed, expires ${dateText(row.expires, opts)}` : "Re-signed";
      return row.unsure ? "Sent to iOS" : "Installed";
    case "failed": return row.error ? `Failed: ${row.error}` : "Failed";
    case "cancelled": return "Cancelled";
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
  if (ios?.phase === "vpn") return VPN_WAIT;
  if (ios?.phase === "copying") return `Copying ${label(ios)} to iPhone (${pos(ios)})`; // B111: This iPhone
  if (ios?.here && isSelf(ios)) return `Installing ${label(ios)}: ${SELF_RESTART}`;
  if (ios) return ios.state === "asking" && promptUp(ios) ? `Tap Install for ${label(ios)} (${pos(ios)})` : `Installing ${label(ios)} (${pos(ios)})`;
  const s = rows.filter((r) => SIGNING.has(r.state));
  if (s.length && s.every(helperRow)) return "Preparing";
  if (s.length === 1) return `${s[0].state === "signing" ? "Signing" : "Downloading"} ${label(s[0])} (${pos(s[0])})`;
  if (s.length) return `Signing ${s.length} apps`;
  return "Preparing";
}

// Each row counts 1 once ended: half for its download and signing, half for iOS's install. B111: on This iPhone that
// half is the copy (a fifth) and installd's percent (the rest), so the bar follows both to 100%.
export function runPercent(rows) {
  if (!rows.length) return 100;
  let n = 0;
  for (const r of rows) {
    if (ended(r)) n += 1;
    else if (r.state === "installing" && r.phase === "copying") n += 0.5 + 0.1 * (r.fraction || 0);
    else if (r.state === "installing" && r.here) n += 0.6 + 0.4 * (r.fraction || 0);
    else if (r.state === "downloading") n += 0.25 * (r.fraction || 0);
    else if (r.state === "signing") n += 0.25 + 0.25 * (r.fraction || 0);
    else if (r.state === "signed" || r.state === "asking") n += 0.5;
    else if (r.state === "installing") n += 0.5 + 0.5 * (r.fraction || 0);
  }
  return Math.round((n / rows.length) * 100);
}

export const isSelf = (row) => row?.id === SELF_ID;

// B137: whether an "asking" row has iOS's Install prompt to tap. A row on the This iPhone route (`local`, from
// createAppRun's local(row)) has none while its route is settled (idevice.status, the LocalDevVPN alert); it says
// Installing. Its install going through the Signing Server after all sends phase "asking": the prompt is up then.
export const promptUp = (row) => !row?.local || row.phase === "asking";
