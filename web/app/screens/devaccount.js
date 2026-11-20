// Settings > Installation & Signing: Apple Developer Account. With an App Store Connect API key (AuthKey_<KeyID>.p8,
// the Key ID read from its name, the Issuer ID typed) iFizBox makes each app's App ID and Ad Hoc profile itself, with
// Push, and registers this iPhone (core/asc.js; in the app native/Sources/ASC.swift does it while it signs).
//   app       the key goes into the Keychain (asc.key.set) and never comes back to the page
//   website   the key stays in this browser (localStorage, like the .p12), and calls go through the site's
//             /apple/api.appstoreconnect.apple.com pass-through (Apple sends no CORS headers)
//
//   accountGroup({ native, redraw })     the group for the Signing page
//   await autoProfileSite({ ipa, id, bundleId, keep, log })   the website's sign-time step: the profile bytes made for
//                                        this app, or null to sign with the imported one
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert, alertOK } from "../nav/alert.js";
import { NAME } from "../brand.js";
import { keyIdFromName, makeJwt, httpTransport, ensureProfile, appIdPrefix, profileRows, profileSerials, findCertificate, ensureDevice } from "../core/asc.js";
import { parseProfile, fromBase64, normalUdid } from "../core/signing.js";
import { storedUdid } from "./signing.js";

