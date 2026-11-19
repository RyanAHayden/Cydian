// F235: the IPA queue's run (app pages' Install / Upgrade, Changes' Upgrade (N), Re-sign and Re-sign All through the
// app Confirm) on F234's black page with rows (nav/progress.js; the brain is core/apprun.js; the looks are
// progress.css's .qr-* rows, shared with screens/queuerun.js):
//
//   Apps (the default; a run of one app opens on the Log instead): one row per queued app, in the run's order (iFizBox's own IPA last): its name, a grey line
//     (Waiting / Downloading 12.0 of 48.0 MB / Signing 40% / Signed / Tap Install on the iOS prompt / Installing /
//     Installed / Re-signed, expires <date> / Failed: why / Cancelled), an iOS 6 progress bar while it works, and the
//     round stop button on a working row: it cancels only that app (its download, its signing or iOS's prompt) and the
//     next goes on. A failed or cancelled row's tap retries it once the run has ended; a "Tap Install on the iOS
//     prompt" row's tap shows iOS's prompt for it again (B85, signing.reprompt: the user dismissed it); any other row
//     opens the Log with that app's lines only. A prompt that closed without iOS asking for the IPA (the user's Cancel,
//     or iOS couldn't reach iFizBox: it can't tell which) ends its row "Failed: iOS didn't download it" and the next
//     app goes on; that row's tap (Try Again) asks iOS again with the IPA still served (B91: the Signing Server's copy
//     after a freeze), and only that tap opens a new prompt. The summary ("2 installed, 1 failed") ends the list and the log.
//   Log: one line per phase per app (Downloading Delta 48 MB, Signed Delta, Asked iOS to install Delta, Installed
//     Delta / the reason it failed) with the shell's own lines grey under its app. Percents only move the rows' bars
//     and the bottom status.
//   Top right, as F234's: the red Cancel while it runs (every app not finished is abandoned; then the app Confirm
//     again with what finished cleared and the footer "Stopped. N installed and cleared from the queue."), Retry All
//     after failures (Close at the top left), Done when clean.
//   The bottom: the status and the bar while it runs, then Return to iFizBox; "Closing iFizBox" (locked, B49) when
//     iFizBox's own IPA went to iOS, which closes iFizBox to install it.
//
// What iOS took leaves the queue (and is recorded for Installed) as it goes; failed and cancelled apps stay queued.
// An app handed to iOS while iFizBox was in the background ends "Sent to iOS", and turns Installed once iOS says it has
// it when iFizBox is back in front (followHandoff, B76).
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "../nav/ui.js";
import { openProgress, openOn, RETURN_LABEL, CLOSING_LABEL } from "../nav/progress.js";
import { appRows, createAppRun, rowStatus, summaryLine, runStatus, runPercent, ended, isSelf } from "../core/apprun.js";

// The phone's side of a run, from signing-client.js (prepareOnDevice, openPrepared, discardPrepared). Each attempt of a
// row gets its own tag, so signing.cancel {tag} stops that try only.
export function phoneLanes(sc, { native } = {}) {
  let n = 0;
  const tagOf = (r) => `${r.id}#${++n}`;
  const served = new Map(); // B91: row id -> the tag its served IPA runs under (Try Again's Stop stops that serving)
  return {
    sign: (r, { signal, progress }, log = () => {}) => sc.prepareOnDevice(r.job, { tag: tagOf(r), signal, progress, log, native }),
    install: (r, { signal, progress, again = false }, log = () => {}) => {
      const tag = (again && served.get(r.id)) || tagOf(r);
      served.set(r.id, tag);
      return sc.openPrepared(r, { tag, signal, progress, log, host: isSelf(r), native, ...(again ? { again: true } : {}) });
    },
    discard: (r) => sc.discardPrepared(r.token, native),
    // B85: the "Tap Install on the iOS prompt" row's tap: iOS's prompt for that app again
    reprompt: (r) => sc.repromptPrepared?.(r, native) ?? false,
    // B76: which of these apps iOS has now ({ bundleId: true | false | null }); apps.isInstalled works in both builds
    isInstalled: async (bundleIds) => {
      const n = native ?? globalThis.ifizboxNative;
      if (!n?.call) return {};
      try { return (await n.call("apps.isInstalled", { bundleIds }))?.installed ?? {}; } catch { return {}; }
    },
  };
}

