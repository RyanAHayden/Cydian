// Sign & install with your own certificate (I5), the browser half of web/signer/. The parsing is core/signing.js;
// this file keeps the files, talks to the signing server and opens the install link.
//
//   await loadIdentity()         { p12, p12Name, password, profile, profileName } or null (IndexedDB, this phone only)
//   await saveIdentity(patch)    merges into the saved one;  await clearIdentity()
//   await signingReady()         true when a .p12 and a profile are saved (the site), or the Keychain holds an
//                                identity (the sideload build: statusReady(signing.status), as Settings shows it)
//   getServer() / setServer(s)   Settings > Signing's server, https://cydian.dev unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled, bring })   HUD "Signing", POST /sign, HUD "Installing", itms-services;
//                                bring: Cydian's own IPA carries the certificate into the app (F75, getBring())
//   getBring() / setBring(on)    the website's "Bring my certificate into the app" switch, on unless turned off
//   await exportToApp(key)       F75, the website's export page: cydian://signing-import#<sealed> or null (none here)
//
// POST /sign asks for an asynchronous job (F47): the server answers 202 {job} at once and the HUD polls
// GET /sign/job/<job> every second under the same "Signing" HUD until done or error, so a big IPA outlasts no proxy's timeout. A server from
// before F47 ignores the ask and answers 200 with the link, which works the same.
//
// The certificate, key and password leave the phone only inside the POST to the signing server, over HTTPS, for
// that one request. Nothing goes to localStorage but the server's address.
import { DEFAULT_SERVER, normalizeServer, signBody, errorText, toBase64, phaseLabel, deviceError } from "./core/signing.js";
import { newKey, exportUrl, sealIdentity, openIdentity, importUrl, sealedFrom } from "./core/transfer.js";
import { format } from "./router.js";
import { detectMode } from "./core/settings.js";
import { showHUD } from "./nav/hud.js";
import { showBanner } from "./nav/banner.js";
import { showAlert } from "./nav/alert.js";

const DB = "cydian-signing";
const STORE = "identity";
const KEY = "current";
const SERVER_KEY = "cydian.signingServer";
const BRING_KEY = "cydian.bringCertificate";

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

// F58: the sideload build keeps the picks in memory only, until signing.import puts them into the Keychain; then
// only their names stay (the .p12 itself never goes to the web view's storage).
let staged = null;
const inMemory = () => detectMode() === "sideload";

export async function loadIdentity() {
  if (inMemory()) return staged ? { ...staged } : null;
  try { return (await tx("readonly", (s) => s.get(KEY))) ?? null; } catch { return null; }
}

export async function saveIdentity(patch) {
  const cur = (await loadIdentity()) ?? {};
  const next = { ...cur, ...patch, savedAt: Date.now() };
  if (inMemory()) { staged = next; return { ...next }; }
  await tx("readwrite", (s) => s.put(next, KEY));
  return next;
}

export async function clearIdentity() {
  if (inMemory()) { staged = null; return; }
  await tx("readwrite", (s) => s.delete(KEY));
}

export const signingAvailable = () => detectMode() === "site";

export async function signingReady({ native, wait = sleep } = {}) {
  if (localSigning()) return statusReady(await readyStatus(native, wait));
  if (!signingAvailable()) return false;
  const id = await loadIdentity();
  return Boolean(id?.p12 && id?.profile);
}

