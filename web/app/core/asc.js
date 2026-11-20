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
//   await profileForAnyP12({ request })       the same when the .p12's serial isn't known: every distribution certificate
//   certTeam(cert)                            the team ID (subject OU) in an Apple certificate
//   profileSerials(mobileprovision)         the serials of the certificates a profile lists (for findCertificate)
//   profileRows(cache)                        the Provisioning Profile rows for the cache
//
//   addCaps / refusedCaps                     APP_ID_CAPS on an App ID; what Apple refused, remembered per team
//
// The profile cache (the caller keeps it, e.g. as JSON in storage): { [App ID identifier]: entry }, entry =
//   { identifier, bundleIdId, id, name, content (the .mobileprovision, base64), expires (ISO), udids,
//     capabilities, certId, push, made (ISO), team }, plus REFUSED_KEY ("#refused"): the refused capabilities
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME, BUNDLE_ID } from "../brand.js";
import { parsePlist, parseProfile, normalUdid } from "./signing.js";
import { unpem, certSerial, makeKey, makeCsr, makeP12, sameKey, newPassword } from "./freecert.js";

export const ASC_API = "https://api.appstoreconnect.apple.com/v1";
export const AUD = "appstoreconnect-v1";
export const TOKEN_LIFE = 15 * 60; // seconds; Apple refuses more than 20 minutes
// Every capability a signing service's profile carries (the user's Arctic Sign profile, 2026-11-19) that the App Store
// Connect API can turn on, in the order they're asked for: Push first, it must work; the rest are skipped when Apple
// refuses them (refusedCaps). Apple's capabilityType enum (its 409 lists it, real call 2026-11-19) is ICLOUD,
// IN_APP_PURCHASE, GAME_CENTER, PUSH_NOTIFICATIONS, WALLET, INTER_APP_AUDIO, MAPS, ASSOCIATED_DOMAINS, PERSONAL_VPN,
// APP_GROUPS, HEALTHKIT, HOMEKIT, WIRELESS_ACCESSORY_CONFIGURATION, APPLE_PAY, DATA_PROTECTION, SIRIKIT,
// NETWORK_EXTENSIONS, MULTIPATH, HOT_SPOT, NFC_TAG_READING, CLASSKIT, AUTOFILL_CREDENTIAL_PROVIDER,
// ACCESS_WIFI_INFORMATION, NETWORK_CUSTOM_PROTOCOL, COREMEDIA_HLS_LOW_LATENCY, SYSTEM_EXTENSION_INSTALL,
// USER_MANAGEMENT, APPLE_ID_AUTH. MAPS, NETWORK_CUSTOM_PROTOCOL, SYSTEM_EXTENSION_INSTALL and USER_MANAGEMENT put
// nothing in an iOS profile, so they're left out. Not in the API at all (the developer website only):
// Communication and Time Sensitive notifications, WeatherKit, App Attest, Fonts, Extended Virtual Addressing,
// Increased (Debugging) Memory Limit, Multitasking Camera Access.
// Keep native/Sources/ASC.swift's caps the same.
export const APP_ID_CAPS = ["PUSH_NOTIFICATIONS", // aps-environment
  "APP_GROUPS", // com.apple.security.application-groups (comes out empty: the API can't make group IDs)
  "ASSOCIATED_DOMAINS", // associated-domains "*"
  "ICLOUD", // icloud-services, ubiquity-* (ICLOUD_VERSION XCODE_6: CloudKit)
  "GAME_CENTER", "HEALTHKIT", "HOMEKIT", "SIRIKIT", "NETWORK_EXTENSIONS", "PERSONAL_VPN", // vpn.api allow-vpn
  "MULTIPATH", "HOT_SPOT", "NFC_TAG_READING", "CLASSKIT", "AUTOFILL_CREDENTIAL_PROVIDER",
  "ACCESS_WIFI_INFORMATION", "COREMEDIA_HLS_LOW_LATENCY", "APPLE_ID_AUTH", // applesignin Default
  "WALLET", // pass-type-identifiers <team>.*
  "APPLE_PAY", // in-app-payments (no merchant IDs)
  "IN_APP_PURCHASE", "INTER_APP_AUDIO", "WIRELESS_ACCESSORY_CONFIGURATION",
  "DATA_PROTECTION"]; // default-data-protection NSFileProtectionComplete
// The settings the ones that need them take: without them Apple refuses ICLOUD and APPLE_ID_AUTH, and answers 201 to
// DATA_PROTECTION without turning it on (real calls 2026-11-19).
export const APP_ID_CAP_SETTINGS = {
  ICLOUD: [{ key: "ICLOUD_VERSION", options: [{ key: "XCODE_6" }] }],
  APPLE_ID_AUTH: [{ key: "APPLE_ID_AUTH_APP_CONSENT", options: [{ key: "PRIMARY_APP_CONSENT" }] }],
  DATA_PROTECTION: [{ key: "DATA_PROTECTION_PERMISSION_LEVEL", options: [{ key: "COMPLETE_PROTECTION" }] }],
};
export const capBody = (cap, bundleIdId) => ({ data: { type: "bundleIdCapabilities",
  attributes: { capabilityType: cap, ...(APP_ID_CAP_SETTINGS[cap] ? { settings: APP_ID_CAP_SETTINGS[cap] } : {}) },
  relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdId } } } } });
