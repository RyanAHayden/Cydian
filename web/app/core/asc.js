// Own provisioning profiles: iFizBox talks to App Store Connect with the user's API key (AuthKey_<KeyID>.p8) and makes
// the App ID and Ad Hoc profile each app needs, instead of the user importing a .mobileprovision that goes stale when
// an iPhone is added and only covers one App ID. Pure JS + WebCrypto; the transport is passed in (`request(method,
// path, body)`, see httpTransport): on the website the base is the Worker's /apple/api.appstoreconnect.apple.com/v1
// pass-through, because Apple sends no CORS headers (worker/src/apple-relay.js). The .p8 and the JWT go only to
// Apple (or that pass-through), and are never logged.
//
//   keyIdFromName("AuthKey_ABC123DEF4.p8")   -> "ABC123DEF4" | null
//   await makeJwt({ p8, keyId, issuerId, now }) -> the ES256 bearer token (header kid/typ, claims iss/iat/exp/aud)
//   httpTransport({ base, token, fetcher })   -> request(method, path, body): JSON | {} ; throws AscError
//   appIdFor(bundleId, prefix)                <prefix>.<last component of the app's ID> (one App ID per app, so
//                                             keychains don't mix: Keep Bundle IDs, core/keepid.js)
//   appIdPrefix(profileAppId, teamId)         the prefix from the imported profile's App ID, else <name>.<team>
//   remakeReason(cached, { udid, capabilities, certId, now })
//                                             -> null | "missing" | "expired" | "device" | "capabilities" | "certificate"
//   await ensureDevice / findCertificate / ensureAppId / ensureProfile(...)   the steps (the same requests as
//                                             sidedrop's register, cert_id, ensure_app_id, regen_profile)
//   makeCertificate(request, csr) / distributionCerts / revokeCertificate   Apple Distribution certificates
//                                             (Admin keys; revoke only the one the user picks)
//   certsForPicker(request, ownSerials)      the revoke picker's list (both distribution kinds, `ours` marked)
//   await newCertificate({ request, revokeId })   key + CSR made here, POST /certificates, packed as a .p12
//   await makeOwnSigning({ request, ... })    newCertificate + the profile for this app's own App ID (Make Certificate)
//   await profileForP12({ request, serials }) the own App ID's profile for a .p12 imported without one
//   certTeam(cert)                            the team ID (subject OU) in an Apple certificate
//   profileSerials(mobileprovision)         the serials of the certificates a profile lists (for findCertificate)
//   profileRows(cache)                        the Provisioning Profile rows for the cache
//
// The profile cache (the caller keeps it, e.g. as JSON in storage): { [App ID identifier]: entry }, entry =
//   { identifier, bundleIdId, id, name, content (the .mobileprovision, base64), expires (ISO), udids,
//     capabilities, certId, push, made (ISO) }
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME, BUNDLE_ID } from "../brand.js";
import { parsePlist, parseProfile, normalUdid } from "./signing.js";
import { unpem, certSerial, makeKey, makeCsr, makeP12, sameKey, newPassword } from "./freecert.js";

export const ASC_API = "https://api.appstoreconnect.apple.com/v1";
export const AUD = "appstoreconnect-v1";
export const TOKEN_LIFE = 15 * 60; // seconds; Apple refuses more than 20 minutes
// Push must work; App Groups and Associated Domains are what many apps ask for (sidedrop's APP_ID_CAPS).
export const APP_ID_CAPS = ["PUSH_NOTIFICATIONS", "APP_GROUPS", "ASSOCIATED_DOMAINS"];
const EXPIRY_MARGIN = 24 * 3600 * 1000; // remake a day before Apple's date, so a sign never gets an expiring profile

export class AscError extends Error {
  constructor(message, { status = 0, code = null } = {}) { super(message); this.status = status; this.code = code; }
}

export function keyIdFromName(name) {
  const m = /AuthKey_([A-Z0-9]{8,12})\.p8$/i.exec(String(name ?? "").split(/[\\/]/).pop());
  return m ? m[1].toUpperCase() : null;
}

const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const te = new TextEncoder();

