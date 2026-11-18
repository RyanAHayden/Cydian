// Signing in the sideload build (F58, I6): the phone signs every app itself, through the shell's signing.* bridge
// calls; the Signing Server (worker/, sign.cydian.dev unless the user runs their own) only hands iOS the install
// manifest and holds Cydian's own update. The website signs nothing (F89: its server and signer are gone): an app
// page there hands the app to Cydian or another sideloader (screens/handoff.js). docs/signing.md has the picture.
//
//   await loadIdentity()         the picks on Settings > Signing ({ p12, p12Name, password, profile, profileName }),
//                                in memory until signing.import puts them into the Keychain, or null
//   await saveIdentity(patch)    merges into them;  await clearIdentity()
//   await signingReady()         true when the Keychain holds an identity (statusReady(signing.status), as Settings
//                                shows it); false where nothing signs (the website, the jailbreak app)
//   getServer() / setServer(s)   Settings > Signing's server, https://sign.cydian.dev unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled })   signs on the phone and installs (installOnDevice)
import { showBanner } from "./nav/banner.js";
import { APP_SERVER, LEGACY_SERVER, normalizeServer, toBase64, phaseLabel, deviceError } from "./core/signing.js";
import { format } from "./router.js";
import { detectMode } from "./core/settings.js";
import { showHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";

const SERVER_KEY = "cydian.signingServer";

// The picks wait in memory only, until signing.import puts them into the Keychain; then only their names stay (the
// .p12 itself never goes to the web view's storage).
let staged = null;

export async function loadIdentity() {
  return staged ? { ...staged } : null;
}

export async function saveIdentity(patch) {
  staged = { ...(staged ?? {}), ...patch, savedAt: Date.now() };
  return { ...staged };
}

export async function clearIdentity() {
  staged = null;
}

export async function signingReady({ native, wait = sleep } = {}) {
  if (!localSigning()) return false;
  return statusReady(await readyStatus(native, wait));
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
// error, which it shows in an alert; false where nothing signs (the website, the jailbreak app: their pages offer
// hand-offs and the helper instead, so this is only a guard).
export async function signAndInstall({ url, name = "", onInstalled = () => {} }) {
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
function liveHUD(text) {
  const hide = showHUD(text);
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  return { set: (t) => { if (label) label.textContent = t; }, hide, done: (t) => hide.done(t) };
}

const openRoute = (path) => { location.hash = format({ tab: "settings", path }).replace(/^#/, ""); };

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
  if (host) showBanner({ title: "Cydian", message: "Press Install. Cydian closes to finish updating; tap its notification to open the new one." });
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
