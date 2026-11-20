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
import { browserSigning } from "./common.js";
import { runInWorker } from "./common.js";
import { buffer } from "./early.js";

// identity.js imports this module (a save asks for confirmSoon), so its store is reached lazily from here.
const identityModule = () => import("./identity.js");
const loadIdentity = async () => (await identityModule()).loadIdentity();
const saveIdentity = async (patch) => (await identityModule()).saveIdentity(patch);

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
  try { leaf = await (read ?? (await import("../core/p12cert.js")).p12Leaf)(id.p12, id.password ?? "", subtle); } catch { leaf = null; }
  if (!leaf?.serial) return null;
  if (of) await Promise.resolve(save({ p12Cert: { of, serial: leaf.serial, team: leaf.team ?? null } })).catch(() => {});
  return { serial: leaf.serial, team: leaf.team ?? null };
}
