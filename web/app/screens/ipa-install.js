// F67: Install IPA in the jailbreak build (ipa-install.js runs it over F59's ipa.install; core/ipainstall.js has the
// words). Three ways in:
//   - Settings > Install IPA > Install from URL: an alert with a URL field and Paste (askIpaUrl)
//   - an AltStore app's Install row (screens/altstore.js installRows, jailbreak only): the app's own IPA
//   - a tapped link to an .ipa anywhere in the app (depictions, news): an action sheet offers Install IPA
//     (initIpaLinks, app.js)
// F88: a successful install is remembered (core/installed.js) for the Installed tab's Apps page and Changes: the
// AltStore row's with its source (installRows' onInstall), a URL's or link's by bundle id (rememberIpa).
// All open the same progress page as the install queue's (F151: nav/progress.js): the shell's and helper's lines as
// they come, installd's pmstatus progress on the bar, then Close (installd puts the app on the home screen itself, so
// no uicache; Close iFizBox only for iFizBox's own IPA, which has to quit) (B61: Restart
// SpringBoard when AppSync Unified was just installed, as its SpringBoard hook loads only then: ipaFinish). F189: AppSync
// Unified first when it's missing (ensureAppSync: akemi's source, then the Confirm sheet with it under Install); a
// failure there, or installd still refusing the app (no_adhoc), ends in one short alert (appSyncFallback: Try Again,
// Open Source, OK). Each run is kept in Settings > Console Logs.
// The sideload build has none of this: it keeps signing.install (signing-client.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { openProgress } from "../nav/progress.js";
import { chooseFinish, selfLevels } from "../core/progress.js";
import { getBackend } from "../backend.js";
import { runLogs } from "../queue.js";
import { ipaInstallAvailable, runIpaInstall } from "../ipa-install.js";
import { ipaUrl, ipaName, looksLikeIpa, IPA_FOOTER } from "../core/ipainstall.js";
import { apps, recordInstall } from "../core/installed.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";
import { showHUD } from "../nav/hud.js";
import { APPSYNC_ID, APPSYNC_NAME, APPSYNC_SOURCE, APPSYNC_PAGE, appSyncInstalled, sameSource, appSyncFailure,
  afterAppSyncNote, TRY_AGAIN, OPEN_SOURCE } from "../core/appsync.js";

let running = false;
let preparing = false; // F189: ensureAppSync is getting AppSync Unified for an IPA

// F189: before an IPA install, AppSync Unified (core/appsync.js). Where the backend has apt's queue (the jailbreak
// build) and dpkg's status says it's missing ("Getting AppSync Unified" HUD): akemi's source added when missing,
// refreshed on its own, each under a time limit (APPSYNC_LIMITS), then AppSync Unified queued, which opens Confirm with it under Install and a note that the
// IPA follows; the promise waits for that queue run (screens/queue.js whenQueueRuns). Every outside call comes in
// `deps`, so the steps can be tested without a page. Resolves:
//   { ok: true, present: true }       AppSync was there already
//   { ok: true }                      the backend can't tell (no queue, no dpkg status): the IPA goes as before
//   { ok: true, installed: true }     the queue run installed it
//   { cancelled: true }               Confirm's Cancel (or the run's): nothing more is done
//   { ok: false, step }               add | refresh | missing | install: core/appsync.js appSyncFailure(step)
// The time limits: a host behind Cloudflare that is down answers 522 only after about 19 s per request, and Add
// Source's check makes several (seen on the iPhone 7: over 3 minutes of spinner), so the add gets 25 s and the
// refresh (apt-get update of every source) 2 minutes; past that, the fallback alert.
export const APPSYNC_LIMITS = { add: 25_000, refresh: 120_000 };