// The .p8 is a PKCS#8 P-256 key; WebCrypto's ECDSA signature is already JWS's raw r||s.
export async function makeJwt({ p8, keyId, issuerId, now = Date.now(), life = TOKEN_LIFE, subtle = globalThis.crypto.subtle }) {
  if (!keyId || !issuerId) throw new AscError("The Key ID and Issuer ID are needed.");
  const key = await subtle.importKey("pkcs8", typeof p8 === "string" ? unpem(p8) : p8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const head = b64url(te.encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })));
  const body = b64url(te.encode(JSON.stringify({ iss: issuerId, iat, exp: iat + Math.min(life, 20 * 60), aud: AUD })));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

// Apple's error body: {errors: [{status, code, title, detail}]}.
export function errorText(status, text) {
  try {
    const e = JSON.parse(text)?.errors?.[0];
    if (e) return { message: e.detail || e.title || `HTTP ${status}`, code: e.code ?? null };
  } catch { /* not JSON */ }
  return { message: `HTTP ${status}`, code: null };
}

// fetch-based transport. `token` is a function (a fresh JWT per call is cheap) or a string.
export function httpTransport({ base = ASC_API, token, fetcher = globalThis.fetch, headers = {} }) {
  return async (method, path, body) => {
    const t = typeof token === "function" ? await token() : token;
    let r;
    try {
      r = await fetcher(base + path, { method, credentials: "omit", cache: "no-store",
        headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new AscError(`Couldn't reach App Store Connect (${e?.message ?? e}).`); }
    const text = await r.text();
    if (r.status >= 400) {
      const { message, code } = errorText(r.status, text);
      throw new AscError(`App Store Connect ${method} ${path.split("?")[0]}: ${message}`, { status: r.status, code });
    }
    return text ? JSON.parse(text) : {};
  };
}

const q = (o) => `?${new URLSearchParams(o)}`;
const rel = (type, ids) => ({ data: ids.map((id) => ({ type, id })) });

// ---- naming ----
export function appIdFor(bundleId, prefix) {
  const last = String(bundleId ?? "").split(".").filter(Boolean).pop() || "app";
  // ponytail: two apps with the same last component (com.a.app, com.b.app) share an App ID; add the second to last
  // if that turns up in practice
  return `${String(prefix).replace(/\.\*?$/, "")}.${last.replace(/[^A-Za-z0-9-]/g, "-")}`;
}
export function appIdPrefix(profileAppId, teamId) {
  const id = String(profileAppId ?? "").replace(/\.\*$/, "");
  if (id && id !== "*" && id.includes(".")) return profileAppId.endsWith(".*") ? id : id.split(".").slice(0, -1).join(".");
  return `${NAME.toLowerCase()}.${String(teamId ?? "app").toLowerCase()}`;
}
export const profileName = (identifier) => `${NAME} ${identifier}`.slice(0, 120);

// ---- remake rules ----
export function remakeReason(cached, { udid = null, capabilities: caps = null, certId = null, now = Date.now() } = {}) {
  if (!cached?.content) return "missing";
  const exp = cached.expires ? new Date(cached.expires).getTime() : 0;
  if (!exp || exp - EXPIRY_MARGIN <= now) return "expired";
  if (udid && !(cached.udids ?? []).map(normalUdid).includes(normalUdid(udid))) return "device";
  if (caps && [...caps].sort().join() !== [...(cached.capabilities ?? [])].sort().join()) return "capabilities";
  if (certId && cached.certId && certId !== cached.certId) return "certificate";
  return null;
}
export const REASON_TEXT = { missing: "None yet", expired: "Expired", device: "This iPhone wasn't in it",
  capabilities: "The App ID's capabilities changed", certificate: "The certificate changed" };

// ---- steps ----
export async function ensureDevice(request, udid, name = "iPhone") {
  const u = normalUdid(udid);
  if (!u) throw new AscError("This iPhone's UDID isn't known yet.", { code: "no-udid" });
  const got = (await request("GET", `/devices${q({ "filter[udid]": u, limit: 200 })}`)).data ?? [];
  if (got.some((d) => normalUdid(d.attributes?.udid) === u)) return { made: false };
  await request("POST", "/devices", { data: { type: "devices", attributes: { name: String(name).slice(0, 50), udid: u, platform: "IOS" } } });
  return { made: true };
}

// The account's certificate whose serial is one of `serials` (the .p12's, upper-case hex), or null.
export async function findCertificate(request, serials) {
  const want = new Set([].concat(serials).filter(Boolean).map((s) => String(s).toUpperCase().replace(/^0+/, "")));
  for (const c of (await request("GET", `/certificates${q({ limit: 200 })}`)).data ?? []) {
    if (want.has(String(c.attributes?.serialNumber ?? "").toUpperCase().replace(/^0+/, ""))) return c;
  }
  return null;
}

// The explicit App ID (made with APP_ID_CAPS if the account lacks it): { id, identifier, made }.
export async function ensureAppId(request, identifier) {
  // the filter is a prefix match
  const found = ((await request("GET", `/bundleIds${q({ "filter[identifier]": identifier, limit: 200 })}`)).data ?? [])
    .find((b) => b.attributes?.identifier === identifier);
  if (found) return { id: found.id, identifier, made: false };
  const made = (await request("POST", "/bundleIds", { data: { type: "bundleIds",
    attributes: { identifier, name: `${NAME} ${identifier.split(".").pop()}`.slice(0, 60), platform: "IOS" } } })).data;
  for (const cap of APP_ID_CAPS) {
    try {
      await request("POST", "/bundleIdCapabilities", { data: { type: "bundleIdCapabilities", attributes: { capabilityType: cap },
        relationships: { bundleId: { data: { type: "bundleIds", id: made.id } } } } });
    } catch (e) { if (cap === "PUSH_NOTIFICATIONS") throw e; } // the others are nice to have
  }
  return { id: made.id, identifier, made: true };
}

export async function appIdCaps(request, bundleIdId) {
  // No query string: Apple answers 400 PARAMETER_ERROR.ILLEGAL to 'limit' on this path (real call 2026-11-19).
  const r = await request("GET", `/bundleIds/${bundleIdId}/bundleIdCapabilities`);
  return (r.data ?? []).map((c) => c.attributes?.capabilityType).filter(Boolean).sort();
}

const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// The profile for one app: reuses the cached one unless remakeReason says otherwise. `cache` is {[identifier]: entry}
// (changed in place; the caller saves it; the entry shape is in the header). Returns { entry, made, reason, appId,
// deviceMade }. `certId`, when the caller already knows the certificate's ASC id, also remakes a profile made with
// another certificate; without it a reused profile costs one call (the App ID's capabilities).
export async function ensureProfile({ request, bundleId, prefix, udid, deviceName, serials, certId = null, cache = {}, now = Date.now() }) {
  const identifier = appIdFor(bundleId, prefix);
  let cached = cache[identifier] ?? null;
  let appId = cached?.bundleIdId ? { id: cached.bundleIdId, identifier, made: false } : null;
  let caps = null;
  if (appId) {
    try { caps = await appIdCaps(request, appId.id); } catch (e) { if (e.status !== 404) throw e; appId = null; cached = null; }
  }
  if (!appId) {
    appId = await ensureAppId(request, identifier);
    caps = await appIdCaps(request, appId.id);
  }
  const reason = remakeReason(cached, { udid, capabilities: caps, certId, now });
  if (!reason) return { entry: cached, made: false, reason: null, appId: identifier, deviceMade: false };

  const deviceMade = udid ? (await ensureDevice(request, udid, deviceName)).made : false;
  const cert = await findCertificate(request, serials);
  if (!cert) throw new AscError("Your certificate isn't in this developer account.", { code: "no-cert" });
  const devices = (await request("GET", `/devices${q({ "filter[platform]": "IOS", "filter[status]": "ENABLED", limit: 200 })}`)).data ?? [];
  const name = profileName(identifier);
  for (const p of (await request("GET", `/profiles${q({ "filter[name]": name, limit: 200 })}`)).data ?? []) {
    await request("DELETE", `/profiles/${p.id}`); // names are unique: the old one goes first
  }
  const created = (await request("POST", "/profiles", profileBody({ name, bundleIdId: appId.id, certId: cert.id, deviceIds: devices.map((d) => d.id) }))).data;
  const content = created.attributes.profileContent;
  const info = parseProfile(b64decode(content));
  const entry = { identifier, bundleIdId: appId.id, id: created.id, name, content, expires: info.expires?.toISOString() ?? null,
    udids: info.udids, capabilities: caps, certId: cert.id, push: info.push, made: new Date(now).toISOString() };
  cache[identifier] = entry;
  return { entry, made: true, reason, appId: identifier, deviceMade };
}

export function profileBody({ name, bundleIdId, certId, deviceIds }) {
  return { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_ADHOC" },
    relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdId } }, certificates: rel("certificates", [certId]),
      devices: rel("devices", deviceIds) } } };
}