// Capabilities Apple refused, per team, kept in the profile cache under this key (no App ID has a '#'):
// { [team]: { [capabilityType]: { at: ISO, why } } }. Asked again after REFUSED_RETRY (the account holder may have
// had a managed one granted meanwhile). Push is never remembered: it's asked for on every sign until it's on.
export const REFUSED_KEY = "#refused";
export const REFUSED_RETRY = 30 * 24 * 3600 * 1000;
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

// The explicit App ID: { id, identifier, made, team (Apple's seedId, the team ID) }. A new one gets APP_ID_CAPS
// (addCaps, Push must succeed); an existing one is topped up by ensureProfile.
export async function ensureAppId(request, identifier, { cache = {}, now = Date.now(), log = () => {} } = {}) {
  // the filter is a prefix match
  const found = ((await request("GET", `/bundleIds${q({ "filter[identifier]": identifier, limit: 200 })}`)).data ?? [])
    .find((b) => b.attributes?.identifier === identifier);
  if (found) return { id: found.id, identifier, made: false, team: found.attributes?.seedId ?? null };
  const made = (await request("POST", "/bundleIds", { data: { type: "bundleIds",
    attributes: { identifier, name: `${NAME} ${identifier.split(".").pop()}`.slice(0, 60), platform: "IOS" } } })).data;
  const team = made.attributes?.seedId ?? null;
  const r = await addCaps({ request, bundleIdId: made.id, caps: APP_ID_CAPS, cache, team, now, log, pushMust: true });
  return { id: made.id, identifier, made: true, team, capabilities: r.capabilities };
}

// ---- capabilities Apple refuses: skipped, logged once, remembered per team ----
const teamKey = (team) => String(team || "default").toUpperCase();
export function refusedCaps(cache, team, now = Date.now()) {
  const got = cache?.[REFUSED_KEY]?.[teamKey(team)] ?? {};
  return new Set(Object.keys(got).filter((c) => now - (Date.parse(got[c]?.at) || 0) < REFUSED_RETRY));
}
function remember(cache, team, cap, why, now) {
  const all = (cache[REFUSED_KEY] ??= {});
  (all[teamKey(team)] ??= {})[cap] = { at: new Date(now).toISOString(), why: String(why).slice(0, 300) };
}
// Apple refused it for this team (a managed capability the account holder must request, one the account can't
// have, an invalid setting); 401 is the key, 429/5xx/no answer are passing: those aren't remembered.
const isRefusal = (e) => e?.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;

// Asks for `caps` on the App ID, skipping the ones refused for this team, then reads back what it has. A refusal is
// logged once and remembered; one Apple accepts but doesn't turn on is remembered too, so no sign asks again.
// `pushMust`: a refused Push throws (a new App ID); otherwise it's logged and asked for again next sign.
// -> { capabilities (Apple's list, sorted), added, refused (newly remembered), failed (passing errors) }
export async function addCaps({ request, bundleIdId, caps, cache = {}, team = null, now = Date.now(), log = () => {}, pushMust = false }) {
  const skip = refusedCaps(cache, team, now);
  const added = [], refused = [], failed = [];
  for (const cap of caps) {
    if (skip.has(cap) && cap !== "PUSH_NOTIFICATIONS") continue;
    try {
      await request("POST", "/bundleIdCapabilities", capBody(cap, bundleIdId));
      added.push(cap);
    } catch (e) {
      if (e?.status === 401 || (cap === "PUSH_NOTIFICATIONS" && pushMust)) throw e;
      if (isRefusal(e) && cap !== "PUSH_NOTIFICATIONS") {
        remember(cache, team, cap, e.message, now);
        refused.push(cap);
        log(`Capability ${cap}: Apple refused it for team ${teamKey(team)} (${e.message}); skipped from now on`);
      } else {
        failed.push(cap);
        log(`Capability ${cap}: not added this time (${e?.message ?? e})`);
      }
    }
  }
  const capabilities = await appIdCaps(request, bundleIdId);
  for (const cap of added) {
    if (capabilities.includes(cap) || cap === "PUSH_NOTIFICATIONS") continue;
    remember(cache, team, cap, "accepted but not turned on", now);
    refused.push(cap);
    log(`Capability ${cap}: Apple accepted it but didn't turn it on for team ${teamKey(team)}; skipped from now on`);
  }
  return { capabilities, added: added.filter((c) => capabilities.includes(c)), refused, failed };
}

