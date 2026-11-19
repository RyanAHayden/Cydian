// Signing in the sideload build (F58, I6): the phone signs every app itself, through the shell's signing.* bridge
// calls; the Signing Server (worker/, brand.js SIGN_HOST unless the user runs their own) only hands iOS the install
// manifest and holds iFizBox's own update. F93: the website signs in the browser again, zsign as WebAssembly in a Web
// Worker (signInBrowser, at the end), and the Worker only hosts the signed IPA for iOS. docs/signing.md has the picture.
//
//   await loadIdentity()         the picks on Settings > Signing ({ p12, p12Name, password, profile, profileName }),
//                                in memory until signing.import puts them into the Keychain (the app), or kept in
//                                this browser's IndexedDB (the website, F93), or null
//   await saveIdentity(patch)    merges into them;  await clearIdentity()
//   await signingReady()         true when the Keychain holds an identity (statusReady(signing.status), as Settings
//                                shows it), or on the website when a .p12 and a profile are saved; false in the
//                                jailbreak app
//   getBring() / setBring(on)    the website's Bring My Certificate switch (on unless turned off): Install iFizBox
//                                App puts the certificate inside iFizBox's IPA
//   getServer() / setServer(s)   Settings > Signing's server, https://${SIGN_HOST} unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled, bring })   signs on the phone and installs (installOnDevice), or
//                                on the website signs in the browser (signInBrowser)
import { showBanner } from "./nav/banner.js";
import { APP_SERVER, LEGACY_SERVER, normalizeServer, toBase64, phaseLabel, deviceError, parseProfile, deviceCheck, notLandedText, notInProfileText } from "./core/signing.js";
import { format, settingsRoute } from "./router.js";
import { IPA_MAX, IFIZBOX_ID, profileInfo, targetBundleId, siteMB, SITE_LIMIT_TEXT, overSiteLimit } from "./core/websign.js";
import { addSiteUrl, markFresh, MYIPAS } from "./core/myipas.js";
import { showActionSheet } from "./nav/actionsheet.js";
import { storedKeep, withKeep, originalState, originalNote } from "./core/keepid.js";
import { detectMode } from "./core/settings.js";
import { progressHUD, lockSelfUpdate, unlockSelfUpdate } from "./nav/progress.js";
import { recordSelfUpdate } from "./core/selfupdate.js";
import { showAlert } from "./nav/alert.js";
import { NAME, GITHUB_REPO } from "./brand.js";

// F151: a job's error on the progress page (the HUD interface's fail, nav/progress.js) before its alert; a HUD
// without one (liveHUD, the tests') just goes.
const failed = (h, message) => (typeof h.fail === "function" ? h.fail(message) : h.hide());

// F188: the progress page's Cancel (top right all through, nav/progress.js progressHUD) ends the job at once: `p`, or a
// rejection with code "cancelled" the moment it is tapped, so nothing waits on a bridge call, a download or the
// signer that no one wants any more (and installOnDevice's one-at-a-time lock comes free). A HUD without Cancel
// (liveHUD, the tests') just waits for `p`.
export function untilCancel(h, p) {
  if (typeof h?.onCancel !== "function") return p;
  return new Promise((resolve, reject) => {
    h.onCancel(() => reject(Object.assign(new Error("Cancelled"), { code: "cancelled" })));
    Promise.resolve(p).then(resolve, reject);
  });
}

// F188: asks the shell to stop its signing job (download, signing, the local server's keep-alive). Shells without
// signing.cancel refuse it, and the job then runs out on its own; its answer is ignored either way.
function stopNative(native) {
  try { Promise.resolve(bridge(native).call("signing.cancel", {})).catch(() => {}); } catch { /* no bridge */ }
}

const SERVER_KEY = "ifizbox.signingServer";

// The picks wait in memory only, until signing.import puts them into the Keychain; then only their names stay (the
// .p12 itself never goes to the web view's storage). F93: the website keeps them in IndexedDB (this browser only:
// they never leave it but inside iFizBox's own IPA with Bring My Certificate), as it did before F89.
let staged = null;
// F121: the website's identity as last read from or written to IndexedDB, for Install's tap to use without waiting
// (identityNow); warmed when this module loads on the website.
let known = null;
const identityNow = () => known;
const DB = "ifizbox-signing", STORE = "identity", KEY = "current", BRING_KEY = "ifizbox.bringCertificate";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("This browser can't keep files (no IndexedDB).")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed"));
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error ?? new Error("IndexedDB failed"));
      t.onabort = () => reject(t.error ?? new Error("IndexedDB aborted"));
    });
  } finally { db.close(); }
}

export async function loadIdentity() {
  if (browserSigning()) { try { return (known = (await tx("readonly", (st) => st.get(KEY))) ?? null); } catch { return null; } }
  return staged ? { ...staged } : null;
}

export async function saveIdentity(patch) {
  if (browserSigning()) {
    const next = { ...((await loadIdentity()) ?? {}), ...patch, savedAt: Date.now() };
    await tx("readwrite", (st) => st.put(next, KEY));
    known = next;
    if (needsConfirm(next)) confirmSoon(); // F260
    return next;
  }
  staged = { ...(staged ?? {}), ...patch, savedAt: Date.now() };
  return { ...staged };
}

export async function clearIdentity() {
  if (browserSigning()) { known = null; await tx("readwrite", (st) => st.delete(KEY)); return; }
  staged = null;
}

export async function signingReady({ native, wait = sleep } = {}) {
  if (browserSigning()) {
    // F121: from memory when it's there, so Install iFizBox App's tap reaches iOS's prompt without a wait in between
    const id = known ?? (await loadIdentity());
    return Boolean(id?.p12 && id?.profile && id.passwordOk !== false);
  }
  if (!localSigning()) return false;
  return statusReady(await readyStatus(native, wait));
}

// F93 (F75's switch, back): on unless the user turned it off.
export function getBring() {
  try { return localStorage.getItem(BRING_KEY) !== "off"; } catch { return true; }
}
export function setBring(on) {
  try {
    if (on) localStorage.removeItem(BRING_KEY);
    else localStorage.setItem(BRING_KEY, "off");
  } catch { /* private mode: this session only */ }
}

// A saved website address (LEGACY_SERVER, the website's old signer) means the default too.
export function defaultServer() { return APP_SERVER; }
export function getServer() {
  let saved = null;
  try { saved = normalizeServer(localStorage.getItem(SERVER_KEY)); } catch { /* private */ }
  if (!saved || saved === LEGACY_SERVER) return defaultServer();
  return saved;
}

export function setServer(s) {
  const n = normalizeServer(s);
  try {
    if (!n || n === APP_SERVER || n === LEGACY_SERVER) localStorage.removeItem(SERVER_KEY);
    else localStorage.setItem(SERVER_KEY, n);
  } catch { /* private mode: this session only */ }
  return n && n !== LEGACY_SERVER ? n : APP_SERVER;
}

export async function serverStatus(server = getServer()) {
  const r = await fetch(`${server}/sign/status`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${new URL(server).host} answered HTTP ${r.status}.`);
  return r.json();
}

// F72: an IPA of iFizBox itself (its GitHub releases, where iFizBox's own source points).
// Only iFizBox's own IPA files count: a release's ${NAME}.ipa, or the test source's <name>-<version>.ipa (F180: no
// old asset names). Other files under the test-fixtures pre-release (Test Alpha, Test Beta...) are ordinary apps.
const SELF_IPA = new RegExp(`^https://github\\.com/${GITHUB_REPO.replace(/[.]/g, "\\.")}/releases/(?:latest/)?download/(?:[^/]+/)?(?:${NAME}|${NAME}-[\\d.]+)\\.ipa$`, "i");
export const isSelfIpa = (url) => SELF_IPA.test(String(url ?? ""));

// Signs `url` (an IPA) on the phone and installs it. Resolves true once iOS was asked to install; false after an
// error, which it shows in an alert; false in the jailbreak app (its pages use the helper, so this is only a guard).
// F93: on the website, signs it in the browser (signInBrowser); `bring` (Install iFizBox App) carries the certificate.
// F257: `size` (the source's listed size) and `iconUrl` are the website's: an app over its cap opens the Too Big alert.
export async function signAndInstall({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null }) {
  if (browserSigning()) return signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl });
  if (!localSigning()) {
    await showAlert({ title: "Can't Install Here", message: `Apps are signed in the ${NAME} app. Open this one in ${NAME}, AltStore, SideStore or Feather.`, buttons: ["OK"] });
    return false;
  }
  // iFizBox's own IPA: signed here on the phone like any app, then hosted on the Signing Server (host: true) since
  // iOS closes iFizBox, and its install server, while it installs over it. Straight to iOS's Install prompt.
  if (isSelfIpa(url)) return installOnDevice({ url, name: name || NAME, onInstalled, host: true });
  // F75: the first Install with something missing opens the Signing walkthrough at that step, not an alert.
  if (await firstInstallCheck()) {
    // F177: Signing offers Install Now for this app once it's set up.
    (await import("./screens/signing.js")).rememberInstall({ name, run: () => signAndInstall({ url, name, onInstalled, bring, bundleId, version, bytes }) });
    return false;
  }
  // F243: the original app (its own ID, not signed by iFizBox) is on the phone: say so once before iOS refuses.
  const choice = await originalWarning({ bundleId, name });
  if (choice === "cancel") return false;
  // F81: one tap: Install signs and installs straight away. The look-first sheet (F68, signing-sheet.js) is the app
  // page's Custom Install row (signing-sheet.js customInstall).
  if (choice === "copy") return installOnDevice({ url, name, onInstalled, params: { url, keepBundleId: false } });
  return installOnDevice({ url, name, onInstalled });
}