// B71a: the jailbreak app's side of a run: no signing. The "sign" lane only checks the IPA's own MinimumOSVersion
// (ipa-install.js ipaNeeds, B72: nothing is downloaded for an app this iPhone's iOS can't run); the install lane hands
// the IPA to the helper's install-ipa (ipa-install.js runIpaInstall: the shell downloads it, installd installs it, its
// lines and percent on the row) or a Remove to the helper's uninstall-app (backend.uninstallApp, the Installed tab's
// Delete). Rows' jobs carry `helper: true` (core/apprun.js helperRow: its words). Every call can be stood in for (tests).
export function helperLanes({ backend, install, needs, native } = {}) {
  return {
    sign: async (r) => {
      if (r.job?.op !== "remove") {
        const n = needs ? await needs(r.job.url).catch(() => null) : null;
        if (n) throw new Error(`needs iOS ${n.min} (this iPhone has ${n.ios})`);
      }
      return { token: r.job?.op === "remove" ? "remove" : r.job?.url || "ipa", bundleId: r.id };
    },
    install: async (r, { signal, progress }, log = () => {}) => {
      progress("installing", 0);
      if (r.job?.op === "remove") {
        if (typeof backend?.uninstallApp !== "function") throw new Error("This build can't delete apps.");
        await backend.uninstallApp(r.id, (ev) => {
          const line = String(ev?.line ?? "").trim();
          const m = /^pmstatus:[^:]*:([\d.]+):(.+)$/.exec(line);
          if (m) progress("installing", Number(m[1]) / 100);
          else if (line) log(line);
        });
        return { installed: true };
      }
      const view = {
        line: (type, text) => { if (type !== "status") log(type === "error" ? `E: ${text}` : text); },
        status: () => {},
        progress: (pct) => progress("installing", Math.min(99, Number(pct) || 0) / 100),
      };
      const res = await install({ url: r.job.url, name: r.name }, view, { ...(native ? { native } : {}), signal });
      if (res?.cancelled) throw new Error("cancelled");
      if (!res?.ok) throw new Error(res?.error?.message || res?.error?.title || "the helper didn't install it");
      return { installed: true };
    },
    discard: () => {},
  };
}

// B76: iFizBox leaving the screen while an app is with iOS hands that app to iOS (run.away(): a false from the watch
// then reads "Sent to iOS", not Failed), and coming back asks iOS which "Sent to iOS" rows it has (run.confirm: Installed).
// Also asked when such a row ends while iFizBox is in front. -> { check, stop }
export function followHandoff(run, rows, { isInstalled, doc = globalThis.document } = {}) {
  const hidden = () => doc?.visibilityState === "hidden";
  let asking = false;
  const check = async () => {
    if (!isInstalled || asking || hidden()) return;
    const sent = rows.filter((r) => r.state === "installed" && r.unsure && r.mode !== "resign" && r.bundleId && !isSelf(r));
    if (!sent.length) return;
    asking = true;
    let answer = {};
    try { answer = (await isInstalled(sent.map((r) => r.bundleId))) ?? {}; } catch { /* unknown: they stay sent */ }
    asking = false;
    for (const r of sent) if (answer[r.bundleId] === true) run.confirm(r.id);
  };
  const onVisibility = () => { if (hidden()) run.away(); else check(); };
  doc?.addEventListener?.("visibilitychange", onVisibility);
  return { check, stop: () => doc?.removeEventListener?.("visibilitychange", onVisibility) };
}

