// Signing in the sideload build (F58, I6): the phone signs every app itself, through the shell's signing.* bridge
// calls; the Signing Server (worker/, sign.cydian.dev unless the user runs their own) only hands iOS the install
// manifest and holds Cydian's own update. F93: the website signs in the browser again, zsign as WebAssembly in a Web
// Worker (signInBrowser, at the end), and the Worker only hosts the signed IPA for iOS. docs/signing.md has the picture.
//
//   await loadIdentity()         the picks on Settings > Signing ({ p12, p12Name, password, profile, profileName }),
//                                in memory until signing.import puts them into the Keychain (the app), or kept in
//                                this browser's IndexedDB (the website, F93), or null
//   await saveIdentity(patch)    merges into them;  await clearIdentity()
//   await signingReady()         true when the Keychain holds an identity (statusReady(signing.status), as Settings
//                                shows it), or on the website when a .p12 and a profile are saved; false in the
//                                jailbreak app
//   getBring() / setBring(on)    the website's Bring My Certificate switch (on unless turned off): Install Cydian
//                                App puts the certificate inside Cydian's IPA
//   getServer() / setServer(s)   Settings > Signing's server, https://sign.cydian.dev unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled, bring })   signs on the phone and installs (installOnDevice), or
//                                on the website signs in the browser (signInBrowser)
import { showBanner } from "./nav/banner.js";
import { APP_SERVER, LEGACY_SERVER, normalizeServer, toBase64, phaseLabel, deviceError } from "./core/signing.js";
import { format, settingsRoute } from "./router.js";
import { IPA_MAX, CYDIAN_ID, profileInfo, targetBundleId } from "./core/websign.js";
import { detectMode } from "./core/settings.js";
import { liveHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";

const SERVER_KEY = "cydian.signingServer";

// The picks wait in memory only, until signing.import puts them into the Keychain; then only their names stay (the
// .p12 itself never goes to the web view's storage). F93: the website keeps them in IndexedDB (this browser only:
// they never leave it but inside Cydian's own IPA with Bring My Certificate), as it did before F89.
let staged = null;
// F121: the website's identity as last read from or written to IndexedDB, for Install's tap to use without waiting
// (identityNow); warmed when this module loads on the website.
let known = null;
const identityNow = () => known;
const DB = "cydian-signing", STORE = "identity", KEY = "current", BRING_KEY = "cydian.bringCertificate";

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
    // F121: from memory when it's there, so Install Cydian App's tap reaches iOS's prompt without a wait in between
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

// A saved cydian.dev (the website's old signer, an older default) means the default too.
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

// F72: an IPA of Cydian itself (its GitHub releases, where Cydian's own source points).
// Only Cydian's own IPA files count: a release's Cydian.ipa, or the test source's cydian-<version>.ipa. Other files
// under the same releases (the test-fixtures pre-release's Test Alpha, Test Beta...) are ordinary apps.
export const isSelfIpa = (url) => /^https:\/\/github\.com\/RyanAHayden\/Cydian\/releases\/(?:latest\/)?download\/(?:[^/]+\/)?(?:Cydian|cydian-[\d.]+)\.ipa$/i
  .test(String(url ?? ""));

// Signs `url` (an IPA) on the phone and installs it. Resolves true once iOS was asked to install; false after an
// error, which it shows in an alert; false in the jailbreak app (its pages use the helper, so this is only a guard).
// F93: on the website, signs it in the browser (signInBrowser); `bring` (Install Cydian App) carries the certificate.
export async function signAndInstall({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "" }) {
  if (browserSigning()) return signInBrowser({ url, name, onInstalled, bring, bundleId, version });
  if (!localSigning()) {
    await showAlert({ title: "Can't Install Here", message: "Apps are signed in the Cydian app. Open this one in Cydian, AltStore, SideStore or Feather.", buttons: ["OK"] });
    return false;
  }
  // Cydian's own IPA: signed here on the phone like any app, then hosted on the Signing Server (host: true) since
  // iOS closes Cydian, and its install server, while it installs over it. Straight to iOS's Install prompt.
  if (isSelfIpa(url)) return installOnDevice({ url, name: name || "Cydian", onInstalled, host: true });
  // F75: the first Install with something missing opens the Signing walkthrough at that step, not an alert.
  if (await firstInstallCheck()) return false;
  // F81: one tap: Install signs and installs straight away. The look-first sheet (F68, signing-sheet.js) is the app
  // page's Custom Install row (signing-sheet.js customInstall).
  return installOnDevice({ url, name, onInstalled });
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
//   await installOnDevice({ url, name, onInstalled })  signing.install with a HUD following its phases
//
// Each takes `native` (the bridge, globalThis.cydianNative by default) so tests can pass a fake.

export const localSigning = () => detectMode() === "sideload";
const bridge = (native) => {
  const n = native ?? globalThis.cydianNative;
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
    try { return await deviceStatus(native); } catch { if (i === 0) await wait(400); }
  }
  return null;
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
export async function firstInstallCheck({ native, server = getServer(), go = openRoute, wait = sleep } = {}) {
  const { missingStep, openAt } = await import("./screens/signing.js");
  const step = missingStep(await readyStatus(native, wait), server);
  if (!step) return null;
  openAt(step);
  go(["signing"]);
  return step;
}

// The HUD whose label follows the install's phases: { set(text), hide() }.
const openRoute = (path) => { location.hash = format(settingsRoute(path)).replace(/^#/, ""); };

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
  { native, hud = liveHUD, alert = showAlert, go = openRoute, later = setTimeout } = {}) {
  const h = hud("Downloading");
  let result;
  try {
    // manifestServer: the signing server hands iOS the manifest while Cydian serves the IPA over plain HTTP at
    // 127.0.0.1 (nothing to set up on the phone; the server sees only the app's ID, version and name).
    result = await bridge(native).call("signing.install", { ...(params ?? { url }), manifestServer: getServer(), ...(host ? { host: true } : {}) }, (ev) => {
      const t = phaseLabel(ev);
      if (t) h.set(t);
    });
  } catch (e) {
    h.hide();
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  }
  h.set("Installing");
  onInstalled(result);
  // Cydian itself (host): iOS's Install prompt is up, and Cydian closes once it's answered so the install finishes
  // (native CloseForUpdate): say so first (user 2026-11-18).
  if (host) showBanner({ title: "Cydian", message: "Press Install. Cydian closes to finish updating; open it again once the new icon appears." });
  if (after) { after(result, h); return true; }
  // iOS asks "Install …?" over the app: the HUD ends on a checkmark (signed and handed to iOS) and fades.
  later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return true;
}

// ---- My IPAs (F77): the user's own IPAs, signed on the phone (native/Sources/MyIPAs.swift, library.*) ----------
//
//   await libraryCall(method, params, onEvent, native)   one library.* call ("list", "add", "pick", "options",
//                                      "sign", "install", "export", "delete")
//   await serverReachable(server)      true when <server>/sign/status answers within a few seconds
//   await installFromLibrary({ file, name, signed, onInstalled })
//                                      Install on an IPA's page: signs if needed (offline is fine), then, with the
//                                      Signing Server reachable, installs; offline it says so and keeps the signed copy.
//                                      Resolves "installed" | "offline" | false (an error, shown) | null (walkthrough)

export async function libraryCall(method, params = {}, onEvent, native) {
  return bridge(native).call(`library.${method}`, params, onEvent);
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

export async function installFromLibrary({ file, name = "", onInstalled = () => {} },
  { native, hud = liveHUD, alert = showAlert, go = openRoute, check = firstInstallCheck, reachable = serverReachable,
    follow = null, later = setTimeout } = {}) {
  if (await check({ native })) return null;
  const server = getServer();
  const h = hud("Signing");
  const onEvent = (ev) => { const t = phaseLabel(ev); if (t) h.set(t); };
  const fail = async (e) => {
    h.hide();
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  };
  // Sign first: nothing here needs the network, so an offline phone still ends with a signed copy.
  try { await libraryCall("sign", { file }, onEvent, native); } catch (e) { return fail(e); }
  if (!(await reachable(server))) {
    h.hide();
    await alert({ title: "No Connection", message: offlineText(name, server), buttons: ["OK"] });
    return "offline";
  }
  h.set("Installing");
  let result;
  try { result = await libraryCall("install", { file, manifestServer: server }, onEvent, native); } catch (e) { return fail(e); }
  onInstalled(result);
  const followInstall = follow ?? (await import("./signing-sheet.js")).followInstall;
  if (result?.bundleId) followInstall(bridge(native), result.bundleId, h, { later });
  else later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return "installed";
}

// ---- the website (F93): signed in the browser ----------------------------------------------------------------
//
//   browserSigning()                   true on the website
//   await signInBrowser({ url, name, onInstalled, bring }, deps)
//       HUD "Downloading" (the IPA through the Worker's /api/fetch?kind=ipa: most hosts send no CORS headers),
//       "Signing" (signing-worker.js: zsign as WebAssembly, with the certificate from IndexedDB), "Uploading" (the
//       signed IPA to the Worker's /sign/upload, in parts, kept 10 minutes), then a Ready to Install alert whose
//       Install tap opens iOS's install prompt (itms-services, from the tap). F121: when the bundle ID is known at the
//       tap (expectedBundleId; `bundleId` is the app's own ID where the caller knows it), iOS's prompt opens at once
//       instead, for a link the upload fills later, and there's no alert. true once iOS was asked; false after an error, shown in an alert (zsign's own reason when
//       it can't sign the app). bring: Cydian's own IPA carries the certificate (cydian-identity.plist), and always
//       the website's sources and settings (web/transfer.link): the app imports both on its first launch.
//
// The .p12, password and profile go only into the Web Worker (this browser), and with bring into Cydian's signed
// IPA, which waits on the Worker for those 10 minutes as the old server signer's copy did.

export const browserSigning = () => detectMode() === "site";

const signFail = (code, message) => Object.assign(new Error(message), { code });

// The Web Worker, as one call: resolves the worker's answer ({ ipa, bundleId, name, version }), or throws its error.
export function runInWorker(job, { make = () => new Worker(new URL("./signing-worker.js", import.meta.url), { type: "module" }), onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = make(); } catch (e) { reject(signFail("unsupported", `This browser can't sign apps (${e?.message ?? e}).`)); return; }
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
async function retrying(send, { tries = 3, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try { return await send(); } catch (e) {
      if (i >= tries) throw e;
      await wait(800 * i);
    }
  }
}

// The IPA's bytes through /api/fetch, the label following the download ("Downloading 40%").
export async function downloadIpa(url, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, max = IPA_MAX, wait = undefined } = {}) {
  let res;
  try { res = await retrying(() => fetcher(`${base}/api/fetch?${new URLSearchParams({ url, kind: "ipa" })}`, { cache: "no-store" }), { wait }); } catch {
    throw signFail("network", "The app couldn't be downloaded: no connection to the server.");
  }
  if (!res.ok) throw await answerError(res);
  const total = Number(res.headers?.get?.("content-length") || 0);
  if (total > max) throw signFail("too_large", `Apps up to ${Math.round(max / 1048576)} MB can be signed on the website.`);
  if (!res.body?.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  let buf = new Uint8Array(total || 1 << 20), n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > max) { reader.cancel?.(); throw signFail("too_large", `Apps up to ${Math.round(max / 1048576)} MB can be signed on the website.`); }
    if (n + value.length > buf.length) { const b = new Uint8Array(Math.max(buf.length * 2, n + value.length)); b.set(buf.subarray(0, n)); buf = b; }
    buf.set(value, n);
    n += value.length;
    if (total) onProgress(Math.min(99, Math.floor((n / total) * 100)));
  }
  return buf.length === n ? buf : buf.slice(0, n);
}

// The signed IPA to the Worker (POST /sign/upload, each part, done): the install link's answer { itms, ... }.
// F121: `token` uploads into the reserved early link instead of a new one.
export async function uploadSigned(bytes, { bundleId, name, version }, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, wait = undefined, token = null } = {}) {
  const q = new URLSearchParams({ bundleid: bundleId, version: String(version || "1.0").slice(0, 64), title: String(name || bundleId).slice(0, 200), size: String(bytes.length),
    ...(token ? { token } : {}) });
  const call = async (path, init) => {
    let res;
    try { res = await retrying(() => fetcher(`${base}${path}`, { cache: "no-store", ...init }), { wait }); } catch {
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
// app whose own ID is known (Cydian's, or the caller's bundleId). Otherwise, and whenever the early link can't be
// used (another bundle ID came out, the reservation failed, it took too long), the Ready to Install alert as before.

// F132: iOS's installer retries a held app.ipa for at least 5 minutes (R14, docs/signing.md: HEAD 30 s, HEAD 30 s,
// GET 60 s, then HEAD/GET pairs), each request held up to the Worker's IPA_WAIT; so the early link stays good for
// about the upload's TTL (600 s from the reservation, worker/src/index.js), with room to spare. Past it, the alert.
export const EARLY_WINDOW = 8 * 60 * 1000;

// The bundle ID `id`'s profile signs this app as, when it's known before signing; else null.
export function expectedBundleId(id, { url = "", bundleId = null } = {}) {
  if (!id?.p12 || !id?.profile) return null;
  try {
    const { appId } = profileInfo(id.profile instanceof Uint8Array ? id.profile : new Uint8Array(id.profile));
    if (!appId) return null;
    if (!appId.includes("*")) return appId;
    const own = bundleId || (isSelfIpa(url) ? CYDIAN_ID : null);
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

const buffer = (b) => (b instanceof Uint8Array ? b.slice().buffer : b instanceof ArrayBuffer ? b.slice(0) : new Uint8Array(b ?? []).buffer);

export async function signInBrowser({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "" },
  { hud = liveHUD, alert = showAlert, open = (u) => { location.href = u; }, go = openRoute,
    identity = loadIdentity, fetcher = globalThis.fetch, worker = runInWorker, transfer = websiteTransfer, base = "",
    now = identityNow, origin = () => new URL(base || "/", globalThis.location?.href).origin, clock = Date.now } = {}) {
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
  const id = await identity();
  if (!id?.p12 || !id?.profile) {
    await alert({ title: "No Certificate", message: "Add your certificate, its password and provisioning profile in Settings > Signing.", buttons: ["OK"] });
    go(["signing"]);
    return false;
  }
  const h = hud("Downloading");
  const pct = (label) => (p) => h.set(`${label} ${p}%`);
  try {
    const ipa = await downloadIpa(url, { base, fetcher, onProgress: pct("Downloading") });
    h.set("Signing");
    const self = isSelfIpa(url) || bring;
    const carry = self ? { identity: Boolean(bring), transfer: await transfer().catch(() => null) } : null;
    const signed = await worker({ ipa: buffer(ipa), p12: buffer(id.p12), profile: buffer(id.profile), password: id.password ?? "", bring: carry },
      { onProgress: (t) => h.set(t) });
    h.set("Uploading");
    const ipaBytes = signed.ipa instanceof Uint8Array ? signed.ipa : new Uint8Array(signed.ipa);
    // the early link takes this app only if it came out with the reserved bundle ID (iOS already has its manifest)
    const intoEarly = early && signed.bundleId === early.bundleId && (await reserved);
    const body = await uploadSigned(ipaBytes, signed, { base, fetcher, onProgress: pct("Uploading"), token: intoEarly ? early.token : null });
    onInstalled({ ...body, bundleId: signed.bundleId, name: signed.name, version: signed.version });
    const app = name || signed.name || "The app";
    if (intoEarly && clock() - early.at < EARLY_WINDOW) {
      // iOS's prompt was asked for at the tap and its download now gets the app: nothing more to tap here
      if (h.done) h.done("Installing"); else h.hide();
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
    h.hide();
    await alert({ title: name ? `Couldn't Install ${name}` : "Couldn't Install", message: String(e?.message ?? e), buttons: ["OK"] });
    return false;
  }
}

// What Cydian's own IPA carries for its first launch: the website's sources and settings (Send Settings' link).
async function websiteTransfer() {
  const [{ websitePayload }, { encodeLink }] = await Promise.all([import("./screens/importlink.js"), import("./core/transfer.js")]);
  return encodeLink(await websitePayload({ identity: false })); // the certificate goes as cydian-identity.plist (bring)
}

// F121: Install's tap needs the profile at once (identityNow), so the website reads it as soon as this module loads.
if (browserSigning() && globalThis.indexedDB) loadIdentity().catch(() => {});
