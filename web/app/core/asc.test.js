// Own provisioning profiles (core/asc.js) against a fake App Store Connect.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { keyIdFromName, makeJwt, httpTransport, appIdFor, appIdPrefix, remakeReason, ensureProfile, profileBody,
  findCertificate, profileSerials, profileRows, makeCertificate, distributionCerts, revokeCertificate, APP_ID_CAPS, AscError,
  APP_ID_CAP_SETTINGS, capBody, addCaps, refusedCaps, REFUSED_KEY, REFUSED_RETRY,
  newCertificate, makeOwnSigning, profileForP12, profileForAnyP12, certTeam, LIMIT_TEXT, KEY_ROLE_TEXT, REVOKE_WARNING } from "./asc.js";
import { certSerial, unpem, tlv, seq, oid } from "./freecert.js";
import { der, children, checkP12Password } from "./signing.js";
import { NAME, BUNDLE_ID } from "../brand.js";

const subtle = webcrypto.subtle;
const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${name}`, import.meta.url)));
const unb64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

async function p8() {
  const k = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await subtle.exportKey("pkcs8", k.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: k.publicKey };
}

test("Key ID from the file name", () => {
  assert.equal(keyIdFromName("AuthKey_ABC123DEF4.p8"), "ABC123DEF4");
  assert.equal(keyIdFromName("/x/y/AuthKey_s8nfx3a2lt.p8"), "S8NFX3A2LT");
  assert.equal(keyIdFromName("key.p8"), null);
});

test("JWT header, claims and ES256 signature", async () => {
  const { pem, publicKey } = await p8();
  const now = Date.UTC(2026, 10, 19, 12);
  const jwt = await makeJwt({ p8: pem, keyId: "ABC123DEF4", issuerId: "69a6de7e-0000-47e3-e053-5b8c7c11a4d1", now, subtle });
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(unb64url(h)), { alg: "ES256", kid: "ABC123DEF4", typ: "JWT" });
  const claims = JSON.parse(unb64url(c));
  assert.equal(claims.iss, "69a6de7e-0000-47e3-e053-5b8c7c11a4d1");
  assert.equal(claims.aud, "appstoreconnect-v1");
  assert.equal(claims.iat, now / 1000);
  assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 20 * 60);
  // asking for longer still stays under Apple's 20 minutes
  const long = JSON.parse(unb64url((await makeJwt({ p8: pem, keyId: "K", issuerId: "I", now, life: 3600, subtle })).split(".")[1]));
  assert.ok(long.exp - long.iat <= 20 * 60);
  const sig = unb64url(s);
  assert.equal(sig.length, 64); // raw r||s
  assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(`${h}.${c}`)));
});

test("App ID naming and prefix", () => {
  assert.equal(appIdFor("io.github.fizl0.hst.beta", "com.example"), "com.example.beta");
  assert.equal(appIdFor("com.foo.Bar_App", "com.example.*"), "com.example.Bar-App");
  assert.equal(appIdPrefix("com.example.*", "S8NFX3A2LT"), "com.example");
  assert.equal(appIdPrefix("com.example.beta", "S8NFX3A2LT"), "com.example");
  assert.equal(appIdPrefix("*", "S8NFX3A2LT"), `${NAME.toLowerCase()}.s8nfx3a2lt`);
  assert.equal(appIdPrefix(null, "S8NFX3A2LT"), `${NAME.toLowerCase()}.s8nfx3a2lt`);
});

test("remake rules", () => {
  const now = Date.UTC(2026, 10, 19);
  const good = { content: "x", expires: new Date(now + 300 * 864e5).toISOString(), udids: ["00008130-AAA"], capabilities: ["APP_GROUPS", "PUSH_NOTIFICATIONS"], certId: "C1" };
  assert.equal(remakeReason(null, { now }), "missing");
  assert.equal(remakeReason({ ...good, content: null }, { now }), "missing");
  assert.equal(remakeReason({ ...good, expires: null }, { now }), "expired");
  assert.equal(remakeReason({ ...good, expires: new Date(now - 1).toISOString() }, { now }), "expired");
  assert.equal(remakeReason({ ...good, expires: new Date(now + 3600e3).toISOString() }, { now }), "expired"); // within a day
  assert.equal(remakeReason(good, { now, udid: "00008130-bbb" }), "device");
  assert.equal(remakeReason({ ...good, udids: undefined }, { now, udid: "00008130-AAA" }), "device");
  assert.equal(remakeReason(good, { now, udid: "00008130-aaa" }), null);
  assert.equal(remakeReason(good, { now, capabilities: ["PUSH_NOTIFICATIONS", "APP_GROUPS"] }), null);
  assert.equal(remakeReason(good, { now, capabilities: ["PUSH_NOTIFICATIONS"] }), "capabilities");
  assert.equal(remakeReason(good, { now, capabilities: [...good.capabilities, "ASSOCIATED_DOMAINS"] }), "capabilities");
  assert.equal(remakeReason(good, { now, certId: "C2" }), "certificate");
  assert.equal(remakeReason(good, { now, udid: "00008130-AAA", capabilities: good.capabilities, certId: "C1" }), null);});

test("profile request body", () => {
  assert.deepEqual(profileBody({ name: "N", bundleIdId: "B", certId: "C", deviceIds: ["D1", "D2"] }), { data: { type: "profiles",
    attributes: { name: "N", profileType: "IOS_APP_ADHOC" },
    relationships: { bundleId: { data: { type: "bundleIds", id: "B" } }, certificates: { data: [{ type: "certificates", id: "C" }] },
      devices: { data: [{ type: "devices", id: "D1" }, { type: "devices", id: "D2" }] } } } });
});

// ---- fake App Store Connect ----
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
function fakeProfile({ udids, appId, push = "production", expires }) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Name</key><string>P</string>`
    + `<key>TeamIdentifier</key><array><string>S8NFX3A2LT</string></array><key>ExpirationDate</key><date>${iso(expires)}</date>`
    + `<key>ProvisionedDevices</key><array>${udids.map((u) => `<string>${u}</string>`).join("")}</array>`
    + `<key>Entitlements</key><dict><key>application-identifier</key><string>S8NFX3A2LT.${appId}</string>`
    + `<key>aps-environment</key><string>${push}</string></dict></dict></plist>`;
  return Buffer.from(`\x30\x80junk${xml}trailer`, "latin1").toString("base64");
}
function fakeAsc({ devices = [], certs = [{ id: "C1", attributes: { serialNumber: "0ABC" } }], bundleIds = [], expires = new Date(Date.UTC(2027, 10, 19)) } = {}) {
  // refuse: capabilities Apple answers 409 to; quiet: ones it answers 201 to without turning on; settings: what came
  const s = { devices: [...devices], certs, bundleIds: [...bundleIds], caps: {}, profiles: [], calls: [], n: 0,
    refuse: new Set(), quiet: new Set(), down: new Set(), settings: {} };
  s.request = async (method, path, body) => {
    s.calls.push(`${method} ${path.split("?")[0]}`);
    const u = new URL(`https://x${path}`);
    const f = (k) => u.searchParams.get(`filter[${k}]`);
    const id = () => `id${++s.n}`;
    if (method === "GET" && u.pathname === "/devices") {
      return { data: s.devices.filter((d) => (!f("udid") || d.attributes.udid === f("udid")) && (!f("status") || d.attributes.status === f("status"))) };
    }
    if (method === "POST" && u.pathname === "/devices") {
      const d = { id: id(), attributes: { ...body.data.attributes, status: "ENABLED" } };
      s.devices.push(d);
      return { data: d };
    }
    if (method === "GET" && u.pathname === "/certificates") return { data: s.certs };
    if (method === "GET" && u.pathname === "/bundleIds") return { data: s.bundleIds.filter((b) => b.attributes.identifier.startsWith(f("identifier"))) };
    if (method === "POST" && u.pathname === "/bundleIds") {
      const b = { id: id(), attributes: { ...body.data.attributes, seedId: "S8NFX3A2LT" } };
      s.bundleIds.push(b);
      s.caps[b.id] = [];
      return { data: b };
    }
    const one = /^\/bundleIds\/([^/]+)$/.exec(u.pathname);
    if (method === "GET" && one) {
      const b = s.bundleIds.find((x) => x.id === one[1]);
      if (!b) throw new AscError("gone", { status: 404 });
      return { data: { ...b, attributes: { seedId: "S8NFX3A2LT", ...b.attributes } } };
    }
    if (method === "POST" && u.pathname === "/bundleIdCapabilities") {
      const cap = body.data.attributes.capabilityType;
      if (s.down.has(cap)) throw new AscError("App Store Connect POST /bundleIdCapabilities: HTTP 503", { status: 503 });
      if (s.refuse.has(cap)) throw new AscError(`App Store Connect POST /bundleIdCapabilities: ${cap} needs a request`, { status: 409, code: "ENTITY_ERROR" });
      if ((cap === "ICLOUD" || cap === "APPLE_ID_AUTH") && !body.data.attributes.settings) throw new AscError("needs settings", { status: 409 });
      const list = s.caps[body.data.relationships.bundleId.data.id];
      if (!s.quiet.has(cap) && !list.includes(cap)) list.push(cap);
      if (body.data.attributes.settings) s.settings[cap] = body.data.attributes.settings;
      return { data: {} };
    }
    const m = /^\/bundleIds\/([^/]+)\/bundleIdCapabilities$/.exec(u.pathname);
    if (method === "GET" && m) {
      if (u.search) throw new AscError(`App Store Connect GET ${u.pathname}: query parameters are not allowed`, { status: 400, code: "PARAMETER_ERROR.ILLEGAL" });
      if (!s.caps[m[1]]) throw new AscError("gone", { status: 404 });
      return { data: s.caps[m[1]].map((c) => ({ attributes: { capabilityType: c } })) };
    }
    if (method === "GET" && u.pathname === "/profiles") return { data: s.profiles.filter((p) => p.attributes.name === f("name")) };
    if (method === "DELETE" && u.pathname.startsWith("/profiles/")) { s.profiles = s.profiles.filter((p) => `/profiles/${p.id}` !== u.pathname); return {}; }
    if (method === "POST" && u.pathname === "/profiles") {
      s.lastProfile = body;
      const devs = body.data.relationships.devices.data.map((r) => s.devices.find((d) => d.id === r.id).attributes.udid);
      const bid = s.bundleIds.find((b) => b.id === body.data.relationships.bundleId.data.id).attributes.identifier;
      const p = { id: id(), attributes: { name: body.data.attributes.name, profileContent: fakeProfile({ udids: devs, appId: bid, expires }) } };
      s.profiles.push(p);
      return { data: p };
    }
    throw new Error(`fake ASC: no route ${method} ${path}`);
  };
  return s;
}