// jobs: the app queue's (core/appqueue.js). deps: { queue, lanes ({ sign, install, discard }, phoneLanes's),
//   record(job) (Installed's record of an install), reopenConfirm(footer), onClose(result), open (openProgress, tests),
//   stallMs, later, clear (tests), finish(result) (B71a: { label, action } for the bottom button, or null) } ->a promise for the first end: { ok, stopped, rows, installed }.
export async function runAppRun(jobs, deps) {
  const { queue, lanes, record = async () => {}, reopenConfirm = () => {}, open = openProgress } = deps;
  const page = open({ title: "Running" });
  const rows = appRows(jobs);

  // ---- the log ----
  const line = (kind, text, id = null) => { if (text) page.line(kind, text, id); };

  // ---- Apps ----
  const pane = el("div", "qr-pane");
  const list = el("ul", "qr-list");
  const summary = el("li", "qr-summary");
  summary.hidden = true;
  pane.append(list);
  page.pane(pane);
  const seg = page.segmented(["Apps", "Log"], (i) => {
    if (i === 0) { page.filter(null); page.view("pane"); } else page.view("log");
  });
  openOn(page, seg, rows.length); // F247: one app opens on the Log
  const showLog = (id) => { seg.select(1); page.filter(id); page.view("log"); };

  const views = new Map();
  for (const r of rows) {
    const li = el("li", "qr-row");
    const main = el("button", "qr-main");
    main.type = "button";
    const name = el("div", "qr-name", r.name);
    const status = el("div", "qr-status");
    const bar = el("div", "qr-bar");
    const fill = el("div", "qr-fill");
    bar.append(fill);
    main.append(name, status, bar);
    const act = el("button", "qr-stop");
    act.type = "button";
    act.setAttribute("aria-label", `Stop ${r.name}`);
    li.append(main, act);
    list.append(li);
    main.addEventListener("click", () => {
      if (!run.running && (r.state === "failed" || r.state === "cancelled")) retry(r.id);
      else if (r.state === "asking" && lanes.reprompt) run.reprompt(r.id); // B85: the prompt again
      else showLog(r.id);
    });
    act.addEventListener("click", () => run.stop(r.id));
    views.set(r.id, { li, status, bar, fill, act });
  }
  list.append(summary);
  const WORKING = ["downloading", "signing", "signed", "asking", "installing"];
  const draw = (r) => {
    const v = views.get(r.id);
    if (!v) return;
    v.li.dataset.state = r.state;
    v.status.textContent = rowStatus(r);
    const busy = ["downloading", "signing", "asking", "installing"].includes(r.state);
    v.bar.hidden = !busy;
    v.bar.classList.toggle("is-indeterminate", r.state === "asking" || !r.fraction);
    v.fill.style.transform = `scaleX(${r.fraction || 0})`;
    v.act.hidden = !WORKING.includes(r.state) || run.stopping;
  };

  // ---- the run ----
  const cleared = new Set();
  let sentSelf = false;
  const run = createAppRun({
    rows,
    sign: (r, hooks) => lanes.sign(r, hooks, (text) => line("raw", text, r.id)),
    install: (r, hooks) => lanes.install(r, hooks, (text) => line("raw", text, r.id)),
    discard: (r) => lanes.discard(r),
    ...(lanes.reprompt ? { reprompt: (r) => lanes.reprompt(r) } : {}),
    ...(deps.stallMs ? { stallMs: deps.stallMs } : {}),
    ...(deps.later ? { later: deps.later, clear: deps.clear } : {}),
    onChange: (r) => {
      draw(r);
      if (r.state === "installed" && !cleared.has(r.id)) {
        cleared.add(r.id);
        if (isSelf(r)) sentSelf = true;
        queue.clear(r.id);
        Promise.resolve().then(() => record(r.job)).catch(() => {}); // no store: Installed won't list it
        if (r.unsure) Promise.resolve().then(() => handoff?.check()); // B76: iOS may have it already
      }
      tick();
    },
    onLog: ({ id, kind, text }) => line(kind, text, id),
  });
  const isInstalled = deps.isInstalled ?? lanes.isInstalled;
  const handoff = followHandoff(run, rows, { isInstalled, ...(deps.doc ? { doc: deps.doc } : {}) });
  page.onClose?.(() => handoff.stop());
  let tickQueued = false;
  const tick = () => {
    if (tickQueued) return;
    tickQueued = true;
    Promise.resolve().then(() => {
      tickQueued = false;
      if (run.stopping) page.status("Stopping…");
      else if (run.running) page.status(runStatus(rows));
      page.progress(runPercent(rows));
    });
  };

  // ---- the bar ----
  const cancel = barButton("Cancel", "red");
  const closeB = barButton("Close");
  const retryAll = barButton("Retry All");
  const done = barButton("Done", "done");
  let cancelled = false;
  cancel.addEventListener("click", () => {
    if (cancel.disabled) return;
    if (run.cancel()) { cancelled = true; cancel.disabled = true; for (const r of rows) draw(r); tick(); }
  });
  closeB.addEventListener("click", () => page.close());
  done.addEventListener("click", () => page.close());
  retryAll.addEventListener("click", () => { const p = run.retryAll(); if (p) drive(p); });
  const retry = (id) => { const p = run.retry(id); if (p) drive(p); };

  let first = null;
  let latest = null;
  if (deps.onClose) page.onClose(() => deps.onClose(latest));

  async function drive(promise) {
    cancelled = false;
    page.reopen({ title: "Running", status: runStatus(rows) });
    cancel.disabled = false;
    summary.hidden = true;
    page.bar({ right: cancel });
    for (const r of rows) draw(r);
    await promise;
    return end(cancelled);
  }

  async function end(wasCancel) {
    for (const r of rows) draw(r);
    tick();
    const installed = rows.filter((r) => r.state === "installed");
    const bad = rows.filter((r) => r.state === "failed" || r.state === "cancelled");
    const text = summaryLine(rows);
    summary.textContent = text;
    summary.hidden = false;
    line("step", text);
    const result = { ok: !bad.length, stopped: wasCancel, rows, installed: installed.length };
    if (!first) first = result;
    latest = result;
    if (wasCancel) {
      // Cancel: back to the app Confirm with what finished cleared, and a footer that says so
      await page.close();
      if (queue.size) reopenConfirm(`Stopped. ${installed.length} installed and cleared from the queue.`);
      return result;
    }
    page.bar(bad.length ? { left: closeB, right: retryAll } : { right: done });
    // B49: iFizBox's own IPA is with iOS, which closes iFizBox to install it: nothing to tap
    const fin = sentSelf ? null : deps.finish?.(result); // B71a: the jailbreak run's (AppSync Unified's respring)
    if (sentSelf) page.finish({ label: CLOSING_LABEL, status: text, locked: true });
    else if (fin) page.finish({ label: fin.label, status: text, action: fin.action ?? (() => false) });
    else page.finish({ label: RETURN_LABEL, status: text, action: () => false });
    return result;
  }

  // every row starts drawn
  for (const r of rows) draw(r);
  const p = run.start();
  return drive(p).then(() => first, () => first);
}

export { ended };