export function getServer() {
  try { return normalizeServer(localStorage.getItem(SERVER_KEY)) ?? DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
}

export function setServer(s) {
  const n = normalizeServer(s);
  try {
    if (!n || n === DEFAULT_SERVER) localStorage.removeItem(SERVER_KEY);
    else localStorage.setItem(SERVER_KEY, n);
  } catch { /* private mode: this session only */ }
  return n ?? DEFAULT_SERVER;
}

// F75: on unless the user turned the switch off.
export function getBring() {
  try { return localStorage.getItem(BRING_KEY) !== "off"; } catch { return true; }
}

export function setBring(on) {
  try {
    if (on) localStorage.removeItem(BRING_KEY);
    else localStorage.setItem(BRING_KEY, "off");
  } catch { /* private mode: this session only */ }
}

export async function serverStatus(server = getServer()) {
  const r = await fetch(`${server}/sign/status`, { cache: "no-store" });
  if (!r.ok) throw new Error(errorText(r.status, null));
  return r.json();
}

// F72: an IPA of Cydian itself (its GitHub releases, where Cydian's own source points).
// Only Cydian's own IPA files count: a release's Cydian.ipa, or the test source's cydian-<version>.ipa. Other files
// under the same releases (the test-fixtures pre-release's Test Alpha, Test Beta...) are ordinary apps.
export const isSelfIpa = (url) => /^https:\/\/github\.com\/RyanAHayden\/Cydian\/releases\/(?:latest\/)?download\/(?:[^/]+\/)?(?:Cydian|cydian-[\d.]+)\.ipa$/i
  .test(String(url ?? ""));

// Signs `url` (an IPA) on the server and opens the install link it answers with. Resolves true once the link is
// opened; false after an error, which it shows in an alert.
export async function signAndInstall({ url, name = "", onInstalled = () => {}, bring = false }) {
  // F72: Cydian's own IPA never goes through the local install server (iOS closes Cydian, and the server with it,
  // as it starts installing): essential-ui.js signs it on the Signing Server or sends the user to cydian.dev.
  // Cydian's own IPA: signed here on the phone like any app, then hosted on the Signing Server (host: true) since
  // iOS closes Cydian, and its install server, while it installs over it. Straight to iOS's Install prompt.
  if (localSigning() && isSelfIpa(url)) return installOnDevice({ url, name: name || "Cydian", onInstalled, host: true });
  // F75: the first Install with something missing opens the Signing walkthrough at that step, not an alert.
  if (localSigning() && await firstInstallCheck()) return false;
  // F68: look first (signing.inspect), then the sheet with its edits signs and installs (signing-sheet.js).
  if (localSigning()) {
    const { inspectAndInstall } = await import("./signing-sheet.js");
    return inspectAndInstall({ url, name, onInstalled });
  }
  const id = await loadIdentity();
  if (!id?.p12 || !id?.profile) {
    await showAlert({ title: "No Certificate", message: "Add your certificate and provisioning profile in Settings > Signing.", buttons: ["OK"] });
    return false;
  }
  const server = getServer();
  let hide = showHUD("Signing");
  let status, body = null;
  // Installing Cydian itself from the website brings everything along (user 2026-11-17): the certificate (bring) and
  // the website's sources and settings (transfer), which the app imports on its first launch.
  let transfer = null;
  if (bring) {
    try {
      const [{ websitePayload }, { encodeLink }] = await Promise.all([import("./screens/importlink.js"), import("./core/transfer.js")]);
      transfer = await encodeLink(await websitePayload());
    } catch { /* an older browser: the certificate still goes */ }
  }
  try {
    const json = JSON.stringify({ ...JSON.parse(signBody({ url, p12: id.p12, profile: id.profile, password: id.password })), async: true,
      ...(bring ? { bring: true } : {}), ...(transfer ? { transfer } : {}) });
    const res = await fetch(`${server}/sign`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: json,
    });
    status = res.status;
    body = await res.json().catch(() => null);
    if (status === 202 && typeof body?.job === "string") ({ status, body } = await pollJob(server, body));
  } catch {
    hide();
    await showAlert({ title: "Couldn't Sign", message: `The signing server (${new URL(server).host}) can't be reached.`, buttons: ["OK"] });
    return false;
  }
  if (status !== 200 || !body?.itms) {
    hide();
    await showAlert({ title: name ? `Couldn't Sign ${name}` : "Couldn't Sign", message: errorText(status, body), buttons: ["OK"] });
    return false;
  }
  // The same HUD, relabelled: a second one fading in over the first would show both labels for a moment.
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  if (label) label.textContent = "Installing";
  else hide = showHUD("Installing");
  onInstalled(body);
  // On the website Safari asks first ("… would like to install …"): say which button to press.
  if (!globalThis.cydianNative) showBanner({ title: "Cydian", message: `Press Install to put ${name || "the app"} on your iPhone.`, duration: 5000 });
  location.href = body.itms;
  setTimeout(() => (hide.done ? hide.done("Done") : hide()), 1200); // iOS asks "Install …?": end on a checkmark, then fade
  return true;
}