test("ensureProfile: registers the iPhone, makes the App ID with its capabilities and an Ad Hoc profile", async () => {
  const other = { id: "D0", attributes: { udid: "00008110-OTHER", status: "ENABLED", platform: "IOS" } };
  const off = { id: "DX", attributes: { udid: "00008110-OFF", status: "DISABLED", platform: "IOS" } };
  const asc = fakeAsc({ devices: [other, off] });
  const cache = {};
  const now = Date.UTC(2026, 10, 19);
  const r = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.example", udid: "00008130-0018450c3661001c",
    deviceName: "iPhone 15 Pro", serials: ["ABC"], cache, now });
  assert.equal(r.made, true);
  assert.equal(r.reason, "missing");
  assert.equal(r.deviceMade, true);
  assert.equal(r.appId, "com.example.beta");
  assert.deepEqual(asc.caps[asc.bundleIds[0].id], APP_ID_CAPS);
  assert.equal(asc.lastProfile.data.attributes.profileType, "IOS_APP_ADHOC");
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data, [{ type: "certificates", id: "C1" }]);
  // every ENABLED device, the new one included, not the disabled one
  assert.deepEqual(asc.lastProfile.data.relationships.devices.data.map((d) => d.id).sort(), ["D0", asc.devices[2].id].sort());
  const e = cache["com.example.beta"];
  assert.equal(e.push, "production");
  assert.deepEqual(e.capabilities, [...APP_ID_CAPS].sort());
  assert.ok(e.udids.includes("00008130-0018450C3661001C"));

  // second sign: one call (the capabilities), the cached profile
  asc.calls.length = 0;
  const again = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.example", udid: "00008130-0018450C3661001C", serials: ["ABC"], cache, now });
  assert.equal(again.made, false);
  assert.deepEqual(asc.calls, [`GET /bundleIds/${e.bundleIdId}/bundleIdCapabilities`]);

  // a capability turned off on the App ID that Apple then refuses to turn back on: remade, the old profile deleted first
  asc.caps[e.bundleIdId] = APP_ID_CAPS.filter((c) => c !== "HEALTHKIT");
  asc.refuse.add("HEALTHKIT");
  const capped = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.example", udid: "00008130-0018450C3661001C", serials: ["ABC"], cache, now });
  assert.equal(capped.reason, "capabilities");
  assert.deepEqual(capped.capsRefused, ["HEALTHKIT"]);
  assert.equal(asc.profiles.length, 1);
  asc.refuse.delete("HEALTHKIT");

  // another iPhone: registered, remade
  const third = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.example", udid: "00008150-NEW", serials: ["ABC"], cache, now });
  assert.equal(third.reason, "device");
  assert.equal(third.deviceMade, true);

  // the certificate changed (the caller knows its id): remade with the new one
  asc.certs.push({ id: "C2", attributes: { serialNumber: "DEF" } });
  const recert = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.example", udid: "00008150-NEW", serials: ["DEF"], certId: "C2", cache, now });
  assert.equal(recert.reason, "certificate");
  assert.equal(cache["com.example.beta"].certId, "C2");
});