// ---- F243: the original app on the phone, before a plain Install ---------------------------------------------
//
//   await originalWarning({ bundleId, name }, { native, alert, storage, keep })   "install" | "copy" | "cancel"
//
// With Keep Bundle IDs on, a signed app replaces the app under its own ID, and iOS refuses to put it over the App
// Store copy. When that ID is on the phone and iFizBox didn't sign it (core/keepid.js originalState), an alert says
// so, once per app: Install (as asked; remembered, so the next Install of it goes straight on), Install a Copy (this
// time the old way, a separate copy under the profile's ID beside the original) or Cancel. Nothing to say without a
// bundle ID, with Keep Bundle IDs off (the old way replaces nothing), for iFizBox itself, or without a bridge.
export const ORIGINAL_WARNED_KEY = "ifizbox.originalWarned";

const warnedIds = (storage) => {
  try { const v = JSON.parse(storage?.getItem?.(ORIGINAL_WARNED_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

export async function originalWarning({ bundleId = null, name = "" } = {},
  { native = globalThis.ifizboxNative, alert = showAlert, storage = globalThis.localStorage, keep = storedKeep() } = {}) {
  if (!bundleId || !keep || bundleId === IFIZBOX_ID || typeof native?.call !== "function") return "install";
  if (warnedIds(storage).includes(bundleId)) return "install";
  const state = await originalState(native, bundleId).catch(() => ({ installed: false, ours: false }));
  const note = originalNote(name, state);
  if (!note) return "install";
  const { index } = await alert({ title: "Delete the Original First?", message: `${note.text} Install a Copy puts a separate one beside it, under your ID.`,
    buttons: ["Cancel", "Install a Copy", "Install"], cancel: 0 });
  if (index === 2) {
    try { storage?.setItem?.(ORIGINAL_WARNED_KEY, JSON.stringify([...warnedIds(storage), bundleId].slice(-200))); } catch { /* private mode */ }
    return "install";
  }
  return index === 1 ? "copy" : "cancel";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- on the phone (F58): the sideload build signs and installs itself, through I6's signing.* bridge calls ------
//
//   localSigning()                     true in the sideload build
//   await deviceStatus()               signing.status: { identity | null, identityProblem? }
//   statusReady(status)                F69: true when that status holds an identity (Install and Settings both ask)
//   await importToDevice({ p12, password, profile })   signing.import (files base64) -> status
//   await removeFromDevice()           signing.remove -> status
//   await firstInstallCheck()          F75: the walkthrough's missing step ("certificate" | "server"), opened, or null
//   await installOnDevice({ url, name, onInstalled })  signing.install with the progress page following its phases (F151)
//
// Each takes `native` (the bridge, globalThis.ifizboxNative by default) so tests can pass a fake.

export const localSigning = () => detectMode() === "sideload";
const bridge = (native) => {
  const n = native ?? globalThis.ifizboxNative;
  if (!n?.call) throw Object.assign(new Error("This build has no signer."), { code: "internal" });
  return n;
};

export async function deviceStatus(native) {
  return bridge(native).call("signing.status", {});
}

// F69: whether a signing.status answer holds a usable identity, the one rule Install (signingReady) and Settings >
// Signing (which shows the certificate) both go by, so the two can't disagree. The status as the bridge hands it
// over: an object, or the same as JSON text; identity an object with the certificate's name (it may be empty) or
// null (none, or one the Keychain doesn't return: then `identityProblem` says why).
export function statusReady(status) {
  let st = status;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch { return false; } }
  const id = st?.identity;
  return Boolean(id && typeof id === "object" && !Array.isArray(id));
}

// signing.status for signingReady: one more try a moment later when the bridge call fails (the signer's queue busy
// right after an import, the web view coming back from Safari). null when both fail.
async function readyStatus(native, wait) {
  for (let i = 0; i < 2; i++) {
    try { return keepDevice(await deviceStatus(native)); } catch { if (i === 0) await wait(400); }
  }
  return null;
}

// F236: the last signing.status's profile.device (is this iPhone in the profile), for an install whose own answer
// doesn't carry one (My IPAs): followInstall's likely-cause line when it came out "unknown".
let lastDevice = null;
function keepDevice(status) {
  let st = status;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch { return status; } }
  lastDevice = st?.identity?.profile?.device ?? null;
  return status;
}

export async function importToDevice({ p12, password, profile }, native) {
  return bridge(native).call("signing.import", { p12: toBase64(p12), profile: toBase64(profile), password: password ?? "" });
}

export async function removeFromDevice(native) {
  return bridge(native).call("signing.remove", {});
}

// F75: before the first install in the app: the certificate (signing.status, as signingReady) and a Signing Server
// (getServer, https only: the shell takes no other for the manifest) must be there. When one is missing, the Signing
// page opens with that step open and this answers its id; null when Install can go on. A bridge that doesn't answer
// counts as no certificate, as signingReady does.
// B39: `from`, the page Install was tapped on (taken before any wait), is where Signing returns once it's ready.
export async function firstInstallCheck({ native, server = getServer(), go = openRoute, wait = sleep, from = here() } = {}) {
  const { missingStep, openAt, rememberReturn } = await import("./screens/signing.js");
  const step = missingStep(await readyStatus(native, wait), server);
  if (!step) return null;
  openAt(step);
  rememberReturn(from);
  go(["signing"]);
  return step;
}

const here = () => globalThis.location?.hash ?? "";
// B39: every trip to Settings > Signing from a page (a missing certificate or server) comes back to that page once
// signing is ready (screens/signing.js offerInstall), not to Home's stack.
const openRoute = (path) => {
  const from = here();
  import("./screens/signing.js").then((m) => m.rememberReturn(from)).catch(() => {});
  location.hash = format(settingsRoute(path)).replace(/^#/, "");
};
export const openSigning = () => openRoute(["signing"]);

// Signs `url` (an IPA) on the phone and opens the install link: true once iOS was asked to install; false after an
// error, which an alert explains (no_server and no_identity then open Settings > Signing).
// F68: `params` replaces { url } with the look-first sheet's { token, name?, bundleId?, icon?, removeExtensions? }
// (core/signing.js installParams); `after(result, h)` runs with the HUD still up once iOS has the link (the sheet
// follows iOS's own progress there) and hides it itself.
let installing = false; // one install at a time: a second tap (or a doubled handler) while one runs is dropped
export async function installOnDevice(opts, deps) {
  if (installing) return false;
  installing = true;
  try { return await installOnDeviceOnce(opts, deps); } finally { installing = false; }
}

async function installOnDeviceOnce({ url, name = "", onInstalled = () => {}, params = null, after = null, host = false },
  { native, hud = progressHUD, alert = showAlert, go = openRoute, later = setTimeout, follow = null } = {}) {
  const h = hud("Downloading");
  h.onCancel?.(() => stopNative(native));
  let result;
  try {
    // manifestServer: the signing server hands iOS the manifest while iFizBox serves the IPA over plain HTTP at
    // 127.0.0.1 (nothing to set up on the phone; the server sees only the app's ID, version and name).
    result = await untilCancel(h, bridge(native).call("signing.install", { ...withKeep(params ?? { url }), manifestServer: getServer(), ...(host ? { host: true } : {}) }, (ev) => {
      if (ev?.log) h.page?.raw?.(ev.log); // the shell's console lines (Sideload.swift install's log)
      const t = phaseLabel(ev);
      if (t) h.set(t);
    }));
  } catch (e) {
    if (h.cancelled) return false;
    const why = deviceError(e, name);
    failed(h, why.message);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  }
  if (h.cancelled) return false;
  h.set("Installing");
  onInstalled(result);
  // iFizBox itself (host): iOS's Install prompt is up, and iFizBox closes once it's answered so the install finishes
  // (native CloseForUpdate): say so first (user 2026-11-18).
  if (host) showBanner({ title: NAME, message: `Press Install and keep ${NAME} open: it closes by itself once iOS has downloaded the new version. Open it again once the new icon appears.`, wait: true });
  if (after) { after(result, h); return true; }
  // F169: a plain Install ends through followInstall (signing-sheet.js): Done once iOS has the link (user 2026-11-18).
  // Not for iFizBox itself (host, or its own IPA or ID): iOS closes iFizBox while it installs over it.
  if (result?.bundleId && !host && !isSelfIpa(url) && result.bundleId !== IFIZBOX_ID) {
    const followInstall = follow ?? (await import("./signing-sheet.js")).followInstall;
    followInstall(bridge(native), result.bundleId, h, { later, name: result.name || name, device: result.device ?? lastDevice });
    return true;
  }
  // B49: iFizBox itself: the page ends locked on "Closing iFizBox" (no Close to tap) until iOS closes the app.
  // B83: the shell closes it only once iOS has the whole IPA; the page follows that, and offers Try Again if iOS
  // never took it. The version is kept so the next launch can tell it didn't land.
  if (host || isSelfIpa(url) || result?.bundleId === IFIZBOX_ID) {
    if (host) recordSelfUpdate(storageOf(), result?.version);
    lockSelfUpdate(h, { later });
    if (host) followSelfUpdate(h, { native, retry: () => installOnDevice({ url, name, onInstalled, params, after, host }, { native, hud, alert, go, later, follow }) });
    return true;
  }
  // iOS asks "Install …?" over the app: the progress page ends on Done (signed and handed to iOS), Return under it.
  later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return true;
}

// ---- B83: iFizBox's own update after iOS's prompt -----------------------------------------------------------
// The shell (native CloseForUpdate) closes iFizBox only once iOS has fetched the whole new IPA from the Signing
// Server; signing.selfUpdate streams how far it is. The locked page (lockSelfUpdate) gets a line a step, and when iOS
// never took the update (notStarted, stalled) its buttons back with Try Again (`retry`). An older shell, without the
// call, leaves the page as B49 does. -> the last state, or null.
const storageOf = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export const SELF_UPDATE_LINES = {
  waiting: `Finishing the update: waiting for iOS to download the new ${NAME}`,
  downloading: `Finishing the update: iOS is downloading the new ${NAME}`,
  finished: `iOS has the new ${NAME}. Closing so it can install it`,
};
export const SELF_UPDATE_FAILED = {
  notStarted: `The update didn't start: iOS didn't download the new ${NAME}. If Install was pressed, try again.`,
  stalled: `The update didn't finish: iOS stopped downloading the new ${NAME}.`,
};
export async function followSelfUpdate(h, { native, retry = null } = {}) {
  let last = null;
  const say = (s) => { if (s && s !== last && SELF_UPDATE_LINES[s]) { last = s; h?.page?.step?.(SELF_UPDATE_LINES[s]); } };
  let r;
  try { r = await bridge(native).call("signing.selfUpdate", {}, (ev) => say(ev?.state)); } catch { return null; }
  const s = r?.state ?? null;
  say(s);
  if (SELF_UPDATE_FAILED[s]) unlockSelfUpdate(h, { message: SELF_UPDATE_FAILED[s], retry });
  return s;
}

// ---- F235: the IPA queue's run, sign ahead and install one at a time (core/apprun.js, screens/apprun.js) --------
//
//   prepareParams(job)                 signing.prepare's params for a core/appqueue.js job: a Re-sign without a url signs
//                                      from the phone's record, a My IPAs job (`library`) from its file, a Custom Install
//                                      with its edits (always from the url: a look's token may be spent or stale)
//   await prepareOnDevice(job, { tag, signal, progress, log })   download and sign, keep the signed copy
//                                      -> { token, bundleId, name, version, expires }; progress(phase, fraction) with
//                                      phase "downloading" | "signing"; the signal's abort sends signing.cancel {tag}
//   await openPrepared(row, { tag, signal, progress, log, host, wait })   hand it to iOS (progress("asking")), then
//                                      wait for iOS's install (progress("installing", f)) -> { installed, expires,
//                                      dismissed? (B85: iOS's prompt closed and iOS never asked for the IPA) };
//                                      again (B91): signing.reprompt instead of signing.open (the IPA is still
//                                      served), then the same wait; throws code "gone" when it isn't
//                                      host (iFizBox's own) doesn't wait: iOS closes iFizBox to install it
//   await repromptPrepared(row)        B85: iOS's Install prompt for that app again (signing.reprompt) -> true | false
//   discardPrepared(token)             frees a signed copy that won't be installed
// Errors come as deviceError's message (core/signing.js), so a row's "Failed: ..." reads as the alerts do.

export const ASK_WAIT = 600; // seconds the queue waits for Install on iOS's prompt before the row fails

export function prepareParams(job) {
  if (!job) return null;
  if (job.mode === "resign" && !job.url && !job.library) return { record: job.id };
  const edits = { ...(job.options?.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  // F237: Keep Bundle IDs off goes with the job, unless its Custom Install chose (edits.keepBundleId)
  if (job.library) return withKeep({ library: job.library, ...edits });
  return withKeep({ url: job.url, ...edits });
}

// native.call that rejects with code "cancelled" the moment `signal` aborts, after asking the shell to stop `tag`.
function abortable(native, method, params, onEvent, { tag, signal }) {
  const n = bridge(native);
  return new Promise((resolve, reject) => {
    const stop = () => {
      try { Promise.resolve(n.call("signing.cancel", { tag })).catch(() => {}); } catch { /* no bridge */ }
      reject(Object.assign(new Error("Cancelled"), { code: "cancelled" }));
    };
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener?.("abort", stop, { once: true });
    Promise.resolve(n.call(method, { ...params, tag }, onEvent)).then(resolve, reject);
  });
}

const rowError = (e, name) => {
  if (e?.code === "cancelled") return e;
  const why = deviceError(e, name);
  return Object.assign(new Error(why.message), { code: e?.code ?? null });
};

export async function prepareOnDevice(job, { tag, signal = null, progress = () => {}, log = () => {}, native } = {}) {
  const params = prepareParams(job);
  try {
    return await abortable(native, "signing.prepare", params, (ev) => {
      if (ev?.log) { log(ev.log); return; }
      if (ev?.phase) progress(ev.phase === "downloading" ? "downloading" : "signing", Number(ev.progress) || 0);
    }, { tag, signal });
  } catch (e) { throw rowError(e, job?.name || job?.id || ""); }
}

export async function openPrepared(row, { tag, signal = null, progress = () => {}, log = () => {}, host = false, wait = ASK_WAIT, native, again = false } = {}) {
  const name = row?.name || row?.id || "";
  let opened;
  if (again && !host) {
    // B91: a row iOS didn't download, tapped: the shell's IPA (still served) gets iOS's prompt again, no new signing;
    // code "gone" when it isn't served any more
    if (!(await repromptPrepared(row, native))) throw Object.assign(new Error("no longer served"), { code: "gone" });
    opened = { bundleId: row.bundleId, expires: row.expires ?? null };
  } else try {
    opened = await abortable(native, "signing.open", { token: row.token, manifestServer: getServer(), ...(host ? { host: true } : {}) },
      (ev) => { if (ev?.log) log(ev.log); }, { tag, signal });
  } catch (e) { throw rowError(e, name); }
  progress("asking", 0);
  if (host) recordSelfUpdate(storageOf(), opened?.version || row?.version); // B83: the next launch checks it landed
  if (host) return { installed: null, expires: opened?.expires ?? null, host: true };
  const bundleId = opened?.bundleId || row.bundleId;
  if (!bundleId) return { installed: null, expires: opened?.expires ?? null };
  let r;
  try {
    r = await abortable(native, "signing.progress", { bundleId, wait }, (ev) => {
      if (ev?.log) log(ev.log);
      else if (ev?.phase === "installing") progress("installing", Number(ev.progress) || 0);
    }, { tag, signal });
  } catch (e) {
    if (e?.code === "cancelled") throw e;
    return { installed: null, expires: opened?.expires ?? null }; // iOS can't be asked: the prompt was shown
  }
  // B85: dismissed: iOS's prompt closed and iOS never asked for the IPA (the user tapped Cancel on it)
  return { installed: r?.installed ?? null, expires: opened?.expires ?? null, ...(r?.dismissed ? { dismissed: true } : {}) };
}

// B85: the run's "Tap Install on the iOS prompt" row: iOS's prompt for that app again -> true when the shell re-opened it
export async function repromptPrepared(row, native) {
  if (!row?.bundleId) return false;
  try { return Boolean((await bridge(native).call("signing.reprompt", { bundleId: row.bundleId }))?.reopened); } catch { return false; }
}

export function discardPrepared(token, native) {
  try { Promise.resolve(bridge(native).call("signing.discard", { token })).catch(() => {}); } catch { /* no bridge */ }
}

// ---- My IPAs (F77): the user's own IPAs, signed on the phone (native/Sources/MyIPAs.swift, library.*) ----------
//
//   await libraryCall(method, params, onEvent, native)   one library.* call ("list", "add", "pick", "options",
//                                      "sign", "install", "export", "delete")
//   await serverReachable(server)      true when <server>/sign/status answers within a few seconds
//   await installFromLibrary({ file, name, signed, onInstalled })   signed: the library already has a signed copy
//                                      Install on an IPA's page: signs if needed (offline is fine), then, with the
//                                      Signing Server reachable, installs; offline it says so and keeps the signed copy.
//                                      Resolves "installed" | "offline" | false (an error, shown) | null (walkthrough)
//                                      F241: with the Signing Server reachable the IPA page queues the file instead
//                                      (screens/myipas.js queueLibraryInstall, prepareParams's `library` above); this
//                                      stays the offline path and Sign (n)'s.

// F243: every call but options carries Keep Bundle IDs off (withKeep), so an IPA without Sign Options of its own signs,
// and counts as signed, the way Settings > Signing says; options sends the Sign Options page's own switch.
export async function libraryCall(method, params = {}, onEvent, native) {
  return bridge(native).call(`library.${method}`, method === "options" ? params : withKeep(params), onEvent);
}

export async function serverReachable(server = getServer(), { timeout = 6000, fetcher = globalThis.fetch } = {}) {
  if (globalThis.navigator && navigator.onLine === false) return false;
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const r = await fetcher(`${server}/sign/status`, { cache: "no-store", signal: ctl?.signal });
    return Boolean(r?.ok);
  } catch { return false; } finally { if (timer) clearTimeout(timer); }
}

export const offlineText = (name, server) => `${name || "The app"} is signed and kept in My IPAs. Installing needs a connection ` +
  `to the Signing Server (${hostOf(server)}), which hands iOS the install manifest. Install it again once you're online.`;

const hostOf = (server) => { try { return new URL(server).host; } catch { return String(server ?? ""); } };

export async function installFromLibrary({ file, name = "", signed = false, onInstalled = () => {} },
  { native, hud = progressHUD, alert = showAlert, go = openRoute, check = firstInstallCheck, reachable = serverReachable,
    follow = null, later = setTimeout } = {}) {
  if (await check({ native })) {
    // B39 (F177's Install Now): once Signing is ready it goes back to this IPA's page and offers this install there.
    const deps = { native, hud, alert, go, check, reachable, follow, later };
    (await import("./screens/signing.js")).rememberInstall({ name, run: () => installFromLibrary({ file, name, signed, onInstalled }, deps) });
    return null;
  }
  const server = getServer();
  // The first step the shell will report: a placeholder "Signing" put Signing, Reading, Signing on the log (user 2026-11-18).
  const h = hud(signed ? "Installing" : "Reading");
  h.onCancel?.(() => stopNative(native));
  const onEvent = (ev) => {
    if (ev?.log) h.page?.raw?.(ev.log); // B29: the shell's console lines (MyIPAs.swift install's log)
    const t = phaseLabel(ev);
    if (t) h.set(t);
  };
  const fail = async (e) => {
    if (h.cancelled) return false;
    const why = deviceError(e, name);
    failed(h, why.message);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  };
  // Sign first: nothing here needs the network, so an offline phone still ends with a signed copy.
  try { await untilCancel(h, libraryCall("sign", { file }, onEvent, native)); } catch (e) { return fail(e); }
  if (!(await untilCancel(h, reachable(server)).catch(() => false)) && !h.cancelled) {
    h.hide();
    await alert({ title: "No Connection", message: offlineText(name, server), buttons: ["OK"] });
    return "offline";
  }
  if (h.cancelled) return false;
  h.set("Installing");
  let result;
  try { result = await untilCancel(h, libraryCall("install", { file, manifestServer: server }, onEvent, native)); } catch (e) { return fail(e); }
  if (h.cancelled) return false;
  onInstalled(result);
  const followInstall = follow ?? (await import("./signing-sheet.js")).followInstall;
  if (result?.bundleId) followInstall(bridge(native), result.bundleId, h, { later, name: result.name || name, device: result.device ?? lastDevice });
  else later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return "installed";
}

// ---- the website (F93): signed in the browser ----------------------------------------------------------------
//
//   browserSigning()                   true on the website
//   await signInBrowser({ url, name, onInstalled, bring, bytes }, deps)
//       F197: `bytes` (an IPA kept in this browser, or a function answering it) is signed instead of downloading `url`.
//       the progress page (F151; was a HUD): "Downloading" (the IPA through the Worker's /api/fetch?kind=ipa: most hosts send no CORS headers),
//       "Signing" (signing-worker.js: zsign as WebAssembly, with the certificate from IndexedDB), "Uploading" (the
//       signed IPA to the Worker's /sign/upload, in parts, kept 10 minutes), then a Ready to Install alert whose
//       Install tap opens iOS's install prompt (itms-services, from the tap). F121: when the bundle ID is known at the
//       tap (expectedBundleId; `bundleId` is the app's own ID where the caller knows it), iOS's prompt opens at once
//       instead, for a link the upload fills later, and there's no alert. true once iOS was asked; false after an error, shown in an alert (zsign's own reason when
//       it can't sign the app). bring: iFizBox's own IPA carries the certificate (ifizbox-identity.plist), and always
//       the website's sources and settings (web/transfer.link): the app imports both on its first launch.
//
// The .p12, password and profile go only into the Web Worker (this browser), and with bring into iFizBox's signed
// IPA, which waits on the Worker for those 10 minutes as the old server signer's copy did.

export const browserSigning = () => detectMode() === "site";

const signFail = (code, message) => Object.assign(new Error(message), { code });

// The Web Worker, as one call: resolves the worker's answer ({ ipa, bundleId, name, version }), or throws its error.
// F188: `signal` (the progress page's Cancel) ends the worker, and zsign with it, mid-signing.
export function runInWorker(job, { make = () => new Worker(new URL("./signing-worker.js", import.meta.url), { type: "module" }), onProgress = () => {}, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signFail("cancelled", "Cancelled")); return; }
    let w;
    try { w = make(); } catch (e) { reject(signFail("unsupported", `This browser can't sign apps (${e?.message ?? e}).`)); return; }
    signal?.addEventListener?.("abort", () => { w.terminate?.(); reject(signFail("cancelled", "Cancelled")); }, { once: true });
    w.onmessage = (e) => {
      const m = e.data ?? {};
      if (m.progress) { onProgress(m.progress); return; }
      w.terminate?.();
      if (m.ok) resolve(m); else reject(signFail(m.code ?? "sign_failed", m.error ?? "Signing failed."));
    };
    w.onerror = (e) => { w.terminate?.(); reject(signFail("sign_failed", `The signer stopped: ${e?.message ?? "no reason given"}.`)); };
    const t = [job.ipa, job.p12, job.profile].filter((b) => b instanceof ArrayBuffer);
    w.postMessage(job, t);
  });
}

async function answerError(res) {
  let b = null;
  try { b = await res.json(); } catch { /* not JSON */ }
  return signFail(b?.code ?? "network", b?.error ?? `The server answered HTTP ${res.status}.`);
}

// A request that failed for want of a connection (Safari: "Load failed") is tried again, up to `tries` times with a
// pause, as phones drop a request now and then mid-upload (user 2026-11-18: an upload stopped after its second part).
// An answer from the server, even an error, is final.
async function retrying(send, { tries = 3, wait = (ms) => new Promise((r) => setTimeout(r, ms)), signal = null } = {}) {
  for (let i = 1; ; i++) {
    try { return await send(); } catch (e) {
      if (i >= tries || signal?.aborted) throw e; // F188: Cancel isn't a dropped request
      await wait(800 * i);
    }
  }
}

// The IPA's bytes through /api/fetch, the label following the download ("Downloading 40%").
// F188: `signal` (the progress page's Cancel) aborts the download.
// B87: `retrying` covers a request until its answer starts; a body that breaks off after that (Safari's bare "Load
// failed" from the reader, the first Install's error) or ends short of the Worker's X-IPA-Length is fetched once more,
// from the start. Once, because what breaks is a cold download: the first request for a release file streams from
// GitHub through Cloudflare while the edge keeps a copy (worker/src/index.js RELEASE_CACHE), and the second comes from
// that copy (user 2026-11-19: Install failed the first time, then worked). A second break says so in words.
// B95: the Worker now hands the body on untouched (it used to run out of CPU on big apps, cutting them short), so the
// cap and the length are checked only here. A body that broke off is resumed from the bytes already here (Range:
// bytes=n-, which the Worker passes on), up to CUT_TRIES times while each try brings more; an answer that isn't the
// asked-for part (200) starts again from byte 0. A try that brings nothing new ends it, in words.
// F257: up to CUT_TRIES more tries in all, whatever each brought (a big app's download may break more than once), and
// `onCut({ attempt, of, at })` before each (at: the bytes already here), for the log's "Reconnecting (try 1 of 3)".
export const CUT_TEXT = "The app's download broke off before the end. Check the connection and tap Install again.";
export const CUT_TRIES = 3;
export async function downloadIpa(url, opts = {}) {
  const got = { buf: null, n: 0 };
  for (let tries = 0; ; tries++) {
    try { return await downloadIpaOnce(url, opts, got); } catch (e) {
      if (e?.code !== "cut" || opts.signal?.aborted) throw e;
      if (tries >= CUT_TRIES) throw signFail("network", CUT_TEXT);
      try { opts.onCut?.({ attempt: tries + 1, of: CUT_TRIES, at: got.n }); } catch { /* the log only */ }
    }
  }
}

// F257: the log's lines for a resumed download (signInBrowser's onCut).
export const reconnectText = (attempt, of = CUT_TRIES) => `Reconnecting (try ${attempt} of ${of})`;
export const droppedText = (bytes) => {
  const mb = Number(bytes) / 1048576;
  return `The connection dropped at ${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB.`;
};
export const grayIconText = (app) => `If a gray ${app ? `${app} ` : ""}icon was left on your Home Screen, delete it.`;

async function downloadIpaOnce(url, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, max = IPA_MAX, wait = undefined, signal = null } = {}, got = { buf: null, n: 0 }) {
  let res;
  const init = { cache: "no-store", ...(got.n ? { headers: { Range: `bytes=${got.n}-` } } : {}), ...(signal ? { signal } : {}) };
  try { res = await retrying(() => fetcher(`${base}/api/fetch?${new URLSearchParams({ url, kind: "ipa" })}`, init), { wait, signal }); } catch {
    if (signal?.aborted) throw signFail("cancelled", "Cancelled");
    throw signFail("network", "The app couldn't be downloaded: no connection to the server.");
  }
  if (!res.ok) throw await answerError(res);
  const head = (k) => res.headers?.get?.(k);
  // a resume goes on only from the asked-for byte; anything else is the whole app again
  const resumed = got.n > 0 && res.status === 206 && Number(/^bytes (\d+)-/.exec(head("content-range") ?? "")?.[1]) === got.n;
  if (!resumed) { got.n = 0; }
  const total = Number(head("x-ipa-length") || (resumed ? 0 : head("content-length")) || 0);
  if (total > max) throw signFail("too_large", tooLargeText(total, max));
  const cut = (e) => (signal?.aborted ? signFail("cancelled", "Cancelled") : signFail("cut", `The download broke off: ${e?.message ?? e}`));
  if (!res.body?.getReader) {
    let whole;
    try { whole = new Uint8Array(await res.arrayBuffer()); } catch (e) { throw cut(e); }
    if (resumed) { const b = new Uint8Array(got.n + whole.length); b.set(got.buf.subarray(0, got.n)); b.set(whole, got.n); whole = b; }
    if (whole.length > max) throw signFail("too_large", tooLargeText(whole.length, max));
    got.buf = whole; got.n = whole.length;
    if (total && whole.length < total) throw cut(`${whole.length} of ${total} bytes`);
    return whole;
  }
  const reader = res.body.getReader();
  let buf = resumed ? got.buf : new Uint8Array(total || 1 << 20), n = resumed ? got.n : 0;
  if (resumed && total > buf.length) { const b = new Uint8Array(total); b.set(buf.subarray(0, n)); buf = b; }
  // what came stays in `got` when the body breaks off, for the next try to resume from
  const keep = () => { got.buf = buf; got.n = n; };
  for (;;) {
    if (signal?.aborted) { reader.cancel?.()?.catch?.(() => {}); throw signFail("cancelled", "Cancelled"); } // a broken body's cancel rejects
    let step;
    try { step = await reader.read(); } catch (e) { keep(); throw cut(e); }
    const { done, value } = step;
    if (done) break;
    if (n + value.length > max) { reader.cancel?.(); throw signFail("too_large", tooLargeText(0, max)); }
    if (n + value.length > buf.length) { const b = new Uint8Array(Math.max(buf.length * 2, n + value.length)); b.set(buf.subarray(0, n)); buf = b; }
    buf.set(value, n);
    n += value.length;
    if (total) onProgress(Math.min(99, Math.floor((n / total) * 100)));
  }
  keep();
  if (total && n < total) throw cut(`${n} of ${total} bytes`);
  return buf.length === n ? buf : buf.slice(0, n);
}

// The signed IPA to the Worker (POST /sign/upload, each part, done): the install link's answer { itms, ... }.
// F121: `token` uploads into the reserved early link instead of a new one.
export async function uploadSigned(bytes, { bundleId, name, version }, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, wait = undefined, token = null, signal = null } = {}) {
  const q = new URLSearchParams({ bundleid: bundleId, version: String(version || "1.0").slice(0, 64), title: String(name || bundleId).slice(0, 200), size: String(bytes.length),
    ...(token ? { token } : {}) });
  const call = async (path, init) => {
    let res;
    if (signal?.aborted) throw signFail("cancelled", "Cancelled"); // F188: no part goes up after Cancel
    try { res = await retrying(() => fetcher(`${base}${path}`, { cache: "no-store", ...init, ...(signal ? { signal } : {}) }), { wait, signal }); } catch {
      if (signal?.aborted) throw signFail("cancelled", "Cancelled");
      throw signFail("network", "The signed app couldn't be uploaded: no connection to the server.");
    }
    if (!res.ok) throw await answerError(res);
    return res.json();
  };
  const up = await call(`/sign/upload?${q}`, { method: "POST" });
  for (let i = 0; i < up.parts; i++) {
    await call(`/sign/upload/${up.token}/${i}`, { method: "PUT", body: bytes.subarray(i * up.partSize, Math.min(bytes.length, (i + 1) * up.partSize)) });
    onProgress(Math.floor(((i + 1) / up.parts) * 100));
  }
  return call(`/sign/upload/${up.token}/done`, { method: "POST" });
}