// A new Apple Distribution certificate from a CSR (PEM). Needs an Admin key; Apple refuses at its limit (the caller
// asks which one to revoke: never on its own).
export async function makeCertificate(request, csr) {
  const r = await request("POST", "/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } } });
  return { id: r.data.id, cert: b64decode(r.data.attributes.certificateContent), expires: r.data.attributes.expirationDate ?? null };
}
export async function distributionCerts(request) {
  return ((await request("GET", `/certificates${q({ "filter[certificateType]": "DISTRIBUTION,IOS_DISTRIBUTION", limit: 200 })}`)).data ?? [])
    .map((c) => ({ id: c.id, name: c.attributes?.displayName || c.attributes?.name || "", serial: c.attributes?.serialNumber ?? "",
      expires: c.attributes?.expirationDate ?? null }));
}
export const revokeCertificate = (request, id) => request("DELETE", `/certificates/${id}`);

// ---- Make Certificate (an API key and no .p12) ----
// The key and CSR are made here (the phone's WebView or the browser) and never sent anywhere; only the CSR goes to
// Apple. At Apple's limit the caller lists distributionCerts and the user picks the one to revoke (never chosen here).
export const KEY_ROLE_TEXT = "Apple refused: making certificates needs an API key with the Admin role (App Manager keys can "
  + "register iPhones but not make certificates). Make an Admin key in App Store Connect > Users and Access > Integrations, "
  + "or import your own .p12.";
export const LIMIT_TEXT = "Your account already has as many Apple Distribution certificates as Apple allows. Pick one to "
  + `revoke and ${NAME} makes a new one in its place.`;
export const REVOKE_WARNING = "Apps signed with the revoked certificate stop opening, on every iPhone, wherever they were "
  + "signed (another signing service, Xcode ad hoc builds); App Store and TestFlight apps aren't affected.";

// The certificates for the revoke picker: Apple Distribution and the older iOS Distribution share the limit.
// `ownSerials` marks the one this app signs with (`ours`), so the picker can say so.
export async function certsForPicker(request, ownSerials = []) {
  const mine = new Set([].concat(ownSerials).filter(Boolean).map((s) => String(s).toUpperCase().replace(/^0+/, "")));
  const r = await request("GET", `/certificates${q({ "filter[certificateType]": "DISTRIBUTION,IOS_DISTRIBUTION", limit: 200 })}`);
  return (r.data ?? []).filter((c) => ["DISTRIBUTION", "IOS_DISTRIBUTION"].includes(c.attributes?.certificateType ?? "DISTRIBUTION"))
    .map((c) => ({ id: c.id, name: c.attributes?.displayName || c.attributes?.name || c.id,
      kind: c.attributes?.certificateType === "IOS_DISTRIBUTION" ? "iOS Distribution" : "Apple Distribution",
      serial: c.attributes?.serialNumber ?? "", expires: c.attributes?.expirationDate ?? null,
      ours: mine.has(String(c.attributes?.serialNumber ?? "").toUpperCase().replace(/^0+/, "")) }))
    .sort((a, b) => String(b.expires ?? "").localeCompare(String(a.expires ?? ""))); // newest first (a year from made)
}

// The team ID in an Apple certificate: the subject's OU (the issuer's OU, "G3", comes before it in the DER).
export function certTeam(cert) {
  const b = cert instanceof Uint8Array ? cert : new Uint8Array(cert);
  let team = null;
  for (let i = 0; i + 6 < b.length; i++) {
    if (b[i] === 0x06 && b[i + 1] === 3 && b[i + 2] === 0x55 && b[i + 3] === 0x04 && b[i + 4] === 0x0b) {
      const n = b[i + 6];
      const v = String.fromCharCode(...b.slice(i + 7, i + 7 + n));
      if (/^[A-Z0-9]{10}$/.test(v)) team = v;
    }
  }
  return team;
}

// A new Apple Distribution certificate packed as a .p12: { certId, cert, serial, team, expires, p12, password }.
// `revokeId`: the certificate the user picked at the limit, revoked first (refused if it's no longer listed).
// Errors (AscError .code): "key-role" (not an Admin key), "key-refused", "cert-limit" and "cert-gone" (both with
// .certs, the picker's list), else Apple's.
export async function newCertificate({ request, revokeId = null, ownSerials = [], password = newPassword(), subtle } = {}) {
  if (revokeId) {
    const listed = await certsForPicker(request, ownSerials);
    if (!listed.some((c) => c.id === revokeId)) {
      throw Object.assign(new AscError("That certificate isn't in your account any more. Pick another.", { code: "cert-gone" }), { certs: listed });
    }
    await revokeCertificate(request, revokeId);
  }
  const key = await makeKey(subtle);
  const csr = await makeCsr({ privateKey: key.privateKey, spki: key.spki, cn: NAME }, subtle); // Apple sets its own subject
  let made;
  try { made = await makeCertificate(request, csr); } catch (e) {
    if (e.status === 403) throw new AscError(KEY_ROLE_TEXT, { status: 403, code: "key-role" });
    if (e.status === 401) throw new AscError("Apple didn't accept the API key: check the Key ID and Issuer ID belong to this .p8.", { status: 401, code: "key-refused" });
    if (e.status === 409) {
      const listed = await certsForPicker(request, ownSerials);
      if (listed.length) throw Object.assign(new AscError(LIMIT_TEXT, { status: 409, code: "cert-limit" }), { certs: listed });
    }
    throw e;
  }
  if (!sameKey(made.cert, key.spki)) throw new AscError("Apple's certificate isn't for the key made here.", { code: "cert-key" });
  const p12 = await makeP12({ pkcs8: key.pkcs8, cert: made.cert, password, name: NAME }, subtle);
  return { certId: made.id, cert: made.cert, serial: certSerial(made.cert), team: certTeam(made.cert), expires: made.expires, p12, password };
}

// Make Certificate, the whole "API key only" setup: the certificate, then the App ID and Ad Hoc profile for this
// app's own App ID (the app's signing.import needs a profile with the .p12). `prefix` defaults to appIdPrefix(null,
// <the certificate's team>). The .p12 exists only in memory until the caller imports it, so a failed profile doesn't
// throw it away: it comes back with `profileError` and the caller imports the .p12 and makes the profile later.
// -> { ...newCertificate's, identifier, profile (the .mobileprovision, base64) | null, entry | null, profileError | null }
export async function makeOwnSigning({ request, bundleId = BUNDLE_ID, prefix = null, udid = null, deviceName, cache = {},
  revokeId = null, ownSerials = [], password, subtle, now = Date.now() } = {}) {
  const made = await newCertificate({ request, revokeId, ownSerials, password, subtle });
  const pre = prefix ?? appIdPrefix(null, made.team);
  const out = { ...made, identifier: appIdFor(bundleId, pre), profile: null, entry: null, profileError: null };
  try {
    const r = await ensureProfile({ request, bundleId, prefix: pre, udid, deviceName, serials: [made.serial], certId: made.certId, cache, now });
    out.entry = r.entry;
    out.profile = r.entry.content;
  } catch (e) { out.profileError = e; }
  return out;
}

// A .p12 imported alone (no .mobileprovision) by a key user: the profile for this app's own App ID comes from the key.
// `serials`: the .p12's certificate serial(s). -> ensureProfile's result (AscError "no-cert" when it isn't in the account).
export const profileForP12 = ({ request, serials, bundleId = BUNDLE_ID, prefix, team = null, udid = null, deviceName, cache = {}, now = Date.now() }) =>
  ensureProfile({ request, bundleId, prefix: prefix ?? appIdPrefix(null, team), udid, deviceName, serials, cache, now });

// The serials of the certificates an imported profile lists (the website's .p12 is one of them).
export function profileSerials(profileBytes) {
  const b = profileBytes instanceof Uint8Array ? profileBytes : new Uint8Array(profileBytes);
  const s = new TextDecoder().decode(b);
  const xml = s.slice(s.indexOf("<?xml"), s.lastIndexOf("</plist>") + 8);
  const out = [];
  for (const c of parsePlist(xml).DeveloperCertificates ?? []) { try { out.push(certSerial(c)); } catch { /* unreadable */ } }
  return out;
}

// The rows for Settings' Provisioning Profiles (made by iFizBox): one per App ID, newest first.
export function profileRows(cache = {}, now = Date.now()) {
  return Object.values(cache).filter((e) => e?.identifier).sort((a, b) => String(b.made).localeCompare(String(a.made)))
    .map((e) => {
      const until = e.expires ? new Date(e.expires) : null;
      const expired = !until || until.getTime() <= now;
      return { label: e.identifier, subtitle: `Ad Hoc, ${(e.udids ?? []).length} devices${e.push ? ", Push" : ""}, `
        + (expired ? "expired" : `until ${until.toISOString().slice(0, 10)}`) };
    });
}