test("request bodies: device, App ID, capabilities", async () => {
  const asc = fakeAsc();
  const sent = [];
  const request = (method, path, body) => { if (method === "POST") sent.push([path, body]); return asc.request(method, path, body); };
  await ensureProfile({ request, bundleId: "com.foo.app", prefix: "com.example", udid: "00008130-abc", deviceName: "x".repeat(80), serials: ["ABC"], cache: {} });
  const dev = sent.find(([p]) => p === "/devices");
  const bid = sent.find(([p]) => p === "/bundleIds");
  const rest = sent;
  assert.deepEqual(dev, ["/devices", { data: { type: "devices", attributes: { name: "x".repeat(50), udid: "00008130-ABC", platform: "IOS" } } }]);
  assert.equal(bid[0], "/bundleIds");
  assert.deepEqual(bid[1].data.attributes, { identifier: "com.example.app", name: bid[1].data.attributes.name, platform: "IOS" });
  assert.ok(bid[1].data.attributes.name.length <= 60);
  const capBodies = rest.filter(([p]) => p === "/bundleIdCapabilities").map(([, b]) => b);
  assert.deepEqual(capBodies, APP_ID_CAPS.map((cap) => capBody(cap, asc.bundleIds[0].id)));
  assert.equal(capBodies[0].data.attributes.capabilityType, "PUSH_NOTIFICATIONS"); // Push first
  assert.deepEqual(capBodies.find((b) => b.data.attributes.capabilityType === "PERSONAL_VPN").data,
    { type: "bundleIdCapabilities", attributes: { capabilityType: "PERSONAL_VPN" }, relationships: { bundleId: { data: { type: "bundleIds", id: asc.bundleIds[0].id } } } });
  assert.deepEqual(capBodies.find((b) => b.data.attributes.capabilityType === "ICLOUD").data.attributes.settings,
    [{ key: "ICLOUD_VERSION", options: [{ key: "XCODE_6" }] }]);
  assert.equal(rest.at(-1)[0], "/profiles");
});

