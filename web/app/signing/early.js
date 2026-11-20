// ---- F121: Install opens iOS's install prompt inside its own tap, before signing ----------------------------------
//
// Safari opens an itms-services link only inside the user's tap, and signing outlasts it: so the link opens first,
// for a token the website makes itself (/sign/up/<token>/manifest.plist), and the Worker holds iOS's requests until
// the upload is there (app.ipa, up to 2 minutes; the manifest answers from its URL's query, the reservation just
// binds the token to the app). That needs the
// bundle ID the app will be signed as before it's downloaded: an explicit profile's, or a wildcard profile's for an
// app whose own ID is known (iFizBox's, or the caller's bundleId). Otherwise, and whenever the early link can't be
// used (another bundle ID came out, the reservation failed, it took too long), the Ready to Install alert as before.
import { deviceCheck, parseProfile, notLandedText, notInProfileText } from "../core/signing.js";
import { profileInfo, IFIZBOX_ID, targetBundleId } from "../core/websign.js";
import { storedKeep } from "../core/keepid.js";
import { isSelfIpa } from "./install.js";
import { retrying, signFail } from "./browser.js";

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
export async function keptBytes(src) {
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
  try { return (await import("../screens/signing.js")).storedUdid(); } catch { return null; }
}

export { buffer } from "./common.js"; // C32: lives there, so password.js needs no early.js at startup