// ---- F121: Install opens iOS's install prompt inside its own tap, before signing ----------------------------------
//
// Safari opens an itms-services link only inside the user's tap, and signing outlasts it: so the link opens first,
// for a token the website makes itself (/sign/up/<token>/manifest.plist), and the Worker holds iOS's requests until
// the upload is there (app.ipa, up to 2 minutes; the manifest answers from its URL's query, the reservation just
// binds the token to the app). That needs the
// bundle ID the app will be signed as before it's downloaded: an explicit profile's, or a wildcard profile's for an
// app whose own ID is known (iFizBox's, or the caller's bundleId). Otherwise, and whenever the early link can't be
// used (another bundle ID came out, the reservation failed, it took too long), the Ready to Install alert as before.

// F132: iOS's installer retries a held app.ipa for at least 5 minutes (R14, docs/signing.md: HEAD 30 s, HEAD 30 s,
// GET 60 s, then HEAD/GET pairs), each request held up to the Worker's IPA_WAIT; so the early link stays good for
// about the upload's TTL (600 s from the reservation, worker/src/index.js), with room to spare. Past it, the alert.
export const EARLY_WINDOW = 8 * 60 * 1000;

// The bundle ID `id`'s profile signs this app as, when it's known before signing; else null.
// F237: with Keep Bundle IDs (keep), that is the app's own ID when the caller knows it (websign-job.js keeps
// iFizBox's own IPA the old way, so its prediction stays the profile's).
export function expectedBundleId(id, { url = "", bundleId = null, keep = storedKeep() } = {}) {
  // Only a password known to open the .p12: a sign that fails after iOS was sent to the link leaves iOS waiting, and
  // it gives up with "the certificate for <domain> is not valid" (user 2026-11-18). Unchecked (null, e.g. synced from
  // the account) goes the slow way: Ready to Install, or the signing error, with nothing opened.
  if (!id?.p12 || !id?.profile || id.passwordOk !== true) return null;
  try {
    const { appId } = profileInfo(id.profile instanceof Uint8Array ? id.profile : new Uint8Array(id.profile));
    if (!appId) return null;
    const own = bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null);
    if (keep && own && own !== IFIZBOX_ID) return own;
    if (keep && !own) return null; // its own ID comes with the download
    if (!appId.includes("*")) return appId;
    return own ? targetBundleId(appId, own) : null;
  } catch { return null; }
}

const hexToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
const itmsFor = (manifest) => "itms-services://?action=download-manifest&url=" + encodeURIComponent(manifest);

// The early link: { token, itms, manifest } (nothing sent yet). The manifest's URL carries the app (bundle ID,
// version, title), so the Worker answers iOS at once, before the reservation lands.
export function earlyLink(origin, { bundleId, name = "", version = "" }) {
  const q = new URLSearchParams({ bundleid: bundleId, version: String(version || "1.0").slice(0, 64), title: String(name || bundleId).slice(0, 200) });
  const token = hexToken(), manifest = `${origin}/sign/up/${token}/manifest.plist?${q}`;
  return { token, manifest, itms: itmsFor(manifest) };
}

// POST /sign/upload?token= without a size: the Worker's manifest answers from then on. true once reserved.
export async function reserveUpload(token, { bundleId, name, version }, { base = "", fetcher = globalThis.fetch, wait = undefined } = {}) {
  const q = new URLSearchParams({ bundleid: bundleId, version: String(version || "1.0").slice(0, 64), title: String(name || bundleId).slice(0, 200), token });
  try {
    const res = await retrying(() => fetcher(`${base}/sign/upload?${q}`, { method: "POST", cache: "no-store" }), { wait });
    return res.ok;
  } catch { return false; }
}