test("ensureProfile: no UDID known: a cached profile is reused, a new one is made without registering", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  const r = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.example", udid: null, serials: ["ABC"], cache: {} });
  assert.equal(r.made, true);
  assert.equal(r.deviceMade, false);
  assert.ok(!asc.calls.includes("POST /devices"));
});

test("certificate requests", async () => {
  const sent = [];
  const request = async (method, path, body) => {
    sent.push([method, path, body]);
    if (method === "POST") return { data: { id: "N1", attributes: { certificateContent: btoa("DER"), expirationDate: "2027-11-19T00:00:00.000+0000" } } };
    if (method === "GET") return { data: [{ id: "C1", attributes: { displayName: "Me", serialNumber: "AB", expirationDate: "x" } }] };
    return {};
  };
  const made = await makeCertificate(request, "-----BEGIN CERTIFICATE REQUEST-----");
  assert.deepEqual(sent[0], ["POST", "/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: "-----BEGIN CERTIFICATE REQUEST-----" } } }]);
  assert.equal(new TextDecoder().decode(made.cert), "DER");
  assert.deepEqual(await distributionCerts(request), [{ id: "C1", name: "Me", serial: "AB", expires: "x" }]);
  assert.match(sent[1][1], /^\/certificates\?filter%5BcertificateType%5D=DISTRIBUTION%2CIOS_DISTRIBUTION/);
  await revokeCertificate(request, "C1");
  assert.deepEqual(sent[2].slice(0, 2), ["DELETE", "/certificates/C1"]);
});

test("nothing logs the key or the token", async () => {
  const { pem } = await p8();
  const said = [];
  const saved = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) { saved[k] = console[k]; console[k] = (...a) => said.push(a.join(" ")); }
  try {
    const jwt = await makeJwt({ p8: pem, keyId: "K", issuerId: "I", subtle });
    const req = httpTransport({ token: jwt, fetcher: async () => new Response('{"errors":[{"detail":"nope"}]}', { status: 401 }) });
    await assert.rejects(req("GET", "/devices"), (e) => !e.message.includes(jwt));
    await assert.rejects(makeJwt({ p8: "garbage", keyId: "K", issuerId: "I", subtle }));
  } finally { Object.assign(console, saved); }
  assert.deepEqual(said, []);
});

test("ensureProfile: an App ID that's already there is reused; a certificate not in the account stops it", async () => {
  const asc = fakeAsc({ bundleIds: [{ id: "B9", attributes: { identifier: "com.example.betaX" } }, { id: "B1", attributes: { identifier: "com.example.beta" } }],
    devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  asc.caps.B1 = ["PUSH_NOTIFICATIONS"];
  const r = await ensureProfile({ request: asc.request, bundleId: "a.b.beta", prefix: "com.example", udid: "U1", serials: ["abc"], cache: {} });
  assert.equal(r.entry.bundleIdId, "B1"); // exact match, not the prefix match
  assert.equal(r.deviceMade, false);
  await assert.rejects(ensureProfile({ request: asc.request, bundleId: "a.b.beta", prefix: "com.example", udid: "U1", serials: ["FFFF"], cache: {} }),
    (e) => e.code === "no-cert");
});

test("ensureProfile: a cached App ID deleted on Apple's side is made again", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  const cache = { "com.example.beta": { identifier: "com.example.beta", bundleIdId: "GONE", content: "x", expires: "2030-01-01T00:00:00Z", udids: ["U1"], capabilities: [] } };
  const r = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.example", udid: "U1", serials: ["ABC"], cache });
  assert.equal(r.made, true);
  assert.notEqual(cache["com.example.beta"].bundleIdId, "GONE");
});

// ---- F279: every capability a signing service's profile has ----
// Apple's capabilityType enum as its 409 listed it (real call 2026-11-19).
const APPLE_ENUM = ["ICLOUD", "IN_APP_PURCHASE", "GAME_CENTER", "PUSH_NOTIFICATIONS", "WALLET", "INTER_APP_AUDIO", "MAPS",
  "ASSOCIATED_DOMAINS", "PERSONAL_VPN", "APP_GROUPS", "HEALTHKIT", "HOMEKIT", "WIRELESS_ACCESSORY_CONFIGURATION", "APPLE_PAY",
  "DATA_PROTECTION", "SIRIKIT", "NETWORK_EXTENSIONS", "MULTIPATH", "HOT_SPOT", "NFC_TAG_READING", "CLASSKIT",
  "AUTOFILL_CREDENTIAL_PROVIDER", "ACCESS_WIFI_INFORMATION", "NETWORK_CUSTOM_PROTOCOL", "COREMEDIA_HLS_LOW_LATENCY",
  "SYSTEM_EXTENSION_INSTALL", "USER_MANAGEMENT", "APPLE_ID_AUTH"];
const TEAM = "S8NFX3A2LT";
const oldCaps = ["APP_GROUPS", "ASSOCIATED_DOMAINS", "PUSH_NOTIFICATIONS"];

test("capability list: Push first, every one Apple's API knows that puts something in an iOS profile, with settings", () => {
  assert.equal(APP_ID_CAPS[0], "PUSH_NOTIFICATIONS");
  assert.equal(new Set(APP_ID_CAPS).size, APP_ID_CAPS.length);
  for (const c of APP_ID_CAPS) assert.ok(APPLE_ENUM.includes(c), c);
  // nothing for an iOS profile in these
  for (const c of ["MAPS", "NETWORK_CUSTOM_PROTOCOL", "SYSTEM_EXTENSION_INSTALL", "USER_MANAGEMENT"]) assert.ok(!APP_ID_CAPS.includes(c), c);
  // the rest of the enum is all there
  assert.equal(APP_ID_CAPS.length, APPLE_ENUM.length - 4);
  assert.deepEqual(Object.keys(APP_ID_CAP_SETTINGS).sort(), ["APPLE_ID_AUTH", "DATA_PROTECTION", "ICLOUD"]);
  assert.deepEqual(capBody("APPLE_ID_AUTH", "B").data.attributes.settings, [{ key: "APPLE_ID_AUTH_APP_CONSENT", options: [{ key: "PRIMARY_APP_CONSENT" }] }]);
  assert.deepEqual(capBody("DATA_PROTECTION", "B").data.attributes.settings, [{ key: "DATA_PROTECTION_PERMISSION_LEVEL", options: [{ key: "COMPLETE_PROTECTION" }] }]);
  assert.equal(capBody("HOMEKIT", "B").data.attributes.settings, undefined);
  // native/Sources/ASC.swift keeps the same list, in the same order
  const swift = readFileSync(new URL("../../../native/Sources/ASC.swift", import.meta.url), "utf8");
  const m = /static let appIDCaps = \[([^\]]+)\]/.exec(swift);
  assert.ok(m, "ASC.swift appIDCaps");
  assert.deepEqual([...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]), APP_ID_CAPS);
  for (const [cap, s] of Object.entries(APP_ID_CAP_SETTINGS)) {
    assert.ok(swift.includes(`"${cap}": [["key": "${s[0].key}", "options": [["key": "${s[0].options[0].key}"]]]]`), `ASC.swift settings ${cap}`);
  }
});

