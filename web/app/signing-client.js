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
import { APP_SERVER, LEGACY_SERVER, normalizeServer, toBase64, phaseLabel, deviceError, parseProfile, deviceCheck, notLandedText, notInProfileText, SENT_TO_IOS } from "./core/signing.js";
import { openAppHelp } from "./screens/guides.js";
import { format, settingsRoute } from "./router.js";
import { IPA_MAX, IFIZBOX_ID, profileInfo, targetBundleId, siteMB, SITE_LIMIT_TEXT, overSiteLimit,
  memoryLimit, noteOutOfMemory, noteSigned, overMemoryLimit, isOutOfMemory } from "./core/websign.js";
import { addSiteUrl, markFresh, MYIPAS } from "./core/myipas.js";
import { showActionSheet } from "./nav/actionsheet.js";
import { storedKeep, withKeep, originalState, originalNote } from "./core/keepid.js";
import { detectMode } from "./core/settings.js";
import { progressHUD, lockSelfUpdate, unlockSelfUpdate, TRY_AGAIN_LABEL, WAITING_LABEL, CLOSING_LABEL, CLOSE_GRACE,
  CLOSE_BY_HAND, RESTART_BY_HAND, RETURN_LABEL } from "./nav/progress.js";
import { recordSelfUpdate } from "./core/selfupdate.js";
import { showAlert } from "./nav/alert.js";
import { NAME, GITHUB_REPO } from "./brand.js";
import { storedRoute, decideRoute, ALERTS as ROUTE_ALERTS, routeParams, VPN_POLL, VPN_WAIT, VPN_CONNECTED, vpnReady } from "./core/installroute.js";
import { SELF_RESTART } from "./core/apprun.js";
import { INSECURE_IPA_ALERT, INSTALL_ANYWAY, isInsecure } from "./core/insecureipa.js";
import { rememberSigned, malwareHashes } from "./core/malicious.js";

// B104: a bridge call that downloads an IPA (signing.install, signing.prepare, signing.inspect, library.add), sent by
// `send(extra)`. For an http link the shell tries the https twin first; when there is none it answers "insecure", and
// INSECURE_IPA_ALERT asks: Install Anyway sends it again with { insecure: true } (the shell's plain-http download),
// Cancel rejects with code "cancelled", as the progress page's own Cancel does. Any other answer passes through.
// `url` is the link: one the user let through in this session goes straight to http (Custom Install's look, then the
// queue's signing.prepare of the same link, asks once).
const httpAllowed = new Set();
export async function askInsecure(send, { alert = showAlert, url = null } = {}) {
  if (url && httpAllowed.has(url)) return send({ insecure: true });
  try {
    return await send({});
  } catch (e) {
    if (!isInsecure(e)) throw e;
    if ((await alert(INSECURE_IPA_ALERT))?.index !== INSTALL_ANYWAY) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
    if (url) httpAllowed.add(url);
    return send({ insecure: true });
  }
}

// F292: the IPA's SHA-256, as a signer answered it (the shell's signing.install / signing.prepare, the website's
// worker), kept for Report as Malicious under the app page's ID and version (`asked`: the caller's) and the IPA's own.
// The signers refuse a hash from MALWARE_IPAS before signing (refuseSha256), with code "malware".
export const KNOWN_MALWARE = "Known Malware";
// { refuseSha256 } for a signer, only while MALWARE_IPAS lists a hash (a call stays as it was otherwise)
export const refusing = () => { const h = malwareHashes(); return h.length ? { refuseSha256: h } : {}; };
export function keepIpaHash(storage, result, asked = {}) {
  if (!result?.sha256) return;
  rememberSigned(storage, { sha256: result.sha256,
    ids: [asked.bundleId, result.originalBundleId, result.originalId, result.bundleId],
    versions: [asked.version, result.version] });
}

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

// F291: screens/safety.js installSafety for one app; a check that fails to load or throws never blocks an install.
async function safetyFirst({ url, name, bundleId, version, source = null }) {
  try {
    const { installSafety } = await import("./screens/safety.js");
    return await installSafety([{ id: bundleId || url, bundleId, name, version, url, source }]);
  } catch { return true; }
}