const POLL_LIMIT_MS = 15 * 60 * 1000; // the server's own caps (download 300 s, zsign 300 s) end a job long before
const POLL_MISSES = 5;                 // polls in a row that may fail (a phone between networks) before giving up
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls GET <server>/sign/job/<job> until the job is done or failed. Resolves { status, body } as a synchronous
// POST would have answered: 200 and the link, or the error's own HTTP status and {error, code}. Throws (the
// caller says "can't be reached") after POLL_MISSES failed polls in a row.
export async function pollJob(server, first, { wait = sleep } = {}) {
  const started = Date.now();
  const every = Math.min(5, Math.max(0.5, Number(first.poll) || 1)) * 1000;
  let misses = 0;
  while (Date.now() - started < POLL_LIMIT_MS) {
    await wait(every);
    let r, b;
    try {
      r = await fetch(`${server}/sign/job/${encodeURIComponent(first.job)}`, { cache: "no-store" });
      b = await r.json().catch(() => null);
    } catch (e) {
      if (++misses >= POLL_MISSES) throw e;
      continue;
    }
    if (r.status >= 500 && !b?.status) {          // a proxy's hiccup, not the job's answer
      if (++misses >= POLL_MISSES) return { status: r.status, body: b };
      continue;
    }
    misses = 0;
    if (!r.ok) return { status: r.status, body: b };          // 404: the job is gone (a server restart)
    if (b?.status === "done") return { status: 200, body: b };
    if (b?.status === "error") return { status: Number(b.httpStatus) || 500, body: b };
    // downloading or signing: the "Signing" HUD stays up
  }
  return { status: 504, body: { error: "Signing took too long: try again later." } };
}

// ---- on the phone (F58): the sideload build signs and installs itself, through I6's signing.* bridge calls ------
//
//   localSigning()                     true in the sideload build (signingAvailable() stays the site's server signer)
//   await deviceStatus()               signing.status: { identity | null, identityProblem? }
//   statusReady(status)                F69: true when that status holds an identity (Install and Settings both ask)
//   await importToDevice({ p12, password, profile })   signing.import (files base64) -> status
//   await removeFromDevice()           signing.remove -> status
//   await firstInstallCheck()          F75: the walkthrough's missing step ("certificate" | "server"), opened, or null
//   await importFromSafari()           F75: a new key, then Safari at <server>/#/settings/signing-export.<key>
//   await finishSafariImport(url)      F75: cydian://signing-import#… opened with that key, into the Keychain -> status
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

// ---- Import from Safari (F75): the certificate the user added on the website, brought over encrypted ----------
// The app keeps a fresh 256-bit key for this one round trip (30 minutes) and opens the website with it in the URL
// fragment; the website's export page seals the identity under it and opens cydian://signing-import#<ciphertext>.

const SAFARI_KEY = "cydian.safariImport";
const SAFARI_TTL = 30 * 60 * 1000;

export async function importFromSafari({ server = getServer(), open = (u) => { location.href = u; }, storage = globalThis.localStorage, now = Date.now } = {}) {
  const key = newKey();
  storage.setItem(SAFARI_KEY, JSON.stringify({ key, at: now() }));
  open(exportUrl(server, key));
  return key;
}

// Throws with a message the alert shows: no round trip started here, it timed out, or it doesn't open.
export async function finishSafariImport(url, { native, storage = globalThis.localStorage, now = Date.now } = {}) {
  const sealed = sealedFrom(url);
  if (!sealed) throw new Error("That link holds no certificate.");
  let saved = null;
  try { saved = JSON.parse(storage.getItem(SAFARI_KEY) ?? "null"); } catch { /* none */ }
  if (!saved?.key || !(now() - saved.at < SAFARI_TTL)) {
    storage.removeItem(SAFARI_KEY);
    throw new Error("Start again with Import from Safari in Settings > Signing.");
  }
  let id;
  try { id = await openIdentity(sealed, saved.key); } catch {
    throw new Error("The certificate couldn't be read. Start again with Import from Safari in Settings > Signing.");
  }
  storage.removeItem(SAFARI_KEY); // one use
  return importToDevice(id, native);
}

// The website's half: the identity this origin keeps, sealed under the app's key, as the link back to the app.
export async function exportToApp(key) {
  const id = await loadIdentity();
  if (!id?.p12 || !id?.profile) return null;
  return importUrl(await sealIdentity(id, key));
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
export async function installOnDevice({ url, name = "", onInstalled = () => {}, params = null, after = null, host = false },
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
  if (after) { after(result, h); return true; }
  // iOS asks "Install …?" over the app: the HUD ends on a checkmark (signed and handed to iOS) and fades.
  later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return true;
}