test("refused capabilities: skipped, logged once, remembered per team, asked again a month on", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  asc.refuse = new Set(["HEALTHKIT", "CLASSKIT"]);
  asc.quiet = new Set(["HOT_SPOT"]); // 201, but not turned on
  const cache = {}, said = [];
  const now = Date.UTC(2026, 10, 19);
  const log = (s) => said.push(s);
  const r = await ensureProfile({ request: asc.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now, log });
  assert.equal(r.made, true);
  assert.deepEqual(r.entry.capabilities, APP_ID_CAPS.filter((c) => !["HEALTHKIT", "CLASSKIT", "HOT_SPOT"].includes(c)).sort());
  assert.equal(r.entry.team, TEAM);
  assert.deepEqual(Object.keys(cache[REFUSED_KEY][TEAM]).sort(), ["CLASSKIT", "HEALTHKIT", "HOT_SPOT"]);
  assert.equal(said.length, 3);
  assert.ok(said.every((s) => /skipped from now on/.test(s)));
  assert.deepEqual(asc.settings.ICLOUD, APP_ID_CAP_SETTINGS.ICLOUD);
  assert.deepEqual(profileRows(cache, now).map((x) => x.label), ["com.example.one"]); // the memory isn't a profile row

  // the same sign again: no capability asked for, nothing logged, the profile reused
  asc.calls.length = 0;
  const again = await ensureProfile({ request: asc.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now, log });
  assert.equal(again.made, false);
  assert.deepEqual(asc.calls, [`GET /bundleIds/${r.entry.bundleIdId}/bundleIdCapabilities`]);
  assert.equal(said.length, 3);

  // another app on the same team: the refused ones aren't asked for
  asc.calls.length = 0;
  await ensureProfile({ request: asc.request, bundleId: "a.two", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now, log });
  assert.equal(asc.calls.filter((c) => c === "POST /bundleIdCapabilities").length, APP_ID_CAPS.length - 3);
  assert.equal(said.length, 3);

  // another team keeps its own memory
  assert.deepEqual([...refusedCaps(cache, TEAM, now)].sort(), ["CLASSKIT", "HEALTHKIT", "HOT_SPOT"]);
  assert.equal(refusedCaps(cache, "OTHERTEAM1", now).size, 0);

  // a month on (the account holder may have had them granted): asked again, and HEALTHKIT now goes through
  asc.refuse.delete("HEALTHKIT");
  const later = now + REFUSED_RETRY + 1;
  const back = await ensureProfile({ request: asc.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now: later, log });
  assert.deepEqual(back.capsAdded, ["HEALTHKIT"]);
  assert.deepEqual(back.capsRefused.sort(), ["CLASSKIT", "HOT_SPOT"]);
  assert.equal(back.reason, "capabilities"); // the profile is remade with it
  assert.ok(back.entry.capabilities.includes("HEALTHKIT"));
});