// Signs `url` (an IPA) on the phone and installs it. Resolves true once iOS was asked to install; false after an
// error, which it shows in an alert; false in the jailbreak app (its pages use the helper, so this is only a guard).
// F93: on the website, signs it in the browser (signInBrowser); `bring` (Install iFizBox App) carries the certificate.
// F257: `size` (the source's listed size) and `iconUrl` are the website's: an app over its cap opens the Too Big alert.
export async function signAndInstall({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null }) {
  // F291: Known Malware refuses, a reported version asks, the exploitable-iOS alert once (screens/safety.js)
  if (!isSelfIpa(url) && !(await safetyFirst({ url, name, bundleId, version }))) return false;
  if (browserSigning()) return signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl });
  if (!localSigning()) {
    await showAlert({ title: "Can't Install Here", message: `Apps are signed in the ${NAME} app. Open this one in ${NAME}, AltStore, SideStore or Feather.`, buttons: ["OK"] });
    return false;
  }
  // iFizBox's own IPA: signed here on the phone like any app, then hosted on the Signing Server (host: true) since
  // iOS closes iFizBox, and its install server, while it installs over it. Straight to iOS's Install prompt.
  if (isSelfIpa(url)) return installOnDevice({ url, name: name || NAME, onInstalled, host: true });
  // F75: the first Install with something missing says so, then opens the Signing walkthrough at that step.
  const step = await firstInstallCheck();
  if (step === "cancel") return false;
  if (step) {
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
//   await firstInstallCheck()          F75: the walkthrough's missing step ("certificate" | "server"), opened after a
//                                      Set Up Signing alert ("cancel" when the user didn't), or null
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
// doesn't carry one (My IPAs): followInstall's help line when it came out "unknown".
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
export async function firstInstallCheck({ native, server = getServer(), go = openRoute, wait = sleep, from = here(), alert = showAlert } = {}) {
  const { missingStep, openAt, rememberReturn } = await import("./screens/signing.js");
  const step = missingStep(await readyStatus(native, wait), server);
  if (!step) return null;
  // Say why before leaving the page: Signing opens only on Set Up.
  const { index } = await alert({ title: "Set Up Signing", message: SETUP_WHY[step] ?? SETUP_WHY.certificate, buttons: ["Cancel", "Set Up"], cancel: 0 });
  if (index !== 1) return "cancel"; // truthy: Install stops; callers don't keep an Install Now for it
  openAt(step);
  rememberReturn(from);
  go(["signing"]);
  return step;
}

const SETUP_WHY = {
  certificate: `${NAME} signs apps with your own certificate before iOS will install them. Add your certificate (.p12) and its provisioning profile first.`,
  server: `${NAME} needs a Signing Server to hand the signed app to iOS. Choose one first.`,
};
const here = () => globalThis.location?.hash ?? "";
// B39: every trip to Settings > Signing from a page (a missing certificate or server) comes back to that page once
// signing is ready (screens/signing.js offerInstall), not to Home's stack.
const openRoute = (path) => {
  const from = here();
  import("./screens/signing.js").then((m) => m.rememberReturn(from)).catch(() => {});
  location.hash = format(settingsRoute(path)).replace(/^#/, "");
};
export const openSigning = () => openRoute(["signing"]);

// ---- Settings > Installation's route (core/installroute.js) -----------------------------------------------------
// The bridge params one install adds for the chosen route: { route: "idevice" } (This iPhone, LocalDevVPN on and
// paired), {} (the Signing Server), or null when the install was cancelled. When This iPhone can't be used, an alert
// says the install goes through the server. A run of installs (the IPA queue, Re-sign All) asks once: the answer
// holds for ROUTE_HOLD ms.
// B110: Open LocalDevVPN in that alert keeps the install waiting (waitForVPN): a progress page "Waiting for
// LocalDevVPN…" with Cancel (`hud`), or, with a `signal` (the IPA queue's row), no page of its own: onWait(text) says
// it on the run's page and the run's Cancel aborts the signal. Once connected it goes on through This iPhone; null
// only after Cancel.
export const ROUTE_HOLD = 60_000;
let heldRoute = null;
export async function chooseRoute({ native, alert = showAlert, storage = storageOf(), now = Date.now, hud = progressHUD,
  signal = null, onWait = null, wait = waitForVPN, later = setTimeout } = {}) {
  const choice = storedRoute(storage);
  if (choice !== "iphone") return {};
  if (heldRoute && now() - heldRoute.at < ROUTE_HOLD) return heldRoute.params;
  let status = null;
  try { status = await bridge(native).call("idevice.status", {}); } catch { status = null; }
  const d = decideRoute(choice, status);
  if (d.alert) {
    const a = ROUTE_ALERTS[d.alert];
    const { index } = await alert({ title: a.title, message: a.message, buttons: a.buttons, cancel: 0 });
    if (a.open != null && index === a.open) {
      try { await bridge(native).call("idevice.openLocalDevVPN", {}); } catch { /* nothing to open: the alert said what to do */ }
      heldRoute = null;
      if (!(await waitVPN({ native, hud, signal, onWait, wait, later }))) return null;
      const params = routeParams({ route: "idevice" });
      heldRoute = { at: now(), params };
      return params;
    }
  }
  const params = routeParams(d);
  heldRoute = { at: now(), params };
  return params;
}
export const forgetRoute = () => { heldRoute = null; };

// B110: the wait itself. Its own page ends a tick after the answer, so the install's next step (a HUD opened at once)
// carries on on the same page instead of it showing Complete first. -> true once connected.
async function waitVPN({ native, hud, signal, onWait, wait, later }) {
  if (signal) {
    try { onWait?.(VPN_WAIT); } catch { /* only words */ }
    return wait({ native, signal });
  }
  const h = hud(VPN_WAIT);
  const ok = await wait({ native, signal: h.signal ?? null });
  if (!ok || h.cancelled) return false;
  later(() => h.done(VPN_CONNECTED), 0);
  return true;
}

// B110: resolves true once idevice.status says this iPhone is paired with LocalDevVPN on (core/installroute.js
// vpnReady), false when `signal` aborts. It asks every `every` ms and at once when the app comes back to the
// foreground (visibilitychange); a failed call counts as not yet.
export function waitForVPN({ native, signal = null, every = VPN_POLL, later = setTimeout, clear = clearTimeout, doc = globalThis.document } = {}) {
  return new Promise((resolve) => {
    let timer = null, busy = false, over = false;
    const onShow = () => { if (doc?.visibilityState !== "hidden") check(); };
    const onAbort = () => finish(false);
    function finish(ok) {
      if (over) return;
      over = true;
      if (timer != null) clear(timer);
      timer = null;
      doc?.removeEventListener?.("visibilitychange", onShow);
      signal?.removeEventListener?.("abort", onAbort);
      resolve(ok);
    }
    async function check() {
      if (over || busy) return;
      busy = true;
      let st = null;
      try { st = await bridge(native).call("idevice.status", {}); } catch { st = null; }
      busy = false;
      if (!over && vpnReady(st)) finish(true);
    }
    function tick() {
      timer = null;
      check().finally(() => { if (!over) timer = later(tick, every); });
    }
    if (signal?.aborted) { finish(false); return; }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    doc?.addEventListener?.("visibilitychange", onShow);
    timer = later(tick, every);
  });
}

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
  forgetRoute();
  const route = await chooseRoute({ native, alert });
  if (!route) return false;
  // This iPhone: installd puts the app (iFizBox too) in place itself, so no Signing Server and no hosting.
  const self = isSelfIpa(url) || host; // iFizBox itself, whichever route
  if (route.route) host = false;
  const h = hud("Downloading");
  h.onCancel?.(() => stopNative(native));
  let lastHere = null;
  let result;
  try {
    // manifestServer: the signing server hands iOS the manifest while iFizBox serves the IPA over plain HTTP at
    // 127.0.0.1 (nothing to set up on the phone; the server sees only the app's ID, version and name).
    result = await untilCancel(h, askInsecure((extra) => bridge(native).call("signing.install", { ...withKeep(params ?? { url }), manifestServer: getServer(), ...refusing(), ...(host ? { host: true } : {}), ...route, ...extra }, (ev) => {
      if (ev?.log) h.page?.raw?.(ev.log); // the shell's console lines (Sideload.swift install's log)
      // B111: This iPhone: the copy's and installd's own percents ({here}), not the overall "Installing on this iPhone"
      const here = route.route ? hereLabel(ev) : null;
      if (here) {
        if (ev.here !== lastHere) {
          lastHere = ev.here;
          if (ev.here === "installing" && self) h.page?.step?.(SELF_RESTART);
        }
        h.set(here.label);
        return;
      }
      if (route.route && lastHere && ev?.phase === "here") return; // a newer shell sends both: {here} wins
      const t = phaseLabel(ev);
      if (t) h.set(t);
    }), { alert, url: params ? null : url }));
  } catch (e) {
    if (h.cancelled) return false;
    if (e?.code === "cancelled") { h.hide(); return false; } // B104: Cancel on This Download Is Not Secure
    const why = deviceError(e, name);
    failed(h, why.message);
    await alert({ title: e?.code === "malware" ? KNOWN_MALWARE : why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  }
  keepIpaHash(storageOf(), result, { bundleId: params?.bundleId ?? null }); // F292
  if (h.cancelled) return false;
  if (route.route && !self && result?.bundleId !== IFIZBOX_ID) {
    // B111: This iPhone answers once installd has the app: no iOS prompt to follow, so Installed and Open <app>
    onInstalled(result);
    finishHere(h, result, { native, name, later });
    return true;
  }
  if (route.route) {
    // B123: This iPhone, iFizBox itself: installd ends iFizBox while it installs over it, so an answer means it
    // didn't. The new version is in place: say to close it by hand (no locked "Closing" that never closes)
    onInstalled(result);
    if (typeof h.finish === "function") {
      // B159: unless the shell answered because installd stood waiting for it, and is closing itself now
      if (await followHereSelf(h, { native, later })) return true;
      h.page?.step?.(RESTART_BY_HAND);
      h.finish({ label: RETURN_LABEL, status: "Installed" });
    } else later(() => (h.done ? h.done("Done") : h.hide()), 1200);
    return true;
  }
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
    // B150: the caller's name (the source's, as the app was picked) before the IPA's own
    followInstall(bridge(native), result.bundleId, h, { later, name: shownName(name, result), device: result.device ?? lastDevice });
    return true;
  }
  // B49: iFizBox itself: the page ends locked on "Closing iFizBox" (no Close to tap) until iOS closes the app.
  // B83: the shell closes it only once iOS has the whole IPA; the page follows that, and offers Try Again if iOS
  // never took it. The version is kept so the next launch can tell it didn't land.
  if (host || isSelfIpa(url) || result?.bundleId === IFIZBOX_ID) {
    if (host) recordSelfUpdate(storageOf(), result?.version);
    // B123: hosted, "Waiting for iOS" until the shell says it is closing
    lockSelfUpdate(h, { later, ...(host ? { label: WAITING_LABEL } : {}) });
    if (host) followSelfUpdate(h, { native, waiting: true, later, retry: () => installOnDevice({ url, name, onInstalled, params, after, host }, { native, hud, alert, go, later, follow }) });
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
// B123: `waiting` (the page was locked on WAITING_LABEL): finished or guessed turn it to CLOSING_LABEL, and if iFizBox
// is still here CLOSE_GRACE later, or the shell can't be followed (older shell, none running), the page unlocks with
// CLOSE_BY_HAND. Without it, B83's behaviour (the caller's CLOSING_LABEL lock stays).
export async function followSelfUpdate(h, { native, retry = null, waiting = false, later = setTimeout } = {}) {
  let closing = false;
  const byHand = () => {
    if (h?.page?.closed || typeof h?.finish !== "function") return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  };
  const close = () => {
    if (closing || !waiting || typeof h?.finish !== "function") return;
    closing = true;
    h.finish({ label: CLOSING_LABEL, status: "Done", locked: true });
    later(byHand, CLOSE_GRACE);
  };
  let last = null;
  const say = (s) => {
    if (s === "finished" || s === "guessed") close();
    if (s && s !== last && SELF_UPDATE_LINES[s]) { last = s; h?.page?.step?.(SELF_UPDATE_LINES[s]); }
  };
  const s = await watchSelfUpdate(say, native);
  say(s);
  if (SELF_UPDATE_FAILED[s]) unlockSelfUpdate(h, { message: SELF_UPDATE_FAILED[s], retry });
  else if (waiting && !s) byHand();
  return s;
}

// B159: This iPhone, iFizBox itself: on iOS 17.4+ installd waits for the running copy to go instead of ending it, so
// the shell answers the install once installd stands still and then closes itself (native CloseForUpdate.hereReady,
// signing.selfUpdate "finished"). Then the page locks on "Closing iFizBox" with the shell's line, as the hosted route
// does, and says to close it by hand if iFizBox is still here CLOSE_GRACE later. -> true when it is closing; false
// (installd answered while iFizBox lived, or an older shell) leaves the caller's "close it by hand" end.
export const HERE_CLOSING_LINE = `iOS has the new ${NAME} and is waiting for this one to close. Closing so it can finish installing it`;
export async function followHereSelf(h, { native, later = setTimeout } = {}) {
  const s = await watchSelfUpdate(() => {}, native);
  if (s !== "finished" || typeof h?.finish !== "function") return false;
  h.page?.step?.(HERE_CLOSING_LINE);
  h.finish({ label: CLOSING_LABEL, status: "Done", locked: true });
  later(() => {
    if (h?.page?.closed) return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  }, CLOSE_GRACE);
  return true;
}

// B123: signing.selfUpdate's states as they come (onState(state)) -> the last one, or null (an older shell without the
// call, or no self-update running)
export async function watchSelfUpdate(onState = () => {}, native) {
  let r;
  try { r = await bridge(native).call("signing.selfUpdate", {}, (ev) => { if (ev?.state) onState(ev.state); }); } catch { return null; }
  return r?.state ?? null;
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
//                                      B146: on the prompt route installed is true or null (Sent to iOS), never false
//                                      unless dismissed; This iPhone's installd answer is passed as it is
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

export async function prepareOnDevice(job, { tag, signal = null, progress = () => {}, log = () => {}, native, alert = showAlert } = {}) {
  let params = prepareParams(job);
  // F302a: the app's kept tweaks go with a plain install, an update and a tweak update (screens/tweaks.js), a line each
  try { params = await (await import("./screens/tweaks.js")).keptTweakParams(params, job, { log }); } catch (e) {
    throw Object.assign(new Error(`Can't inject the tweaks: ${String(e?.message ?? e)}`), { code: "tweaks" });
  }
  try {
    // B104: an http link with no https twin asks first (askInsecure); Cancel ends the row as its stop does
    const r = await askInsecure((extra) => abortable(native, "signing.prepare", { ...params, ...refusing(), ...extra }, (ev) => {
      if (ev?.log) { log(ev.log); return; }
      // B152: the signer's own phase (reading, signing) goes along, so the run gives each its share of Signing
      if (ev?.phase) progress(ev.phase === "downloading" ? "downloading" : "signing", Number(ev.progress) || 0, ev.phase);
    }, { tag, signal }), { alert, url: params?.url ?? null });
    keepIpaHash(storageOf(), r, { bundleId: job?.bundleId ?? (typeof job?.id === "string" && !job.id.startsWith("library:") ? job.id : null), version: job?.version ?? null }); // F292
    return r;
  } catch (e) {
    // F302a: an App Store copy: remembered, so Add to App lists it under Can't Take Tweaks
    if (e?.code === "encrypted" && typeof job?.id === "string" && !job.id.startsWith("library:")) {
      import("./screens/tweaks.js").then((t) => t.markEncrypted(job.id), () => {});
    }
    throw rowError(e, job?.name || job?.id || "");
  }
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
    // B110: Open LocalDevVPN keeps this row (and so the queue, which installs one at a time) waiting on the run's page
    // ("vpn": core/apprun.js says "Waiting for LocalDevVPN…"); the run's Cancel or the row's stop aborts the signal
    const route = await chooseRoute({ native, signal: signal ?? new AbortController().signal, onWait: () => progress("vpn", 0) });
    if (!route) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
    if (route.route) host = false; // This iPhone: installd updates iFizBox in place
    // B111: This iPhone has no iOS prompt: the row shows the copy and installd's percent (herePhase), and the reply
    // comes once installd has the app
    if (route.route) progress("copying", 0);
    opened = await abortable(native, "signing.open", { token: row.token, manifestServer: getServer(), ...(host ? { host: true } : {}), ...route },
      (ev) => {
        if (ev?.log) { log(ev.log); return; }
        const p = route.route ? herePhase(ev) : null;
        if (p) progress(p.phase, p.fraction);
      }, { tag, signal });
    if (route.route) return { installed: opened?.installed ?? true, expires: opened?.expires ?? null };
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
  if (r?.dismissed) return { installed: r?.installed ?? null, expires: opened?.expires ?? null, dismissed: true };
  // B146: once iOS took the IPA, "not installed" can't be told apart from "installed but not seen" (isInstalled is
  // unreliable on iOS 27, a re-signed app may not show): the row ends Sent to iOS (null), never Failed
  return { installed: r?.installed === true ? true : null, expires: opened?.expires ?? null };
}

// B111: signing.install's {here: "copying" | "installing", progress} event (This iPhone) -> { label } for the page's
// step and bar ("Copying to iPhone 40%", "Installing 75%"), or null
export function hereLabel(ev) {
  const word = { copying: "Copying to iPhone", installing: "Installing" }[ev?.here];
  if (!word) return null;
  const p = Math.round(Math.max(0, Math.min(1, Number(ev.progress) || 0)) * 100);
  return { label: p > 0 && p < 100 ? `${word} ${p}%` : word };
}

// B150: the name an install's page shows: the caller's (a source's app name, the variant it was picked as, or Custom
// Install's), else the signed IPA's own (`result.name`, its Info.plist). A bare file name ("App.ipa") isn't a name:
// the IPA's own wins over it.
export function shownName(name, result) {
  const given = String(name ?? "").trim();
  return (given && !/\.ipa$/i.test(given) ? given : "") || result?.name || given;
}

// B111: the single install's end on This iPhone: installd has the app, so "Installed <app>", the bar full, and
// Open <app> (signing.openApp) above the Return button.
export function finishHere(h, result, { native, name = "", later = setTimeout } = {}) {
  const app = shownName(name, result) || "the app"; // B150: the source's name before the IPA's
  const text = `Installed ${app}`;
  const bid = result?.bundleId;
  if (typeof h.finish === "function") {
    h.set(`${text} 100%`);
    const open = () => { try { Promise.resolve(bridge(native).call("signing.openApp", { bundleId: bid })).catch(() => {}); } catch { /* no bridge */ } return false; };
    h.finish({ status: text, ...(bid ? { also: { label: `Open ${app}`, action: open } } : {}) });
  } else later(() => (h.done ? h.done(text) : h.hide()), 1200);
}

// B111: signing.open's event on the This iPhone route -> the run's { phase: "copying" | "installing", fraction 0..1 },
// or null (not a step event)
export function herePhase(ev) {
  if (ev?.phase !== "copying" && ev?.phase !== "installing") return null;
  const f = Number(ev.progress);
  return { phase: ev.phase, fraction: Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0 };
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
export async function libraryCall(method, params = {}, onEvent, native, { alert = showAlert } = {}) {
  const send = (extra = {}) => bridge(native).call(`library.${method}`, method === "options" ? params : withKeep({ ...params, ...extra }), onEvent);
  return method === "add" ? askInsecure(send, { alert, url: params?.url ?? null }) : send(); // B104: an http link with no https twin asks first
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
  const step = await check({ native, alert });
  if (step === "cancel") return false;
  if (step) {
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
  const route = await chooseRoute({ native, alert });
  if (!route) { h.hide(); return false; }
  // This iPhone needs no Signing Server, so no connection either.
  if (!route.route && !(await untilCancel(h, reachable(server)).catch(() => false)) && !h.cancelled) {
    h.hide();
    await alert({ title: "No Connection", message: offlineText(name, server), buttons: ["OK"] });
    return "offline";
  }
  if (h.cancelled) return false;
  h.set("Installing");
  let result;
  try { result = await untilCancel(h, libraryCall("install", { file, manifestServer: server, ...route }, onEvent, native)); } catch (e) { return fail(e); }
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
// F237: with Keep Bundle IDs (keep), that is the app's own ID when the caller knows it (F280: iFizBox's own IPA
// too, as websign-job.js now signs it).
export function expectedBundleId(id, { url = "", bundleId = null, keep = storedKeep() } = {}) {
  // Only a password known to open the .p12: a sign that fails after iOS was sent to the link leaves iOS waiting, and
  // it gives up with "the certificate for <domain> is not valid" (user 2026-11-18). Unchecked (null, e.g. synced from
  // the account) goes the slow way: Ready to Install, or the signing error, with nothing opened.
  if (!id?.p12 || !id?.profile || id.passwordOk !== true) return null;
  try {
    const { appId } = profileInfo(id.profile instanceof Uint8Array ? id.profile : new Uint8Array(id.profile));
    if (!appId) return null;
    const own = bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null);
    if (keep && own) return own;
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

// F236/F252: watchInstall's "Not on the Home Screen?" help line, or null (all devices, no list, an unreadable profile,
// or this phone is in it). F256: `phone` is the UDID F253's profile found (screens/signing.js storedUdid): with it
// the line drops out when the profile lists it; without it (null) the website can't check.
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
// F261: the same alert for an app at or past the size that ran this browser out of memory (core/websign.js
// memoryLimit): its own title and words, and Try Anyway (before Cancel) signs it after all.
export const MEMORY_TITLE = "Too Big for This iPhone";
export const MEMORY_BUTTONS = [...TOO_BIG_BUTTONS.slice(0, 3), "Try Anyway", "Cancel"];
export const memoryText = (name, size, limit) => `${appOr(name)} is ${siteMB(size)} MB. Signing a ${siteMB(limit)} MB app ran this browser out of memory. Download the IPA and import it into ${NAME} Lite or another sideloader, or try anyway.`;
// the failure's alert, under zsign's "Out of memory"
export const memoryNote = (size) => `${NAME} Lite signs big apps on the phone without this limit. From now on, apps of ${siteMB(size)} MB or more open Too Big here first.`;
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

export async function tooBigAlert({ url, name = "", size = 0, version = "", iconUrl = null, limit = null },
  { alert = showAlert, anyway = () => {}, open = (u) => globalThis.open?.(u, "_blank", "noopener"), storage = globalThis.localStorage, back = whenBack,
    go = (path) => { location.hash = format({ tab: "installed", path }).replace(/^#/, ""); },
    lite = async () => (await import("./screens/home.js")).installApp(), handoff = handOffIpa } = {}) {
  let entry = null;
  // Download IPA opens the file from the tap itself (Safari opens a new page only inside the user's tap)
  const onTap = (i) => {
    // F261: Try Anyway signs from the tap itself (signInBrowser opens iOS's early link there)
    if (limit && i === 3) { try { Promise.resolve(anyway()).catch(() => {}); } catch { /* its own alert said it */ } return; }
    if (i !== 0) return;
    try { entry = addSiteUrl(storage, url, Date.now(), { name, version, size, iconUrl }); } catch { entry = null; }
    if (entry) {
      markFresh(entry.file, tooBigNote(name || entry.name, size));
      back(() => go([MYIPAS]));
    }
    open(url);
  };
  const { index } = await alert(limit
    ? { title: MEMORY_TITLE, message: memoryText(name, size, limit), buttons: MEMORY_BUTTONS, cancel: 4, colors: { 0: "blue" }, onTap }
    : { title: TOO_BIG_TITLE, message: tooBigText(name, size), buttons: TOO_BIG_BUTTONS, cancel: 3, colors: { 0: "blue" }, onTap });
  if (limit && index === 3) return "try";
  if (index === 0) return "download";
  if (index === 1) { await Promise.resolve().then(lite).catch(() => {}); return "lite"; }
  if (index === 2) { await Promise.resolve().then(() => handoff({ url, name })).catch(() => {}); return "other"; }
  return "cancel";
}

export async function signInBrowser({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null, anyway = false },
  { hud = progressHUD, alert = showAlert, open = (u) => { location.href = u; }, go = openRoute,
    identity = loadIdentity, fetcher = globalThis.fetch, worker = runInWorker, transfer = websiteTransfer, base = "",
    now = identityNow, origin = () => new URL(base || "/", globalThis.location?.href).origin, clock = Date.now,
    watch = watchInstall, phone = siteUdid, tooBig = tooBigAlert, prompt = watchPrompt, storage = storageOf() } = {}) {
  const deps = { hud, alert, open, go, identity, fetcher, worker, transfer, base, now, origin, clock, watch, phone, tooBig, prompt, storage };
  // F257: a listed size over the cap: the Too Big alert, before the early link or any download
  if (!bytes && url && overSiteLimit(size)) {
    await tooBig({ url, name, size, version, iconUrl }, { alert });
    return false;
  }
  // F261: at or past the size that ran this browser out of memory: the same alert with Try Anyway (from its tap)
  if (!bytes && url && !anyway && overMemoryLimit(size, storage)) {
    let tried = null;
    const choice = await tooBig({ url, name, size, version, iconUrl, limit: memoryLimit(storage) }, { alert,
      anyway: () => { tried = signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl, anyway: true }, deps); return tried; } });
    return choice === "try" && tried ? tried : false;
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
  // B90: iOS's prompt cancelled while this runs (watchPrompt) stops the download, the signer and the upload
  const ios = early ? promptStop(early.token, { base, fetcher, prompt }) : null;
  const again = () => signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl, anyway }, deps);
  const drop =() => { ios?.stop(); if (early && !intoEarly) { const t = early.token; early = null; return dropEarly(t, { base, fetcher }); } return null; };
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
  // F188: the page's Cancel stops the download, the signer and the upload; B90: so does iOS's prompt cancelled
  const signal = eitherSignal(h.signal ?? null, ios?.signal ?? null);
  const guard = (p) => untilCancel(h, ios ? ios.race(p) : p);
  let cutOnce = false; // F257: the download was resumed at least once (the log said so)
  let ipaSize = 0; // F261: the IPA zsign got, for this browser's memory limit
  try {
    const ipa = bytes ? await guard(keptBytes(bytes))
      : await guard(downloadIpa(url, { base, fetcher, onProgress: pct("Downloading"), onCut: ({ attempt, at }) => {
        cutOnce = true;
        h.page?.raw?.(droppedText(at)); // F257: grey, then the step
        h.set(reconnectText(attempt));
      }, ...(signal ? { signal } : {}) }));
    h.set("Signing");
    ipaSize = ipa?.byteLength ?? ipa?.length ?? 0;
    const self = isSelfIpa(url) || bring;
    const carry = self ? { identity: Boolean(bring), transfer: await transfer().catch(() => null) } : null;
    // own provisioning profiles: with an App Store Connect key, the App ID and Ad Hoc profile made for this app
    const keep = withKeep({}).keepBundleId !== false && !self;
    const made = keep ? await guard((await import("./screens/devaccount.js")).autoProfileSite({ ipa, id, bundleId: bundleId || null,
      log: (t) => h.page?.raw?.(t) })) : null;
    // F288: the tweaks kept for this app (screens/tweaks.js, Inject Tweaks on its IPA page), unpacked and prepared here
    const tweaks = !self && bundleId ? await guard((await import("./screens/tweaks.js")).preparedFor(bundleId)) : null;
    const signed = await guard(worker({ ipa: buffer(ipa), p12: buffer(id.p12), profile: buffer(made ?? id.profile), password: id.password ?? "", bring: carry,
        appBundleId: bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null), ...withKeep({}), ...(tweaks ? { tweaks } : {}),
        ...refusing() },
      { onProgress: (t) => h.set(t), ...(signal ? { signal } : {}) }));
    noteSigned(storage, ipaSize); // F261
    keepIpaHash(storage, signed, { bundleId, version }); // F292: Report as Malicious sends it
    h.set("Uploading");
    const ipaBytes = signed.ipa instanceof Uint8Array ? signed.ipa : new Uint8Array(signed.ipa);
    // the early link takes this app only if it came out with the reserved bundle ID (iOS already has its manifest)
    intoEarly = Boolean(early && signed.bundleId === early.bundleId && (await reserved));
    if (!intoEarly) drop(); // the Ready to Install alert's own link follows
    const body =await guard(uploadSigned(ipaBytes, signed, { base, fetcher, onProgress: pct("Uploading"), token: intoEarly ? early.token : null,
      ...(signal ? { signal } : {}) }));
    ios?.stop(); // uploaded: watchInstall follows iOS from here
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
    if (ios?.cancelled && !h.cancelled) return iosCancelled(h, ios.token, { base, fetcher, alert, again }); // B90
    if (h.cancelled) return false; // F188: Cancel closed the page; no alert after it
    failed(h, String(e?.message ?? e));
    // F257: the download broke off past its last try: under the red error, what to do with iOS's icon (only once iOS
    // was sent to the early link: no icon can be left otherwise)
    if (cutOnce && e?.message === CUT_TEXT && opened) h.page?.warning?.(grayIconText(name));
    // F261: zsign ran out of memory: this browser remembers the size, and the alert says what that changes
    const oom = ipaSize > 0 && isOutOfMemory(e?.message);
    if (oom) noteOutOfMemory(storage, ipaSize);
    const message = String(e?.message ?? e) + (oom ? `\n\n${memoryNote(memoryLimit(storage) ?? ipaSize)}` : "") + (opened ? `\n\n${iconLeftText(name)}` : "");
    await alert({ title: e?.code === "malware" ? KNOWN_MALWARE : name ? `Couldn't Install ${name}` : "Couldn't Install", message, buttons: ["OK"] });
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
  SENT_TO_IOS, // F252: short; the help line under it (watchInstall's `cause`) covers an app that doesn't appear
];
// The page completes once iOS starts the download (Cydia's Complete, Return under it): Safari can't see the rest, and
// "iOS is downloading…" left people waiting on a page with nothing more to show (user 2026-11-18).
export const installStage = (s) => (s?.finished || s?.started ? 2 : s?.manifest ? 1 : 0);
export const notAskedText = "iOS didn't ask for the app. Tap Install again.";

// F236/F252: `cause` (core/signing.js notLandedText, "Not on the Home Screen?": the website couldn't check this
// iPhone's UDID) goes under the last step as a grey line with Help (page.help; `help(page)` opens Guides > "An app
// won't install"), once iOS has the app and when it never fetches it. No Retry there: iOS already has the app.
export function watchInstall(token, h, { base = "", fetcher = globalThis.fetch, app = "", itms = "", open = () => {}, alert = showAlert,
  cause = null, help = openAppHelp, every = STATUS_EVERY, minShow = STATUS_MIN_SHOW, askWithin = STATUS_ASK_WITHIN, upTo = EARLY_WINDOW,
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
        if (cause) h.page?.help?.(cause, { action: help });
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
        if (cause) h.page?.help?.(cause, { action: help });
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

// ---- B90: iOS's Install prompt cancelled while the website still signs ----------------------------------------
//
// The early link opens iOS's prompt at the tap, and the download, the signer and the upload run on behind it. iOS asks
// for app.ipa only once Install is tapped: the Worker marks that "asked" (GET /sign/up/<token>/status, even while it
// holds the request for the upload). watchPrompt polls the status from the moment the link opens; once the manifest
// was fetched (the prompt is up) and the page has come back in front (window focus, visibilitychange to visible,
// pageshow: the prompt closed; only after the manifest was seen) with no "asked" within `grace` ms, or none `cap` ms after the manifest whatever the
// page heard, iOS's prompt was cancelled: `onCancel()` runs once. A late "asked" before that carries on. A status
// without an "asked" key (a Worker before B90), or no status at all, never cancels: the install goes on as before.
//
//   const p = watchPrompt(token, { base, fetcher, onCancel })
//   p.state        "watching" | "asked" | "cancelled" | "unknown" (an older Worker) | "stopped"
//   p.stop()       stops polling and listening (the upload is done, or the job ended)

// grace: room for iOS's HEAD after an Install tap, its KV mark and the next look; a cancel read wrongly kills a real
// install, so it errs long
export const PROMPT_EVERY = 1000, PROMPT_GRACE = 8000, PROMPT_CAP = 30 * 1000;
export const IOS_CANCELLED_TITLE = "Not Installed", IOS_CANCELLED_TEXT = "Cancelled in iOS.";

export function watchPrompt(token, { base = "", fetcher = globalThis.fetch, onCancel = () => {}, every = PROMPT_EVERY, grace = PROMPT_GRACE,
  cap = PROMPT_CAP, upTo = EARLY_WINDOW, clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  win = globalThis.window ?? globalThis, doc = globalThis.document } = {}) {
  const t0 = clock();
  let state = "watching", manifestAt = null, backAt = null;
  // only a return once the prompt is up counts (one that came with the link opening says nothing)
  const back = () => { if (manifestAt !== null) backAt = clock(); };
  const onVisible = () => { if (doc?.visibilityState !== "hidden") back(); };
  const listen = (on) => {
    const m = on ? "addEventListener" : "removeEventListener";
    try { win?.[m]?.("focus", back); win?.[m]?.("pageshow", back); doc?.[m]?.("visibilitychange", onVisible); } catch { /* no events */ }
  };
  listen(true);
  const end = (s) => { if (state === "watching") { state = s; listen(false); } };
  const look = async () => {
    try {
      const res = await fetcher(`${base}/sign/up/${token}/status`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  (async () => {
    while (state === "watching") {
      const s = await look();
      if (state !== "watching") return;
      if (s && typeof s === "object") {
        if (!("asked" in s)) { end("unknown"); return; } // a Worker before B90: as before
        if (s.asked || s.started || s.finished) { end("asked"); return; }
        if (s.manifest && manifestAt === null) manifestAt = clock();
      }
      const now = clock();
      if (manifestAt !== null && (now - manifestAt >= cap || (backAt !== null && now - Math.max(backAt, manifestAt) >= grace))) {
        end("cancelled");
        try { onCancel(); } catch { /* the caller's own */ }
        return;
      }
      if (now - t0 >= upTo) { end("stopped"); return; }
      await sleep(every);
    }
  })().catch(() => end("stopped"));
  return { get state() { return state; }, stop: () => end("stopped") };
}

// signInBrowser's side of watchPrompt: { signal (aborts on the cancel), race(p) (p, or a rejection with code
// "ios_cancelled" once the prompt was cancelled), cancelled, token, stop() }.
function promptStop(token, { base, fetcher, prompt = watchPrompt }) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let cancelled = false, fire = () => {};
  const gone = new Promise((_, reject) => { fire = () => reject(signFail("ios_cancelled", IOS_CANCELLED_TEXT)); });
  gone.catch(() => {});
  const w = prompt(token, { base, fetcher, onCancel: () => { cancelled = true; try { ctl?.abort(); } catch { /* no signal */ } fire(); } });
  return { token, signal: ctl?.signal ?? null, get cancelled() { return cancelled; }, race: (p) => Promise.race([p, gone]), stop: () => w?.stop?.() };
}

// One signal that aborts when either does (AbortSignal.any where the browser has it).
function eitherSignal(a, b) {
  if (!a || !b) return a || b || null;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const c = new AbortController();
  for (const s of [a, b]) { if (s.aborted) c.abort(); else s.addEventListener("abort", () => c.abort(), { once: true }); }
  return c.signal;
}

// The page once iOS's prompt was cancelled: the link dropped (the Worker answers a later app.ipa at once), "Not
// Installed" with "Cancelled in iOS." in red, and Try Again (the install again from that tap, so a fresh early link)
// above Return. A HUD without finish: the alert says it. -> false
async function iosCancelled(h, token, { base, fetcher, alert, again }) {
  dropEarly(token, { base, fetcher });
  // run inside the tap itself: Safari opens the new early link only there
  const retry = () => { try { Promise.resolve(again()).catch(() => {}); } catch { /* its own alert said it */ } };
  if (typeof h.finish === "function") {
    h.page?.error?.(IOS_CANCELLED_TEXT);
    // the new run opens on this page (progressHUD reuses it while it's up): it stays
    h.finish({ title: IOS_CANCELLED_TITLE, status: IOS_CANCELLED_TEXT, also: { label: TRY_AGAIN_LABEL, action: () => { retry(); return true; } } });
    return false;
  }
  h.hide();
  await alert({ title: IOS_CANCELLED_TITLE, message: IOS_CANCELLED_TEXT, buttons: ["Cancel", TRY_AGAIN_LABEL], cancel: 0,
    onTap: (i) => { if (i === 1) retry(); } });
  return false;
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

// B121: the certificate the saved .p12 holds, read in this browser (core/p12cert.js) and kept with the identity as
// p12Cert { of (SHA-256 of the .p12, hex), serial, team }, so a profile listing several certificates (F276's from an
// API key) doesn't stand in for it. Read again when the .p12 changes; null when it can't be opened here (wrong
// password, a cipher or encoding p12cert doesn't read), and then callers fall back to the profile's serials.
//   await identityCert(id)   -> { serial, team } | null
export async function identityCert(id, { save = saveIdentity, read = null, subtle = globalThis.crypto?.subtle } = {}) {
  if (!id?.p12) return null;
  let of = null;
  try { of = Array.from(new Uint8Array(await subtle.digest("SHA-256", bytesOf(id.p12))), (x) => x.toString(16).padStart(2, "0")).join(""); } catch { /* no WebCrypto */ }
  if (of && id.p12Cert?.of === of && id.p12Cert.serial) return { serial: id.p12Cert.serial, team: id.p12Cert.team ?? null };
  let leaf = null;
  try { leaf = await (read ?? (await import("./core/p12cert.js")).p12Leaf)(id.p12, id.password ?? "", subtle); } catch { leaf = null; }
  if (!leaf?.serial) return null;
  if (of) await Promise.resolve(save({ p12Cert: { of, serial: leaf.serial, team: leaf.team ?? null } })).catch(() => {});
  return { serial: leaf.serial, team: leaf.team ?? null };
}