// B95: the sign failed (or was cancelled, or the app came out under another bundle ID) after iOS was sent to the early
// link: POST /sign/upload/<token>/fail, so the Worker answers iOS's held app.ipa at once instead of holding it, and
// iOS isn't left waiting on an app that never comes (a blank icon stuck on the Home Screen). Not awaited by callers
// past the alert; never throws.
export async function dropEarly(token, { base = "", fetcher = globalThis.fetch } = {}) {
  try { return (await fetcher(`${base}/sign/upload/${token}/fail`, { method: "POST", cache: "no-store" })).ok; } catch { return false; }
}
// What the failure says when iOS was sent to the early link: iOS may still show the app's icon, blank.
export const iconLeftText = (app) => `If a blank ${app ? `${app} ` : ""}icon stays on the Home Screen, press and hold it and delete it.`;

// F197: the bytes of an IPA kept in this browser (My IPAs' Choose File): a Uint8Array, ArrayBuffer or Blob, or a
// function answering one (read only after Install's tap has opened iOS's prompt).
async function keptBytes(src) {
  const v = await (typeof src === "function" ? src() : src);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && typeof v.arrayBuffer === "function") return new Uint8Array(await v.arrayBuffer());
  throw signFail("missing", "The IPA isn't kept in this browser any more: Safari may have cleared it. Add it again.");
}

