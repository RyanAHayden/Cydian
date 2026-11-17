// Sign & install with your own certificate (I5), the browser half of web/signer/. The parsing is core/signing.js;
// this file keeps the files, talks to the signing server and opens the install link.
//
//   await loadIdentity()         { p12, p12Name, password, profile, profileName } or null (IndexedDB, this phone only)
//   await saveIdentity(patch)    merges into the saved one;  await clearIdentity()
//   await signingReady()         true when a .p12 and a profile are saved (the site only)
//   getServer() / setServer(s)   Settings > Signing's server, https://cydian.dev unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled })   HUD "Signing", POST /sign, HUD "Installing", itms-services
//
// The certificate, key and password leave the phone only inside the POST to the signing server, over HTTPS, for
// that one request. Nothing goes to localStorage but the server's address.
import { DEFAULT_SERVER, normalizeServer, signBody, errorText } from "./core/signing.js";
import { detectMode } from "./core/settings.js";
import { showHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";

const DB = "cydian-signing";
const STORE = "identity";
const KEY = "current";
const SERVER_KEY = "cydian.signingServer";

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
  try { return (await tx("readonly", (s) => s.get(KEY))) ?? null; } catch { return null; }
}

export async function saveIdentity(patch) {
  const cur = (await loadIdentity()) ?? {};
  const next = { ...cur, ...patch, savedAt: Date.now() };
  await tx("readwrite", (s) => s.put(next, KEY));
  return next;
}

export async function clearIdentity() {
  await tx("readwrite", (s) => s.delete(KEY));
}

export const signingAvailable = () => detectMode() === "site";

export async function signingReady() {
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

export async function serverStatus(server = getServer()) {
  const r = await fetch(`${server}/sign/status`, { cache: "no-store" });
  if (!r.ok) throw new Error(errorText(r.status, null));
  return r.json();
}

// Signs `url` (an IPA) on the server and opens the install link it answers with. Resolves true once the link is
// opened; false after an error, which it shows in an alert.
export async function signAndInstall({ url, name = "", onInstalled = () => {} }) {
  const id = await loadIdentity();
  if (!id?.p12 || !id?.profile) {
    await showAlert({ title: "No Certificate", message: "Add your certificate and provisioning profile in Settings > Signing.", buttons: ["OK"] });
    return false;
  }
  const server = getServer();
  let hide = showHUD("Signing");
  let res, body = null;
  try {
    res = await fetch(`${server}/sign`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: signBody({ url, p12: id.p12, profile: id.profile, password: id.password }),
    });
    body = await res.json().catch(() => null);
  } catch {
    hide();
    await showAlert({ title: "Couldn't Sign", message: `The signing server (${new URL(server).host}) can't be reached.`, buttons: ["OK"] });
    return false;
  }
  if (!res.ok || !body?.itms) {
    hide();
    await showAlert({ title: name ? `Couldn't Sign ${name}` : "Couldn't Sign", message: errorText(res.status, body), buttons: ["OK"] });
    return false;
  }
  // The same HUD, relabelled: a second one fading in over the first would show both labels for a moment.
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  if (label) label.textContent = "Installing";
  else hide = showHUD("Installing");
  onInstalled(body);
  location.href = body.itms;
  setTimeout(hide, 2500); // iOS asks "Install …?" over the page; the HUD only bridges the wait for it
  return true;
}