const KEY = "ifizbox.asc";
const CACHE = "ifizbox.asc.profiles";
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const readJson = (k) => { try { return JSON.parse(ls()?.getItem(k) ?? "null"); } catch { return null; } };
const writeJson = (k, v) => { try { v == null ? ls()?.removeItem(k) : ls()?.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };
const nativeOf = (native) => native ?? globalThis.ifizboxNative ?? null;

export const siteKey = () => { const k = readJson(KEY); return k?.p8 && k.keyId && k.issuerId ? k : null; };
export function siteRequest(k = siteKey(), { origin = globalThis.location?.origin ?? "", fetcher } = {}) {
  return httpTransport({ base: `${origin}/apple/api.appstoreconnect.apple.com/v1`, token: () => makeJwt(k), ...(fetcher ? { fetcher } : {}) });
}
const nativeRequest = (n) => (method, path, body) => n.call("asc.request", { method, path: `/v1${path}`, ...(body ? { body } : {}) });

async function keyInfo(native) {
  const n = nativeOf(native);
  if (n?.call) { try { return await n.call("asc.key.info", {}); } catch { return null; } }
  const k = siteKey();
  return k ? { keyId: k.keyId, issuerId: k.issuerId } : null;
}
async function cache(native) {
  const n = nativeOf(native);
  if (n?.call) { try { return (await n.call("asc.profiles", {})) ?? {}; } catch { return {}; } }
  return readJson(CACHE) ?? {};
}

// The .p8 picked, then the Issuer ID asked; saved only once Apple takes a token made from them.
async function addKey(file, native, redraw) {
  const keyId = keyIdFromName(file?.name);
  const p8 = await file.text();
  if (!/BEGIN PRIVATE KEY/.test(p8)) return alertOK("Not an API Key", "Pick the AuthKey_<Key ID>.p8 you downloaded from App Store Connect > Users and Access > Integrations.");
  let kid = keyId;
  if (!kid) {
    const r = await showAlert({ title: "Key ID", message: "The file name doesn't hold the Key ID. Type it (10 characters).", input: { type: "text", placeholder: "ABC123DEF4" }, buttons: ["Cancel", "Next"], cancel: 0 });
    if (r.index !== 1) return;
    kid = String(r.value ?? "").trim().toUpperCase();
  }
  const r = await showAlert({ title: "Issuer ID", message: `Key ${kid}. Type the Issuer ID shown above the keys in App Store Connect > Users and Access > Integrations.`,
    input: { type: "text", placeholder: "69a6de7e-...-5b8c7c11a4d1" }, buttons: ["Cancel", "Save"], cancel: 0 });
  if (r.index !== 1) return;
  const issuerId = String(r.value ?? "").trim();
  const n = nativeOf(native);
  try {
    if (n?.call) await n.call("asc.key.set", { p8, keyId: kid, issuerId });
    else {
      const k = { p8, keyId: kid, issuerId };
      await siteRequest(k)("GET", "/certificates?limit=1"); // Apple must take it before it's kept
      writeJson(KEY, k);
    }
  } catch (e) {
    return alertOK("Key Not Accepted", String(e?.message ?? e).replace(/^\w+: /, ""));
  }
  redraw();
}

async function removeKey(native, redraw) {
  const { index } = await showAlert({ title: "Remove API Key?", message: `${NAME} stops making profiles. The profiles it made stay in your account.`,
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  const n = nativeOf(native);
  if (n?.call) await n.call("asc.key.remove", {}).catch(() => null);
  else { writeJson(KEY, null); writeJson(CACHE, null); }
  redraw();
}

// Where the UDID comes from when it's really needed: the Pairing row shows only once This iPhone is picked.
export const PAIR_HINT = "This iPhone's UDID isn't known: in Settings > Installation & Signing, pick Install Apps With: This iPhone, "
  + "then pair it under This iPhone > Pairing, and check again.";
const SITE_HINT = "This iPhone's UDID isn't known: use Find This iPhone's UDID under the profile.";

// Check Account's line about this iPhone. With its UDID: register it if missing. Without one but with candidates (the
// devices in the running app's own profile, one of them this iPhone, all of them the team's): every one registered
// and enabled means this iPhone is too; otherwise name the ones that aren't. Neither: say how to get the UDID.
export async function deviceLine(request, { udid = null, candidates = [], app = true } = {}) {
  if (udid) {
    const { made } = await ensureDevice(request, udid, "iPhone");
    return made ? `This iPhone (${normalUdid(udid)}) was added to the account.` : "This iPhone is in the account.";
  }
  const want = [...new Set([].concat(candidates ?? []).map(normalUdid).filter(Boolean))];
  if (!want.length) return app ? PAIR_HINT : SITE_HINT;
  const devices = (await request("GET", "/devices?limit=200")).data ?? [];
  const status = new Map(devices.map((d) => [normalUdid(d.attributes?.udid), d.attributes?.status ?? "ENABLED"]));
  const missing = want.filter((u) => !status.has(u));
  const disabled = want.filter((u) => status.has(u) && status.get(u) !== "ENABLED");
  const iphones = want.length === 1 ? "the iPhone" : `one of the ${want.length} iPhones`;
  if (!missing.length && !disabled.length) return `This iPhone is in the account (${iphones} in this app's profile).`;
  const parts = [];
  if (missing.length) parts.push(`not in the account: ${missing.join(", ")}`);
  if (disabled.length) parts.push(`disabled: ${disabled.join(", ")}`);
  return `This iPhone is ${iphones} in this app's profile. Of those, ${parts.join("; ")}. If one of them is this iPhone, `
    + `the profiles ${NAME} makes leave it out: pair it (Settings > Installation & Signing > Install Apps With: This iPhone, `
    + "then This iPhone > Pairing) and check again to add it.";
}

// Check Account: is the certificate in the account, is this iPhone registered (and register it).
async function checkAccount(native) {
  const n = nativeOf(native);
  const lines = [];
  try {
    const request = n?.call ? nativeRequest(n) : siteRequest();
    let serials = [], udid = null, candidates = [];
    if (n?.call) {
      const st = await n.call("signing.status", {}).catch(() => null);
      serials = st?.identity?.serial ? [st.identity.serial] : [];
      const dev = await n.call("device.udid", {}).catch(() => null);
      udid = dev?.udid ?? null;
      candidates = Array.isArray(dev?.candidates) ? dev.candidates : [];
      if (!udid) udid = (await n.call("asc.udid", {}).catch(() => null))?.udid ?? null;
    } else {
      const id = await (await import("../signing-client.js")).loadIdentity();
      serials = id?.profile ? profileSerials(id.profile) : [];
      udid = storedUdid()?.udid ?? null;
    }
    if (serials.length) {
      const c = await findCertificate(request, serials);
      lines.push(c ? `Certificate: in the account (${c.attributes?.displayName || c.attributes?.name || c.id}).`
        : "Certificate: not in this account. Import the .p12 of one of this account's certificates (Apple Distribution).");
    } else lines.push("Certificate: none imported yet.");
    lines.push(await deviceLine(request, { udid, candidates, app: !!n?.call }));
  } catch (e) {
    lines.push(String(e?.message ?? e).replace(/^\w+: /, ""));
  }
  await alertOK("Developer Account", lines.join("\n\n"));
}

export function accountGroup({ native, redraw = () => {} } = {}) {
  const box = document.createElement("div");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".p8";
  input.hidden = true;
  input.addEventListener("change", () => { const f = input.files?.[0]; input.value = ""; if (f) addKey(f, native, redraw); });
  const footer = `With an App Store Connect API key, ${NAME} makes an App ID and an Ad Hoc profile (with Push) for each app it signs `
    + "with Keep Bundle IDs on, and adds this iPhone to your account. Use a key with the Admin or App Manager role. "
    + (nativeOf(native)?.call ? "The key stays in this iPhone's Keychain and goes only to Apple." : "The key stays in this browser; calls pass through this site to Apple, which keeps nothing.");
  (async () => {
    const info = await keyInfo(native);
    const rows = info
      ? [{ label: "API Key", detail: info.keyId }, { label: "Issuer ID", subtitle: info.issuerId },
        { label: "Check Account", onClick: () => checkAccount(native) }, { label: "Remove API Key", onClick: () => removeKey(native, redraw) }]
      : [{ label: "Add API Key", subtitle: "AuthKey_<Key ID>.p8, recommended", chevron: true, cls: "asc-add", onClick: () => input.click() }];
    const made = info ? profileRows(await cache(native)) : [];
    const frag = grouped([{ header: "Apple Developer Account", rows, footer }, ...(made.length ? [{ header: `Profiles Made by ${NAME}`, rows: made }] : [])]);
    frag.querySelector(".asc-add")?.append(input);
    box.replaceChildren(frag);
  })();
  return box;
}

// ---- the website's sign-time step ----
export async function autoProfileSite({ ipa, id, bundleId = null, keep = true, log = () => {} }) {
  const k = siteKey();
  if (!k || !keep || !id?.profile) return null;
  let own = bundleId;
  if (!own) {
    try { own = (await (await import("../core/ipainfo.js")).readIpaFile(ipa)).bundleId; } catch { return null; }
  }
  const base = parseProfile(id.profile);
  const c = readJson(CACHE) ?? {};
  const r = await ensureProfile({ request: siteRequest(k), bundleId: own, prefix: appIdPrefix(base.appId, base.teamId),
    udid: storedUdid()?.udid ?? null, deviceName: "iPhone", serials: profileSerials(id.profile), cache: c });
  writeJson(CACHE, c);
  log(r.made ? `Profile ${r.appId}: made by ${NAME} (${r.reason})${r.deviceMade ? ", this iPhone added to the account" : ""}` : `Profile ${r.appId}: made by ${NAME}, reused`);
  return fromBase64(r.entry.content);
}
