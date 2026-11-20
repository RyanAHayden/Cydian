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
//   profileSerials(mobileprovision)          the serials of the certificates a profile lists (for findCertificate)
//   profileRows(cache)                        the Provisioning Profile rows for the cache
//
// The profile cache (the caller keeps it, e.g. as JSON in storage): { [App ID identifier]: entry }, entry =
//   { identifier, bundleIdId, id, name, content (the .mobileprovision, base64), expires (ISO), udids,
//     capabilities, certId, push, made (ISO) }
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME } from "../brand.js";
import { parsePlist, parseProfile, normalUdid } from "./signing.js";
import { unpem, certSerial } from "./freecert.js";

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
  const r = await request("GET", `/bundleIds/${bundleIdId}/bundleIdCapabilities${q({ limit: 200 })}`);
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