test("Push must succeed on a new App ID; a passing error isn't remembered", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  asc.refuse = new Set(["PUSH_NOTIFICATIONS"]);
  const cache = {};
  await assert.rejects(ensureProfile({ request: asc.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache }),
    (e) => e.status === 409);
  assert.equal(cache[REFUSED_KEY], undefined);

  const asc2 = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  asc2.down = new Set(["WALLET"]);
  const said = [];
  const c2 = {};
  const r = await ensureProfile({ request: asc2.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache: c2, log: (s) => said.push(s) });
  assert.equal(r.made, true);
  assert.equal(c2[REFUSED_KEY], undefined);
  assert.ok(said.some((s) => /WALLET: not added this time/.test(s)));
  // next sign: asked again, and it works now
  asc2.down.clear();
  const again = await ensureProfile({ request: asc2.request, bundleId: "a.one", prefix: "com.example", udid: "U1", serials: ["ABC"], cache: c2 });
  assert.deepEqual(again.capsAdded, ["WALLET"]);
  assert.equal(again.reason, "capabilities");

  // a 401 is the key: it stops the sign
  const asc3 = fakeAsc();
  const request = (m, p, b) => (m === "POST" && p === "/bundleIdCapabilities" && b.data.attributes.capabilityType === "GAME_CENTER"
    ? Promise.reject(new AscError("key", { status: 401 })) : asc3.request(m, p, b));
  await assert.rejects(addCaps({ request, bundleIdId: (await asc3.request("POST", "/bundleIds", { data: { attributes: { identifier: "x.y" } } })).data.id,
    caps: APP_ID_CAPS, cache: {}, team: TEAM }), (e) => e.status === 401);
});

test("App IDs made before the longer list get the missing capabilities on their next sign, then a new profile", async () => {
  const now = Date.UTC(2026, 10, 19);
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }],
    bundleIds: [{ id: "B1", attributes: { identifier: "com.example.beta", seedId: TEAM } }] });
  asc.caps.B1 = [...oldCaps];
  asc.refuse = new Set(["NFC_TAG_READING"]);
  // the cache entry from before: no team, the three old capabilities
  const old = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.example", udid: "U1", serials: ["ABC"], cache: {}, now });
  assert.ok(old); // (made a profile; the App ID now has the full list, put it back to the old three)
  asc.caps.B1 = [...oldCaps];
  const cache = { "com.example.beta": { ...old.entry, capabilities: [...oldCaps] } };
  delete cache["com.example.beta"].team;

  asc.calls.length = 0;
  const said = [];
  const r = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now, log: (s) => said.push(s) });
  assert.equal(r.reason, "capabilities");
  assert.equal(r.made, true);
  assert.deepEqual(r.capsAdded.sort(), APP_ID_CAPS.filter((c) => !oldCaps.includes(c) && c !== "NFC_TAG_READING").sort());
  assert.deepEqual(r.capsRefused, ["NFC_TAG_READING"]);
  assert.ok(asc.calls.includes("GET /bundleIds/B1")); // the team, read once
  assert.equal(cache["com.example.beta"].team, TEAM);
  assert.deepEqual(cache["com.example.beta"].capabilities, APP_ID_CAPS.filter((c) => c !== "NFC_TAG_READING").sort());
  assert.equal(asc.profiles.length, 1);
  assert.equal(said.length, 1);

  // the next sign: one call
  asc.calls.length = 0;
  const again = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.example", udid: "U1", serials: ["ABC"], cache, now });
  assert.equal(again.made, false);
  assert.deepEqual(asc.calls, ["GET /bundleIds/B1/bundleIdCapabilities"]);

  // an App ID found in the account (not in the cache) with only Push: topped up too
  const asc2 = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }],
    bundleIds: [{ id: "B7", attributes: { identifier: "com.example.gamma", seedId: TEAM } }] });
  asc2.caps.B7 = ["PUSH_NOTIFICATIONS"];
  const g = await ensureProfile({ request: asc2.request, bundleId: "a.gamma", prefix: "com.example", udid: "U1", serials: ["ABC"], cache: {}, now });
  assert.deepEqual(g.entry.capabilities, [...APP_ID_CAPS].sort());
  assert.ok(!asc2.calls.includes("GET /bundleIds/B7")); // the team came with the App ID
});

test("findCertificate matches serials without leading zeros, any case", async () => {
  const asc = fakeAsc({ certs: [{ id: "X", attributes: { serialNumber: "00ab12" } }] });
  assert.equal((await findCertificate(asc.request, ["AB12"])).id, "X");
  assert.equal(await findCertificate(asc.request, ["AB13"]), null);
});

test("profileSerials reads the imported profile's certificates", () => {
  const serials = profileSerials(fx("test.mobileprovision"));
  assert.ok(serials.length >= 1);
  assert.ok(serials.includes(certSerial(fx("test-cert.der"))));
});

test("httpTransport: bearer token, JSON body, Apple's error detail", async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith("/bad")) return new Response(JSON.stringify({ errors: [{ status: "409", code: "ENTITY_ERROR", detail: "There is a problem" }] }), { status: 409 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const req = httpTransport({ base: "https://relay/v1", token: async () => "TOK", fetcher });
  assert.deepEqual(await req("POST", "/devices", { a: 1 }), { data: [] });
  assert.equal(seen[0].url, "https://relay/v1/devices");
  assert.equal(seen[0].init.headers.Authorization, "Bearer TOK");
  assert.equal(seen[0].init.body, '{"a":1}');
  await assert.rejects(req("GET", "/bad"), (e) => e.status === 409 && e.code === "ENTITY_ERROR" && /There is a problem/.test(e.message));
});