// F236: the likely-cause line for watchInstall, or null (all devices, no list, an unreadable profile, or this phone
// is in it). F256: `phone` is the UDID F253's profile found (screens/signing.js storedUdid): with it the line names
// the UDID, and drops out when the profile lists it; without it (null) the website can't check.
const siteDevice = (id, phone) => deviceCheck(parseProfile(id.profile instanceof Uint8Array ? id.profile : new Uint8Array(id.profile)), phone ?? null);
export function siteCause(id, app, phone = null) {
  try { return notLandedText(app, siteDevice(id, phone)); } catch { return null; }
}
// F256: the sentence an install refuses with before signing when the stored UDID isn't in the profile (the apps'
// device_not_in_profile), or null (no UDID, in it, not limited by device, an unreadable profile).
export function siteRefusal(id, phone) {
  try {
    const c = siteDevice(id, phone);
    return c.state === "out" && c.udid ? notInProfileText(c.udid) : null;
  } catch { return null; }
}
// The UDID this browser keeps (F253), or null; screens/signing.js is loaded lazily (it imports this module).
export async function siteUdid() {
  try { return (await import("./screens/signing.js")).storedUdid(); } catch { return null; }
}

const buffer = (b) => (b instanceof Uint8Array ? b.slice().buffer : b instanceof ArrayBuffer ? b.slice(0) : new Uint8Array(b ?? []).buffer);

// ---- F257: apps too big for the website ----------------------------------------------------------------------
//
// An app whose listed size (AltStore versions[].size) is over IPA_MAX never starts on the website: Install opens the
// Too Big alert before anything downloads, and before the early link (no blank icon is left). Website only: the apps
// sign on the phone and have no such cap. An app with no listed size is checked on the download's first answer.
//
//   await tooBigAlert({ url, name, size, version, iconUrl }, deps)   "download" | "lite" | "other" | "cancel"
//     Download IPA (blue, first): the link goes into Install IPAs (core/myipas.js addSiteUrl, with what the page
//     knows), the IPA opens in Safari (it saves to Files), and when the web app is back in front Install IPAs opens
//     with that row at the top, marked new for the visit, and a note under the bar (markFresh).
//     Get <NAME> Lite: Home's Install <NAME> App (screens/home.js installApp). Other Sideloader: handOffIpa.
//   handOffIpa({ url, name })   the sideloaders' own install links (core/otherlinks.js lists their shapes): <NAME> Lite,
//     AltStore, SideStore, Feather; each downloads and signs on the phone, whatever its size.
export const TOO_BIG_TITLE = "Too Big for the Website";
export const TOO_BIG_BUTTONS = ["Download IPA", `Get ${NAME} Lite`, "Other Sideloader", "Cancel"];
const appOr = (name) => name || "This app";
export const tooBigText = (name, size) => `${appOr(name)} is ${siteMB(size)} MB. ${SITE_LIMIT_TEXT} Download the IPA and import it into ${NAME} Lite or another sideloader.`;
export const tooBigNote = (name, size) => `${appOr(name)} (${siteMB(size)} MB) is in Safari's Downloads. It's too big for the website: tap Install to hand it to ${NAME} Lite or another sideloader.`;
// the app page's footer under Details, by the red Size
export const TOO_BIG_FOOTER = `${SITE_LIMIT_TEXT} Install this one with ${NAME} Lite, or hand it to another sideloader.`;
// what the download's first answer says when no size was listed
const tooLargeText = (n, max) => (n ? `This app is ${siteMB(n)} MB. ` : `This app is over ${siteMB(max)} MB. `)
  + (max === IPA_MAX ? SITE_LIMIT_TEXT : `The website signs apps up to ${siteMB(max)} MB.`);