// The team an App ID belongs to (its seedId), for refusedCaps when the cache doesn't know it yet.
export async function appIdTeam(request, bundleIdId) {
  try { return (await request("GET", `/bundleIds/${bundleIdId}`)).data?.attributes?.seedId ?? null; } catch (e) {
    if (e?.status === 401) throw e;
    return null;
  }
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
// `certIds` (F276): make the profile with these certificates instead of looking up `serials` (a .p12 whose serial
// isn't known: profileForAnyP12).
// F279: an App ID that lacks some of APP_ID_CAPS (made before the list grew, or by hand) is topped up first, skipping
// what Apple refused for its team (refusedCaps); the profile is then remade by the "capabilities" rule. `log` hears
// each refusal once. The result also carries `capsAdded` and `capsRefused`.
export async function ensureProfile({ request, bundleId, prefix, udid, deviceName, serials, certId = null, certIds = null, cache = {},
  now = Date.now(), log = () => {} }) {
  const identifier = appIdFor(bundleId, prefix);
  let cached = cache[identifier] ?? null;
  let appId = cached?.bundleIdId ? { id: cached.bundleIdId, identifier, made: false } : null;
  let caps = null;
  let team = cached?.team ?? null;
  if (appId) {
    try { caps = await appIdCaps(request, appId.id); } catch (e) { if (e.status !== 404) throw e; appId = null; cached = null; }
  }
  if (!appId) {
    appId = await ensureAppId(request, identifier, { cache, now, log });
    team = appId.team ?? team;
    caps = appId.capabilities ?? await appIdCaps(request, appId.id);
  }
  let capsAdded = [], capsRefused = [];
  const missing = APP_ID_CAPS.filter((c) => !caps.includes(c));
  if (missing.length) {
    team ??= await appIdTeam(request, appId.id);
    const skip = refusedCaps(cache, team, now);
    const ask = missing.filter((c) => c === "PUSH_NOTIFICATIONS" || !skip.has(c));
    if (ask.length) {
      const r = await addCaps({ request, bundleIdId: appId.id, caps: ask, cache, team, now, log });
      caps = r.capabilities;
      capsAdded = r.added;
      capsRefused = r.refused;
    }
  }
  if (cached && team) cached.team = team;
  const reason = remakeReason(cached, { udid, capabilities: caps, certId, now });
  if (!reason) return { entry: cached, made: false, reason: null, appId: identifier, deviceMade: false, capsAdded, capsRefused };

  const deviceMade = udid ? (await ensureDevice(request, udid, deviceName)).made : false;
  const cert = certIds?.length ? { id: certIds[0], all: certIds } : await findCertificate(request, serials);
  if (!cert) throw new AscError("Your certificate isn't in this developer account.", { code: "no-cert" });
  const devices = (await request("GET", `/devices${q({ "filter[platform]": "IOS", "filter[status]": "ENABLED", limit: 200 })}`)).data ?? [];
  const name = profileName(identifier);
  for (const p of (await request("GET", `/profiles${q({ "filter[name]": name, limit: 200 })}`)).data ?? []) {
    await request("DELETE", `/profiles/${p.id}`); // names are unique: the old one goes first
  }
  const created = (await request("POST", "/profiles", profileBody({ name, bundleIdId: appId.id, certId: cert.all ?? cert.id, deviceIds: devices.map((d) => d.id) }))).data;
  const content = created.attributes.profileContent;
  const info = parseProfile(b64decode(content));
  const entry = { identifier, bundleIdId: appId.id, id: created.id, name, content, expires: info.expires?.toISOString() ?? null,
    udids: info.udids, capabilities: caps, certId: cert.id, push: info.push, made: new Date(now).toISOString(),
    ...(team ? { team } : {}) };
  cache[identifier] = entry;
  return { entry, made: true, reason, appId: identifier, deviceMade, capsAdded, capsRefused };
}

export function profileBody({ name, bundleIdId, certId, deviceIds }) {
  return { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_ADHOC" },
    relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdId } }, certificates: rel("certificates", [].concat(certId)),
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

// F276: a .p12 picked alone whose serial can't be read here (its certificate is encrypted with the password, often
// with 3DES/RC2, which WebCrypto lacks): the own App ID's profile lists every distribution certificate in the account,
// so it fits whichever of them the .p12 holds (a .p12 from another account fails at import, as with a wrong profile).
// The prefix comes from the team in those certificates. -> ensureProfile's result plus `certs` (how many it lists);
// AscError "no-cert" when the account has none.
export async function profileForAnyP12({ request, bundleId = BUNDLE_ID, prefix = null, udid = null, deviceName, cache = {}, now = Date.now() }) {
  const r = await request("GET", `/certificates${q({ "filter[certificateType]": "DISTRIBUTION,IOS_DISTRIBUTION", limit: 200 })}`);
  const certs = (r.data ?? []).filter((c) => ["DISTRIBUTION", "IOS_DISTRIBUTION"].includes(c.attributes?.certificateType ?? "DISTRIBUTION"));
  if (!certs.length) {
    throw new AscError("This account has no Apple Distribution certificate, so the .p12 can't be from it. Make Certificate "
      + "makes one, or import a .p12 from this account.", { code: "no-cert" });
  }
  let team = null;
  for (const c of certs) { if (!team && c.attributes?.certificateContent) { try { team = certTeam(b64decode(c.attributes.certificateContent)); } catch { /* unreadable */ } } }
  const out = await ensureProfile({ request, bundleId, prefix: prefix ?? appIdPrefix(null, team), udid, deviceName, serials: [],
    certIds: certs.map((c) => c.id), cache, now });
  return { ...out, certs: certs.length };
}

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
