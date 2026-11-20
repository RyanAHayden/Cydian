// Signing's identity (Settings > Signing's picks), the website's Bring My Certificate switch and the Signing Server.
import { APP_SERVER, normalizeServer, LEGACY_SERVER } from "../core/signing.js";
import { browserSigning, localSigning, sleep } from "./common.js";
import { readyStatus, statusReady } from "./device.js";
import { confirmSoon, needsConfirm } from "./password.js";

const SERVER_KEY = "ifizbox.signingServer";

// The picks wait in memory only, until signing.import puts them into the Keychain; then only their names stay (the
// .p12 itself never goes to the web view's storage). F93: the website keeps them in IndexedDB (this browser only:
// they never leave it but inside iFizBox's own IPA with Bring My Certificate), as it did before F89.
let staged = null;
// F121: the website's identity as last read from or written to IndexedDB, for Install's tap to use without waiting
// (identityNow); warmed when this module loads on the website.
let known = null;
export const identityNow = () => known;
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