test("profileRows", () => {
  const rows = profileRows({ a: { identifier: "com.example.a", made: "2026-11-18", expires: "2027-11-18T00:00:00Z", udids: ["1", "2"], push: "production" } }, Date.UTC(2026, 10, 19));
  assert.deepEqual(rows, [{ label: "com.example.a", subtitle: "Ad Hoc, 2 devices, Push, until 2027-11-18" }]);
});

// ---- Make Certificate against the fake ASC ----
// Apple's side of POST /certificates: a certificate for the CSR's key (unsigned: nothing here checks Apple's signature),
// with Apple's issuer OU "G3" before the subject's team OU, and Apple's 409 at the limit.
function fakeCert(csrPem, serial, team = "S8NFX3A2LT") {
  const b = unpem(csrPem);
  const [info] = children(b, der(b, 0));
  const [, name, spki] = children(b, info);
  const ou = (v) => tlv(0x31, seq(oid("2.5.4.11"), tlv(0x13, new TextEncoder().encode(v))));
  const alg = seq(oid("1.2.840.113549.1.1.11"), Uint8Array.of(5, 0));
  const t = (s) => tlv(0x17, new TextEncoder().encode(s));
  const tbs = seq(tlv(0xa0, tlv(0x02, Uint8Array.of(2))), tlv(0x02, Uint8Array.from(Buffer.from(serial, "hex"))), alg, seq(ou("G3")),
    seq(t("261119000000Z"), t("271119000000Z")), seq(ou(team)), b.slice(name.end, spki.end));
  return seq(tbs, alg, tlv(0x03, Uint8Array.of(0, 1, 2, 3)));
}
function withCerts(asc, { limit = 2, status = 409 } = {}) {
  asc.dist = asc.dist ?? [];
  const base = asc.request;
  asc.request = async (method, path, body) => {
    const p = path.split("?")[0];
    if (method === "GET" && p === "/certificates") { asc.calls.push(`${method} ${p}`); return { data: [...asc.certs, ...asc.dist] }; }
    if (method === "DELETE" && p.startsWith("/certificates/")) {
      asc.calls.push(`${method} ${p}`);
      asc.dist = asc.dist.filter((c) => `/certificates/${c.id}` !== p);
      return {};
    }
    if (method === "POST" && p === "/certificates") {
      asc.calls.push(`${method} ${p}`);
      asc.lastCertBody = body;
      if (asc.dist.length >= limit) throw new AscError("App Store Connect POST /certificates: You already have a current Distribution certificate", { status, code: "ENTITY_ERROR.ATTRIBUTE.INVALID" });
      const serial = `7A${String(asc.dist.length + 1).padStart(2, "0")}`;
      const cert = fakeCert(body.data.attributes.csrContent, serial);
      const c = { id: `NC${asc.dist.length + 1}`, attributes: { certificateType: "DISTRIBUTION", serialNumber: serial, displayName: "Me",
        expirationDate: "2027-11-19T00:00:00.000+0000", certificateContent: Buffer.from(cert).toString("base64") } };
      asc.dist.push(c);
      return { data: c };
    }
    return base(method, path, body);
  };
  return asc;
}

test("Make Certificate: key and CSR made here, a DISTRIBUTION certificate, a .p12 that opens, the own App ID's profile", async () => {
  const asc = withCerts(fakeAsc({ certs: [], devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] }));
  const cache = {};
  const r = await makeOwnSigning({ request: asc.request, udid: "U2", deviceName: "iPhone", cache, subtle });
  assert.equal(asc.lastCertBody.data.attributes.certificateType, "DISTRIBUTION");
  assert.match(asc.lastCertBody.data.attributes.csrContent, /^-----BEGIN CERTIFICATE REQUEST-----/);
  assert.ok(!JSON.stringify(asc.lastCertBody).includes("PRIVATE KEY")); // only the CSR leaves
  assert.equal(r.certId, "NC1");
  assert.equal(r.serial, "7A01");
  assert.equal(r.team, "S8NFX3A2LT");
  assert.ok(await checkP12Password(r.p12, r.password, subtle));
  assert.equal(await checkP12Password(r.p12, "wrong", subtle), false);
  // the profile: this app's own App ID, under the certificate's team, with the new certificate
  assert.equal(r.identifier, appIdFor(BUNDLE_ID, appIdPrefix(null, "S8NFX3A2LT")));
  assert.equal(r.profileError, null);
  assert.equal(r.profile, cache[r.identifier].content);
  assert.equal(cache[r.identifier].certId, "NC1");
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data, [{ type: "certificates", id: "NC1" }]);
  assert.ok(asc.devices.some((d) => d.attributes.udid === "U2"));
  // nothing revoked on its own
  assert.ok(!asc.calls.some((c) => c.startsWith("DELETE /certificates")));
});