function deadline(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  promise.catch?.(() => {}); // left running past the limit: its failure is no one's
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export async function ensureAppSync({ name = "", backend = getBackend(), catalog = null, hud = showHUD, wait = null,
  limits = APPSYNC_LIMITS } = {}) {
  if (typeof backend?.queue !== "function" || typeof backend?.dpkgStatus !== "function") return { ok: true };
  let status = null;
  try { status = await backend.dpkgStatus(); } catch { status = null; }
  if (typeof status !== "string") return { ok: true };
  if (appSyncInstalled(status)) return { ok: true, present: true };

  // One HUD for the whole step (the user tapped Install on an IPA, not Add Source), hidden before any alert.
  const hide = hud(`Getting ${APPSYNC_NAME}`);
  let key = null;
  try {
    key = (await backend.sources()).find((s) => sameSource(s.uri))?.key ?? null;
    if (!key) {
      key = (await deadline(backend.addSource(APPSYNC_SOURCE), limits.add))?.key ?? null;
      key ??= (await backend.sources()).find((s) => sameSource(s.uri))?.key ?? null;
    }
  } catch { key = null; }
  if (!key) { hide(); return { ok: false, step: "add" }; }

  let pkg = null;
  try {
    const only = (s) => s.key === key;
    const rows = await deadline(backend.refreshSources(() => {}, { filter: only }), limits.refresh);
    if ((rows ?? []).find(only)?.aptError || (rows?.failed ?? []).some((f) => f.key === key)) throw new Error("refresh");
    const cat = catalog ?? (await import("../catalog.js")).catalog; // late: catalog.js pulls in the parse worker
    await cat.ensure();
    pkg = await cat.package(APPSYNC_ID, key);
  } catch {
    hide();
    return { ok: false, step: "refresh" };
  }
  hide();
  if (!pkg || pkg.installedOnly || (pkg.key && pkg.key !== key)) return { ok: false, step: "missing" };

  const until = wait ?? (await import("./queue.js")).whenQueueRuns;
  const outcome = until(APPSYNC_ID, { note: afterAppSyncNote(name) }); // before the add: Confirm draws the note
  backend.queue({ op: "install", id: APPSYNC_ID, version: pkg.stanza?.version ?? null,
    name: pkg.row?.name || pkg.stanza?.name || APPSYNC_NAME });
  const how = await outcome;
  if (how === "installed") return { ok: true, installed: true };
  if (how === "cancelled") return { cancelled: true };
  return { ok: false, step: "install" };
}

// F189: the short fallback when AppSync Unified couldn't be had (or installd still refused the app): one plain
// sentence, Try Again, Open Source (AppSync's page on akemi's repo, to install it by hand) and OK. -> true for Try Again.
export async function appSyncFallback(step, { alert = showAlert, open = (url) => window.open(url, "_blank", "noopener") } = {}) {
  const f = appSyncFailure(step);
  const { index } = await alert({ title: f.title, message: f.message, buttons: f.buttons, cancel: f.buttons.length - 1 });
  if (index === OPEN_SOURCE) open(APPSYNC_PAGE);
  return index === TRY_AGAIN;
}

// F189: openIpaInstall's way in: AppSync Unified first (ensureAppSync), its fallback alert when that fails (Try Again
// goes round again), then the IPA's console; installd still refusing the app (no_adhoc) gets the same short alert.
// `deps` stand in for ensureAppSync, the alert and the console in tests.
export async function installWithAppSync({ url, name = "", onInstalled = () => {}, native = undefined },
  { ensure = ensureAppSync, fallback = appSyncFallback, run = runIpaConsole } = {}) {
  if (running || preparing) return false;
  const title = name || ipaName(url);
  for (;;) {
    preparing = true;
    let got;
    try { got = await ensure({ name: title }); } catch { got = { ok: false, step: "install" }; } finally { preparing = false; }
    if (got.cancelled) return false;
    if (got.installed) appSyncRespring = true; // B61: its SpringBoard hook waits for a respring (ipaFinish)
    if (!got.ok) {
      if (await fallback(got.step)) continue;
      return false;
    }
    const r = await run({ url, name: title, onInstalled, native });
    if (r?.error?.code !== "no_adhoc") return r;
    if (!(await fallback(got.installed || got.present ? "refused" : "absent"))) return r;
    await r.close?.(); // Try Again: this run's console makes way for the next
  }
}

// The console page for one IPA (F151: nav/progress.js, as the queue's). Resolves the run's result once it has ended
// (the page stays up until Close or the finish button). False when another IPA install's console is already up.
// N9: `native` stands in for the bridge (a shared file's share.ipaInstall, share.js). The button is ipaFinish's.
// F189: AppSync Unified comes first when it's missing (installWithAppSync above).
export function openIpaInstall(opts) {
  return installWithAppSync(opts);
}

// The console part of openIpaInstall. installd's no_adhoc refusal gets no alert here: installWithAppSync's short
// fallback says it.
export async function runIpaConsole({ url, name = "", onInstalled = () => {}, native = undefined }) {
  if (running) return false;
  running = true;
  const title = name || ipaName(url);
  const page = openProgress();
  page.onClose(() => { running = false; });
  // F188: Cancel at the top right from the first line to the end (Done once it has ended): it stops the run and the
  // page closes, back where Install was tapped.
  const ctl = new AbortController();
  page.stoppable?.(() => { ctl.abort(); stopIpaInstall(native); });
  const view = {
    line(type, text) { page.line(type === "status" ? "step" : type === "info" ? "raw" : type, text); },
    status(text) { page.status(text); },
    progress(pct) { page.progress(pct); },
  };

  const r = await runIpaInstall({ url, name: title }, view, { ...(native ? { native } : {}), signal: ctl.signal });
  runLogs.add({ title: `Install ${title}`, jobs: [{ op: "install", id: r.bundleId || url, version: null, mode: "ipa" }],
    code: r.ok ? 0 : -1, text: r.log });
  if (r.cancelled) return r;
  if (r.ok) { try { onInstalled(r); } catch { /* the record is a nicety */ } }

  const fin = ipaFinish({ ok: r.ok, name: title, bundleId: r.bundleId });
  if (fin.note) page.line("step", fin.note);
  page.finish({ label: fin.label, status: r.ok ? "Done" : "Failed", action: fin.action });
  if (r.error && r.error.code !== "no_adhoc") await showAlert({ title: r.error.title, message: r.error.message, buttons: ["OK"] });
  return { ...r, close: () => page.close() };
}

// B61: AppSync Unified installed in this session and SpringBoard not restarted since. Its FrontBoard hook
// (AppSyncUnified-FrontBoard.dylib) loads into SpringBoard only on a respring; until then SpringBoard refuses a
// fakesigned app ("signature state: Generic … No code signature found": the icon dims and nothing opens; B59 on the
// iPhone 7). Set by installWithAppSync when its queue run installed AppSync, cleared once ipaFinish's respring went
// through. Kept for the session, so a second IPA before the respring still ends on it (dpkg then says "present").
let appSyncRespring = false;
export function appSyncRespringPending() { return appSyncRespring; }
export function setAppSyncRespring(on) { appSyncRespring = Boolean(on); }

// The IPA console's finish button (runIpaConsole), without the page. -> { label, level, note, action }:
//   failed                          Close (the return level: the sheet closes), no action
//   ok, AppSync just installed      Restart SpringBoard (chooseFinish's restart level; uicache first), and a line
//                                   saying why; where the backend can't respring, Close and a line saying the app
//                                   opens after a respring
//   ok, iFizBox's own IPA           Close iFizBox (the reopen level: it has to quit for the new copy), no action
//   ok                              Close, no action: installd puts the app on the home screen itself (B59 on the
//                                   iPhone 7), so an IPA needs no uicache (Reload Data stays for .deb apps)
// action() resolves true to keep the page up (it failed and said so).
export function ipaFinish({ ok, name = "", bundleId = null, backend = getBackend(), alert = showAlert, pending = appSyncRespring } = {}) {
  const canUicache = typeof backend?.uicache === "function";
  const canRespring = typeof backend?.respring === "function";
  const app = name ? String(name).replace(/\.ipa$/i, "") : "The app";
  const restart = Boolean(ok && pending && canRespring);
  const choice = chooseFinish({ ok, levels: [...(restart ? ["restart"] : []), ...(bundleId ? selfLevels([bundleId]) : [])],
    kinds: restart ? ["app"] : [] });
  let note = null;
  if (ok && pending) {
    note = restart
      ? `${app} opens once SpringBoard restarts: ${APPSYNC_NAME} was just installed and loads into SpringBoard then.`
      : `${app} opens after a respring: ${APPSYNC_NAME} was just installed and loads into SpringBoard then.`;
  }
  const fail = async (title, e) => { await alert({ title, message: e?.message || String(e), buttons: ["OK"] }); return true; };
  let action = null;
  if (choice.level === "uicache" || choice.uicache || restart) {
    action = async () => {
      if (canUicache && (choice.uicache || choice.level === "uicache")) {
        try { await backend.uicache(); } catch (e) { return fail("Reload Data", e); }
      }
      if (restart) {
        try { await backend.respring(); } catch (e) { return fail("Restart SpringBoard", e); }
        appSyncRespring = false;
      }
      return false;
    };
  }
  return { label: choice.label, level: choice.level, note, action };
}

// F196: asks the shell to stop ipa.install (its download, or the helper before it starts: Apt.swift ipa.cancel).
// The page has already ended the run; the answer is ignored (a refusal once the helper runs, a shell without the
// call). Not for share.js's stand-in (`native`): it sends every call to share.ipaInstall, a staged file with no
// download to stop. True when ipa.cancel was asked for.
export function stopIpaInstall(native = undefined, { bridge = globalThis.ifizboxNative } = {}) {
  if (native !== undefined || typeof bridge?.call !== "function") return false;
  try { Promise.resolve(bridge.call("ipa.cancel", {})).catch(() => {}); } catch { return false; }
  return true;
}

// F88: an IPA installed from a URL or a link (no source page to say what it is): remembered by the bundle id the
// helper reports, so the Installed tab's Apps page and Changes follow it. No version: I4's real version (the
// jailbreak backend's installedApps) fills it in. An app already remembered (from its source's page, with its
// source) keeps that record. Resolves the record, or null (no bundle id, already remembered, no store).
export async function rememberIpa(r, name, { store = apps } = {}) {
  const id = r?.bundleId;
  if (!id) return null;
  try {
    const s = await store();
    if ((await s.all()).some((x) => x?.id === id)) return null;
    return await recordInstall(s, { id, name: String(name ?? "").replace(/\.ipa$/i, "") || id, version: "" });
  } catch { return null; }
}

// Settings > Install IPA's row: a URL typed or pasted. Asks again (with what was typed) when it isn't an http(s) link.
async function askIpaUrl(value = "") {
  for (;;) {
    const { index, value: typed } = await showAlert({
      title: "Install IPA",
      message: `The IPA's link (http or https). ${NAME} downloads it and installs it with the jailbreak.`,
      input: { placeholder: "https://example.com/App.ipa", value, type: "url", paste: (t) => ipaUrl(t) ?? String(t ?? "").trim() },
      buttons: ["Cancel", "Install"], cancel: 0,
    });
    if (index !== 1) return false;
    const url = ipaUrl(typed);
    if (url) return openIpaInstall({ url, onInstalled: (r) => rememberIpa(r, ipaName(url)) });
    await showAlert({ title: "Not a Link", message: `"${String(typed ?? "").trim()}" isn't an http or https link to an IPA.`, buttons: ["OK"] });
    value = typed;
  }
}

// The Settings root's section (jailbreak build only; nothing elsewhere).
export function ipaSection(available = ipaInstallAvailable()) {
  if (!available) return document.createDocumentFragment();
  return grouped([{ header: "Install IPA", rows: [{ label: "Install from URL", onClick: () => askIpaUrl(), icon: rowIcon("ipa") }],
    footer: IPA_FOOTER }]);
}

// A tapped link to an .ipa (a depiction's, a news item's): Install IPA or open it as the link would.
export function initIpaLinks(root = document) {
  if (!ipaInstallAvailable()) return;
  root.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[href]");
    if (!a || e.defaultPrevented || !looksLikeIpa(a.href)) return;
    e.preventDefault();
    e.stopPropagation();
    const url = a.href;
    showActionSheet({ title: ipaName(url), buttons: ["Install IPA", "Open Link"] }).then((i) => {
      if (i === 0) openIpaInstall({ url, onInstalled: (r) => rememberIpa(r, ipaName(url)) });
      else if (i === 1) window.open(url, "_blank", "noopener");
    });
  }, true);
}
