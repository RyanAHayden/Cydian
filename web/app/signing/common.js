// Signing's shared helpers (signing-client.js re-exports the public ones): the bridge, the build checks, the
// insecure-download alert, the malware hash, and the progress page's Cancel.
import { detectMode } from "../core/settings.js";
import { showAlert } from "../nav/alert.js";
import { isInsecure, INSECURE_IPA_ALERT, INSTALL_ANYWAY } from "../core/insecureipa.js";
import { malwareHashes, rememberSigned } from "../core/malicious.js";

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
export const failed = (h, message) => (typeof h.fail === "function" ? h.fail(message) : h.hide());

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
export function stopNative(native) {
  try { Promise.resolve(bridge(native).call("signing.cancel", {})).catch(() => {}); } catch { /* no bridge */ }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const localSigning = () => detectMode() === "sideload";

export const bridge = (native) => {
  const n = native ?? globalThis.ifizboxNative;
  if (!n?.call) throw Object.assign(new Error("This build has no signer."), { code: "internal" });
  return n;
};

// The shell (native CloseForUpdate) closes iFizBox only once iOS has fetched the whole new IPA from the Signing
// Server; signing.selfUpdate streams how far it is. The locked page (lockSelfUpdate) gets a line a step, and when iOS
// never took the update (notStarted, stalled) its buttons back with Try Again (`retry`). An older shell, without the
// call, leaves the page as B49 does. -> the last state, or null.
export const storageOf = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export const browserSigning = () => detectMode() === "site";
// Bytes as an ArrayBuffer of their own, for the signing worker (early.js re-exports it).
export const buffer = (b) => (b instanceof Uint8Array ? b.slice().buffer : b instanceof ArrayBuffer ? b.slice(0) : new Uint8Array(b ?? []).buffer);