test("Make Certificate at Apple's limit: the list to pick from, nothing revoked; then only the picked one", async () => {
  const asc = withCerts(fakeAsc({ certs: [], devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] }));
  asc.dist = [
    { id: "OLD", attributes: { certificateType: "IOS_DISTRIBUTION", serialNumber: "0011", name: "Old", expirationDate: "2027-01-01T00:00:00.000+0000" } },
    { id: "MINE", attributes: { certificateType: "DISTRIBUTION", serialNumber: "22", displayName: "Mine", expirationDate: "2027-06-01T00:00:00.000+0000" } },
  ];
  let err;
  await assert.rejects(makeOwnSigning({ request: asc.request, ownSerials: ["22"], subtle }), (e) => (err = e).code === "cert-limit");
  assert.equal(err.message, LIMIT_TEXT);
  assert.deepEqual(err.certs.map((c) => [c.id, c.kind, c.ours]), [["MINE", "Apple Distribution", true], ["OLD", "iOS Distribution", false]]);
  assert.ok(!asc.calls.some((c) => c.startsWith("DELETE")));
  assert.match(REVOKE_WARNING, /stop opening/);

  // a pick that's gone meanwhile: refused, nothing revoked
  await assert.rejects(newCertificate({ request: asc.request, revokeId: "NOPE", subtle }), (e) => e.code === "cert-gone" && e.certs.length === 2);
  assert.ok(!asc.calls.some((c) => c.startsWith("DELETE")));

  const r = await makeOwnSigning({ request: asc.request, revokeId: "OLD", subtle });
  assert.deepEqual(asc.calls.filter((c) => c.startsWith("DELETE")), ["DELETE /certificates/OLD"]);
  assert.ok(asc.dist.some((c) => c.id === "MINE"));
  assert.ok(r.certId);
});

test("Make Certificate: a non-Admin key, a refused key; a failed profile keeps the .p12", async () => {
  const role = withCerts(fakeAsc(), { limit: 0, status: 403 });
  await assert.rejects(newCertificate({ request: role.request, subtle }), (e) => e.code === "key-role" && e.message === KEY_ROLE_TEXT);
  const bad = withCerts(fakeAsc(), { limit: 0, status: 401 });
  await assert.rejects(newCertificate({ request: bad.request, subtle }), (e) => e.code === "key-refused");
  // 409 with nothing to revoke is Apple's own error, passed on
  const odd = withCerts(fakeAsc({ certs: [] }), { limit: 0 });
  await assert.rejects(newCertificate({ request: odd.request, subtle }), (e) => e.status === 409 && e.code !== "cert-limit");

  const asc = withCerts(fakeAsc({ certs: [] }));
  const base = asc.request;
  asc.request = (method, path, body) => (method === "POST" && path === "/profiles" ? Promise.reject(new AscError("nope", { status: 500 })) : base(method, path, body));
  const r = await makeOwnSigning({ request: asc.request, prefix: "com.example", subtle });
  assert.equal(r.profile, null);
  assert.equal(r.profileError.status, 500);
  assert.ok(r.p12.length > 100 && r.password);
});

test("a .p12 imported alone: the own App ID's profile comes from the key", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  const r = await profileForP12({ request: asc.request, serials: ["ABC"], team: "S8NFX3A2LT", udid: "U1", cache: {} });
  assert.equal(r.appId, appIdFor(BUNDLE_ID, appIdPrefix(null, "S8NFX3A2LT")));
  assert.equal(r.entry.certId, "C1");
  await assert.rejects(profileForP12({ request: asc.request, serials: ["FFFF"], prefix: "com.example", cache: {} }), (e) => e.code === "no-cert");
});

test("certTeam reads the subject's OU, not the issuer's", () => {
  const csr = "-----BEGIN CERTIFICATE REQUEST-----\n" + Buffer.from(seq(seq(tlv(0x02, Uint8Array.of(0)), seq(), seq(seq(), Uint8Array.of(3, 1, 0)), tlv(0xa0)))).toString("base64") + "\n-----END CERTIFICATE REQUEST-----";
  assert.equal(certTeam(fakeCert(csr, "01", "ABCDE12345")), "ABCDE12345");
  assert.equal(certTeam(Uint8Array.of(1, 2, 3)), null);
});

test("a .p12 alone whose serial isn't known: the profile lists every distribution certificate, prefix from their team", async () => {
  const csr = "-----BEGIN CERTIFICATE REQUEST-----\n" + Buffer.from(seq(seq(tlv(0x02, Uint8Array.of(0)), seq(), seq(seq(), Uint8Array.of(3, 1, 0)), tlv(0xa0)))).toString("base64") + "\n-----END CERTIFICATE REQUEST-----";
  const content = Buffer.from(fakeCert(csr, "01", "ABCDE12345")).toString("base64");
  const asc = fakeAsc({ certs: [
    { id: "A1", attributes: { certificateType: "DISTRIBUTION", serialNumber: "01", certificateContent: content } },
    { id: "A2", attributes: { certificateType: "IOS_DISTRIBUTION", serialNumber: "02" } },
    { id: "DEV", attributes: { certificateType: "DEVELOPMENT", serialNumber: "03" } }] });
  const r = await profileForAnyP12({ request: asc.request, cache: {} });
  assert.equal(r.certs, 2);
  assert.equal(r.appId, appIdFor(BUNDLE_ID, appIdPrefix(null, "ABCDE12345")));
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data.map((c) => c.id), ["A1", "A2"]);
  const none = fakeAsc({ certs: [{ id: "DEV", attributes: { certificateType: "DEVELOPMENT" } }] });
  await assert.rejects(profileForAnyP12({ request: none.request, cache: {} }), (e) => e.code === "no-cert");
  assert.ok(!none.calls.includes("POST /profiles"));
  // the single-certificate body is unchanged
  assert.deepEqual(profileBody({ name: "n", bundleIdId: "b", certId: "C1", deviceIds: [] }).data.relationships.certificates.data, [{ type: "certificates", id: "C1" }]);
});