// Install links per sideloader, for an IPA's URL: [{ label, link }]. Feather takes only https.
export function sideloaderLinks(url, name = "") {
  const u = String(url ?? "");
  if (!/^https?:\/\//i.test(u)) return [];
  const e = encodeURIComponent(u);
  const out = [
    { label: `${NAME} Lite`, link: `${NAME.toLowerCase()}://install?url=${e}${name ? `&name=${encodeURIComponent(name)}` : ""}` },
    { label: "AltStore", link: `altstore://install?url=${e}` },
    { label: "SideStore", link: `sidestore://install?url=${e}` },
  ];
  if (/^https:\/\//i.test(u)) out.push({ label: "Feather", link: `feather://install/${u}` });
  return out;
}

export async function handOffIpa({ url, name = "" }, { sheet = showActionSheet, open = (u) => { location.href = u; } } = {}) {
  const links = sideloaderLinks(url, name);
  if (!links.length) return null;
  const i = await sheet({ title: name ? `Install ${name} With` : "Install With", buttons: links.map((l) => l.label) });
  if (i < 0 || !links[i]) return null;
  open(links[i].link);
  return links[i].label;
}

// fn() once the page is back in front after it was left (Safari's download took over), at most once.
export function whenBack(fn, doc = globalThis.document) {
  if (!doc?.addEventListener) return () => {};
  let left = false;
  const off = () => doc.removeEventListener("visibilitychange", on);
  function on() {
    if (doc.visibilityState === "hidden") { left = true; return; }
    if (doc.visibilityState === "visible" && left) { off(); fn(); }
  }
  doc.addEventListener("visibilitychange", on);
  return off;
}

export async function tooBigAlert({ url, name = "", size = 0, version = "", iconUrl = null },
  { alert = showAlert, open = (u) => globalThis.open?.(u, "_blank", "noopener"), storage = globalThis.localStorage, back = whenBack,
    go = (path) => { location.hash = format({ tab: "installed", path }).replace(/^#/, ""); },
    lite = async () => (await import("./screens/home.js")).installApp(), handoff = handOffIpa } = {}) {
  let entry = null;
  // Download IPA opens the file from the tap itself (Safari opens a new page only inside the user's tap)
  const onTap = (i) => {
    if (i !== 0) return;
    try { entry = addSiteUrl(storage, url, Date.now(), { name, version, size, iconUrl }); } catch { entry = null; }
    if (entry) {
      markFresh(entry.file, tooBigNote(name || entry.name, size));
      back(() => go([MYIPAS]));
    }
    open(url);
  };
  const { index } = await alert({ title: TOO_BIG_TITLE, message: tooBigText(name, size), buttons: TOO_BIG_BUTTONS, cancel: 3,
    colors: { 0: "blue" }, onTap });
  if (index === 0) return "download";
  if (index === 1) { await Promise.resolve().then(lite).catch(() => {}); return "lite"; }
  if (index === 2) { await Promise.resolve().then(() => handoff({ url, name })).catch(() => {}); return "other"; }
  return "cancel";
}

export async function signInBrowser({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null },
  { hud = progressHUD, alert = showAlert, open = (u) => { location.href = u; }, go = openRoute,
    identity = loadIdentity, fetcher = globalThis.fetch, worker = runInWorker, transfer = websiteTransfer, base = "",
    now = identityNow, origin = () => new URL(base || "/", globalThis.location?.href).origin, clock = Date.now,
    watch = watchInstall, phone = siteUdid, tooBig = tooBigAlert } = {}) {
  // F257: a listed size over the cap: the Too Big alert, before the early link or any download
  if (!bytes && url && overSiteLimit(size)) {
    await tooBig({ url, name, size, version, iconUrl }, { alert });
    return false;
  }
  // F121: before anything waits, while Safari still counts this as the user's tap: iOS's install prompt, for a link
  // whose app comes later. Only when the bundle ID it will be signed as is known now (expectedBundleId).
  const expected = expectedBundleId(now(), { url, bundleId });
  let early = null;
  if (expected) {
    try {
      early = { ...earlyLink(origin(), { bundleId: expected, name, version }), bundleId: expected, at: clock() };
      open(early.itms);
    } catch { early = null; }
  }
  const reserved = early ? reserveUpload(early.token, { bundleId: expected, name: name || expected, version }, { base, fetcher }) : null;
  // B95: the early link dropped once it can't get this app; `intoEarly` is set when the upload goes into it
  let intoEarly = false;
  const opened = Boolean(early); // iOS was sent to a link: the failure text says what to do with its icon
  const drop =() => { if (early && !intoEarly) { const t = early.token; early = null; return dropEarly(t, { base, fetcher }); } return null; };
  const id = await identity();
  if (!id?.p12 || !id?.profile) {
    drop();
    await alert({ title: "No Certificate", message: "Add your certificate, its password and provisioning profile in Settings > Signing.", buttons: ["OK"] });
    (await import("./screens/signing.js")).rememberInstall({ name, run: () => signAndInstall({ url, name, onInstalled, bring, bundleId, version, bytes }) }); // F177
    go(["signing"]);
    return false;
  }
  // F256: the UDID F253's profile found, checked against the profile before anything downloads or signs
  const me = await Promise.resolve().then(phone).catch(() => null);
  const refusal = siteRefusal(id, me);
  if (refusal) {
    drop();
    await alert({ title: "iPhone Not in Profile", message: refusal + (opened ? `\n\n${iconLeftText(name)}` : ""), buttons: ["OK"] });
    return false;
  }
  const h = hud(bytes ? "Reading" : "Downloading");
  const pct = (label) => (p) => h.set(`${label} ${p}%`);
  const signal = h.signal ?? null; // F188: the page's Cancel stops the download, the signer and the upload
  let cutOnce = false; // F257: the download was resumed at least once (the log said so)
  try {
    const ipa = bytes ? await untilCancel(h, keptBytes(bytes))
      : await untilCancel(h, downloadIpa(url, { base, fetcher, onProgress: pct("Downloading"), onCut: ({ attempt, at }) => {
        cutOnce = true;
        h.page?.raw?.(droppedText(at)); // F257: grey, then the step
        h.set(reconnectText(attempt));
      }, ...(signal ? { signal } : {}) }));
    h.set("Signing");
    const self = isSelfIpa(url) || bring;
    const carry = self ? { identity: Boolean(bring), transfer: await transfer().catch(() => null) } : null;
    const signed = await untilCancel(h, worker({ ipa: buffer(ipa), p12: buffer(id.p12), profile: buffer(id.profile), password: id.password ?? "", bring: carry,
        appBundleId: bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null), ...withKeep({}) },
      { onProgress: (t) => h.set(t), ...(signal ? { signal } : {}) }));
    h.set("Uploading");
    const ipaBytes = signed.ipa instanceof Uint8Array ? signed.ipa : new Uint8Array(signed.ipa);
    // the early link takes this app only if it came out with the reserved bundle ID (iOS already has its manifest)
    intoEarly = Boolean(early && signed.bundleId === early.bundleId && (await reserved));
    if (!intoEarly) drop(); // the Ready to Install alert's own link follows
    const body =await untilCancel(h, uploadSigned(ipaBytes, signed, { base, fetcher, onProgress: pct("Uploading"), token: intoEarly ? early.token : null,
      ...(signal ? { signal } : {}) }));
    if (h.cancelled) return false;
    onInstalled({ ...body, bundleId: signed.bundleId, name: signed.name, version: signed.version });
    const app = name || signed.name || "The app";
    if (intoEarly && clock() - early.at < EARLY_WINDOW) {
      // iOS's prompt was asked for at the tap and its download now gets the app: nothing more to tap here.
      // F190: the log follows iOS's requests on the link from here (watchInstall); not awaited past its first look.
      await watch(early.token, h, { base, fetcher, app: name || signed.name, itms: early.itms, open, alert,
        cause: siteCause(id, name || signed.name, me) }).first;
      return true;
    }
    h.hide();
    // The install link opens from the alert's Install tap (onTap runs inside the click): opened by script long after
    // the first tap, Safari asked "Open this page in iTunes?" first, or refused it as an invalid address.
    // F121: also the fallback when the early link couldn't be used, or iOS may have given up waiting for it.
    const { index } = await alert({ title: "Ready to Install", message: `${app} is signed. Tap Install, then Install again when iOS asks.`,
      buttons: ["Cancel", "Install"], cancel: 0, onTap: (i) => { if (i === 1) open(body.itms); } });
    return index === 1;
  } catch (e) {
    drop();
    if (h.cancelled) return false; // F188: Cancel closed the page; no alert after it
    failed(h, String(e?.message ?? e));
    // F257: the download broke off past its last try: under the red error, what to do with iOS's icon (only once iOS
    // was sent to the early link: no icon can be left otherwise)
    if (cutOnce && e?.message === CUT_TEXT && opened) h.page?.warning?.(grayIconText(name));
    const message = String(e?.message ?? e) + (opened ? `\n\n${iconLeftText(name)}` : "");
    await alert({ title: name ? `Couldn't Install ${name}` : "Couldn't Install", message, buttons: ["OK"] });
    return false;
  }
}

// ---- F190: what iOS does after "Installing" -------------------------------------------------------------------
//
// Safari never hears back from itms-services, but the Worker sees iOS's own requests on the link and keeps them per
// token: GET /sign/up/<token>/status -> { manifest, started, finished } (worker/src/index.js). watchInstall polls it
// every `every` ms (KV reads are cheap; only the Worker's 3 marks are writes) and the progress page steps through
// installSteps, each shown at least `minShow` ms so a fast install still reads as steps. If iOS hasn't begun the
// download `askWithin` ms in, it says so and offers Retry (the itms link again, from that tap). The final install
// happens on the Home Screen, which Safari can't see: the last step says so.
//
//   const w = watchInstall(token, hud, { base, fetcher, app, itms, open, alert })
//   await w.first   after the first look: a Worker without /status (or no answer) ends the page on "Installing"
//   await w.end     "installed" (downloaded) | "not_asked" | "unknown" | "closed" | "timeout"

export const STATUS_EVERY = 500, STATUS_MIN_SHOW = 400, STATUS_ASK_WITHIN = 60 * 1000;

// The log's steps in order, and how far a status got: 0 waiting, 1 downloading, 2 downloaded.
export const installSteps = (app) => [
  "Waiting for iOS…",
  "iOS is asking: tap Install.",
  `iOS is installing ${app || "the app"}. Press Home to watch it on the Home Screen.`,
];
// The page completes once iOS starts the download (Cydia's Complete, Return under it): Safari can't see the rest, and
// "iOS is downloading…" left people waiting on a page with nothing more to show (user 2026-11-18).
export const installStage = (s) => (s?.finished || s?.started ? 2 : s?.manifest ? 1 : 0);
export const notAskedText = "iOS didn't ask for the app. Tap Install again.";

// F236: `cause` (core/signing.js notLandedText: the website can't read this iPhone's UDID) is added under the last step
// once iOS has the app, and when it never fetches it, so an install that doesn't land names the likely cause first.
export function watchInstall(token, h, { base = "", fetcher = globalThis.fetch, app = "", itms = "", open = () => {}, alert = showAlert,
  cause = null, every = STATUS_EVERY, minShow = STATUS_MIN_SHOW, askWithin = STATUS_ASK_WITHIN, upTo = EARLY_WINDOW,
  clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const steps = installSteps(app), t0 = clock();
  let shown = -1, shownAt = 0, firstDone;
  const first = new Promise((r) => { firstDone = r; });
  const look = async () => {
    try {
      const res = await fetcher(`${base}/sign/up/${token}/status`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const show = async (stage) => { // each step in turn up to `stage`, none for less than minShow
    while (shown < stage) {
      if (shown >= 0) { const left = minShow - (clock() - shownAt); if (left > 0) await sleep(left); }
      shown++;
      h.set(steps[shown]);
      shownAt = clock();
    }
  };
  const closed = () => Boolean(h.page?.closed);
  const end = (async () => {
    let s = await look();
    if (!s) { // a Worker without /status: as before F190
      if (h.done) h.done("Installing"); else h.hide();
      firstDone();
      return "unknown";
    }
    await show(installStage(s));
    firstDone();
    for (;;) {
      if (closed()) return "closed";
      if (installStage(s) === 2) {
        const left = minShow - (clock() - shownAt);
        if (left > 0) await sleep(left);
        if (cause) h.page?.line?.("warning", cause);
        if (h.done) h.done(steps[2]); else h.hide();
        return "installed";
      }
      if (!s.started && clock() - t0 >= askWithin) {
        if (h.finish) {
          h.set(notAskedText);
          h.finish({ label: "Retry", status: notAskedText, action: () => { open(itms); return true; } });
        } else {
          h.hide();
          await alert({ title: "Not Installed", message: notAskedText, buttons: ["Cancel", "Install"], cancel: 0,
            onTap: (i) => { if (i === 1) open(itms); } });
        }
        return "not_asked";
      }
      if (clock() - t0 >= upTo) {
        if (cause) h.page?.line?.("warning", cause);
        if (h.done) h.done(steps[shown]); else h.hide();
        return "timeout";
      }
      await sleep(every);
      s = (await look()) ?? s; // a missed look keeps the last answer
      await show(installStage(s));
    }
  })().catch(() => "unknown").finally(() => firstDone());
  return { first, end };
}

// What iFizBox's own IPA carries for its first launch: the website's sources and settings (Send Settings' link).
async function websiteTransfer() {
  const [{ websitePayload }, { encodeLink }] = await Promise.all([import("./screens/importlink.js"), import("./core/transfer.js")]);
  return encodeLink(await websitePayload({ identity: false })); // the certificate goes as ifizbox-identity.plist (bring)
}

// ---- F260: the password checked by the signer itself ----------------------------------------------------------
//
// The early link (F121) opens only for a password known to open the .p12 (passwordOk true, expectedBundleId). The
// page's own check (core/signing.js checkP12Password) answers null for a .p12 it can't read (no MAC, BER, another
// hash), and synced or seeded identities (account.js) and older ones come with passwordOk unset: all of those went
// the Ready to Install way. So the website asks zsign in the Web Worker (websign-job.js runPasswordCheck) whenever a
// save leaves a .p12, a profile and a password not yet known right or wrong (Settings > Signing, the account's sync),
// and once when this module loads, and saves its answer. A Settings page in view repaints its Password row on
// PASSWORD_EVENT (window).
//
//   await checkPasswordInWorker({ p12, password, profile }, { worker })   true | false | null (unknown)
//   await confirmPassword({ identity, save, check, notify })              the passwordOk it saved, or null
//   confirmSoon(delay)                                                    confirmPassword after a pause, one at a time
//                                                                         (no-op where there's no Worker: node, tests)
export const PASSWORD_EVENT = "ifizbox:password";
export const needsConfirm = (id) => Boolean(id?.p12 && id?.profile && id.passwordOk !== true && id.passwordOk !== false);

const bytesOf = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b ?? []));
const sameBytes = (a, b) => {
  const x = bytesOf(a), y = bytesOf(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export async function checkPasswordInWorker({ p12, password = "", profile }, { worker = runInWorker } = {}) {
  const m = await worker({ check: "password", p12: buffer(p12), profile: buffer(profile), password: password ?? "" });
  return typeof m?.passwordOk === "boolean" ? m.passwordOk : null;
}

function notifyPassword() {
  try { globalThis.dispatchEvent?.(new Event(PASSWORD_EVENT)); } catch { /* no window */ }
}

// The last answer zsign gave, so saves of the same files (Settings rechecks after each) don't run it again.
let lastCheck = null;
export async function confirmPassword({ identity = loadIdentity, save = saveIdentity, check = checkPasswordInWorker, notify = notifyPassword } = {}) {
  const id = await identity();
  if (!needsConfirm(id)) return null;
  const password = id.password ?? ""; // none saved: a .p12 without one opens with ""
  const same = (o) => Boolean(o && sameBytes(o.p12, id.p12) && sameBytes(o.profile, id.profile) && (o.password ?? "") === password);
  let ok = same(lastCheck) ? lastCheck.ok : null;
  if (ok === null) {
    try { ok = await check({ p12: id.p12, password, profile: id.profile }); } catch { ok = null; }
    if (typeof ok !== "boolean") return null;
    lastCheck = { p12: id.p12, profile: id.profile, password, ok };
  }
  if (!ok && id.password == null) return null; // nobody typed one: the Password row keeps asking, not "wrong"
  const now = await identity(); // typed over, picked again or checked meanwhile: that wins
  if (!needsConfirm(now) || !same(now) || (now.password == null) !== (id.password == null)) return null;
  await save(ok && id.password == null ? { password: "", passwordOk: true } : { passwordOk: ok });
  notify();
  return ok;
}

let confirmTimer = null, confirming = false, confirmAgain = false;
export function confirmSoon(delay = 300) {
  if (typeof globalThis.Worker !== "function" || !browserSigning()) return;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(function run() {
    if (confirming) { confirmAgain = true; return; }
    confirming = true;
    confirmPassword().catch(() => null).finally(() => {
      confirming = false;
      if (confirmAgain) { confirmAgain = false; run(); }
    });
  }, delay);
}

// F121: Install's tap needs the profile at once (identityNow), so the website reads it as soon as this module loads.
// F260: and has the signer check a password nobody checked yet (passwordOk unset), so Install's tap finds it true.
if (browserSigning() && globalThis.indexedDB) loadIdentity().then((id) => { if (needsConfirm(id)) confirmSoon(0); }).catch(() => {});
