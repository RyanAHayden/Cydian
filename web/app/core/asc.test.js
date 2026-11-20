// Own provisioning profiles (core/asc.js) against a fake App Store Connect.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { keyIdFromName, makeJwt, httpTransport, appIdFor, appIdPrefix, remakeReason, ensureProfile, profileBody,
  findCertificate, profileSerials, profileRows, APP_ID_CAPS, AscError } from "./asc.js";
import { certSerial } from "./freecert.js";

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
  assert.equal(appIdFor("io.github.fizl0.hst.beta", "com.ryha"), "com.ryha.beta");
  assert.equal(appIdFor("com.foo.Bar_App", "com.ryha.*"), "com.ryha.Bar-App");
  assert.equal(appIdPrefix("com.ryha.*", "S8NFX3A2LT"), "com.ryha");
  assert.equal(appIdPrefix("com.ryha.beta", "S8NFX3A2LT"), "com.ryha");
  assert.equal(appIdPrefix("*", "S8NFX3A2LT"), "ifizbox.s8nfx3a2lt");
  assert.equal(appIdPrefix(null, "S8NFX3A2LT"), "ifizbox.s8nfx3a2lt");
});

test("remake rules", () => {
  const now = Date.UTC(2026, 10, 19);
  const good = { content: "x", expires: new Date(now + 300 * 864e5).toISOString(), udids: ["00008130-AAA"], caps: ["APP_GROUPS", "PUSH_NOTIFICATIONS"], certId: "C1" };
  assert.equal(remakeReason(null, { now }), "missing");
  assert.equal(remakeReason({ ...good, content: null }, { now }), "missing");
  assert.equal(remakeReason({ ...good, expires: new Date(now - 1).toISOString() }, { now }), "expired");
  assert.equal(remakeReason({ ...good, expires: new Date(now + 3600e3).toISOString() }, { now }), "expired"); // within a day
  assert.equal(remakeReason(good, { now, udid: "00008130-bbb" }), "device");
  assert.equal(remakeReason(good, { now, udid: "00008130-aaa" }), null);
  assert.equal(remakeReason(good, { now, caps: ["PUSH_NOTIFICATIONS", "APP_GROUPS"] }), null);
  assert.equal(remakeReason(good, { now, caps: ["PUSH_NOTIFICATIONS"] }), "capabilities");
  assert.equal(remakeReason(good, { now, certId: "C2" }), "certificate");
  assert.equal(remakeReason(good, { now, udid: "00008130-AAA", caps: good.caps, certId: "C1" }), null);
});

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
  const s = { devices: [...devices], certs, bundleIds: [...bundleIds], caps: {}, profiles: [], calls: [], n: 0 };
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
      const b = { id: id(), attributes: body.data.attributes };
      s.bundleIds.push(b);
      s.caps[b.id] = [];
      return { data: b };
    }
    if (method === "POST" && u.pathname === "/bundleIdCapabilities") {
      s.caps[body.data.relationships.bundleId.data.id].push(body.data.attributes.capabilityType);
      return { data: {} };
    }
    const m = /^\/bundleIds\/([^/]+)\/bundleIdCapabilities$/.exec(u.pathname);
    if (method === "GET" && m) {
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
  const r = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.ryha", udid: "00008130-0018450c3661001c",
    deviceName: "iPhone 15 Pro", serials: ["ABC"], cache, now });
  assert.equal(r.made, true);
  assert.equal(r.reason, "missing");
  assert.equal(r.deviceMade, true);
  assert.equal(r.appId, "com.ryha.beta");
  assert.deepEqual(asc.caps[asc.bundleIds[0].id], APP_ID_CAPS);
  assert.equal(asc.lastProfile.data.attributes.profileType, "IOS_APP_ADHOC");
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data, [{ type: "certificates", id: "C1" }]);
  // every ENABLED device, the new one included, not the disabled one
  assert.deepEqual(asc.lastProfile.data.relationships.devices.data.map((d) => d.id).sort(), ["D0", asc.devices[2].id].sort());
  const e = cache["com.ryha.beta"];
  assert.equal(e.push, "production");
  assert.deepEqual(e.caps, [...APP_ID_CAPS].sort());
  assert.ok(e.udids.includes("00008130-0018450C3661001C"));

  // second sign: one call (the capabilities), the cached profile
  asc.calls.length = 0;
  const again = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.ryha", udid: "00008130-0018450C3661001C", serials: ["ABC"], cache, now });
  assert.equal(again.made, false);
  assert.deepEqual(asc.calls, [`GET /bundleIds/${e.bundleIdId}/bundleIdCapabilities`]);

  // a capability turned off on the App ID: remade, the old profile deleted first
  asc.caps[e.bundleIdId] = ["PUSH_NOTIFICATIONS"];
  const capped = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.ryha", udid: "00008130-0018450C3661001C", serials: ["ABC"], cache, now });
  assert.equal(capped.reason, "capabilities");
  assert.equal(asc.profiles.length, 1);

  // another iPhone: registered, remade
  const third = await ensureProfile({ request: asc.request, bundleId: "io.github.fizl0.hst.beta", prefix: "com.ryha", udid: "00008150-NEW", serials: ["ABC"], cache, now });
  assert.equal(third.reason, "device");
  assert.equal(third.deviceMade, true);
});

test("ensureProfile: an App ID that's already there is reused; a certificate not in the account stops it", async () => {
  const asc = fakeAsc({ bundleIds: [{ id: "B9", attributes: { identifier: "com.ryha.betaX" } }, { id: "B1", attributes: { identifier: "com.ryha.beta" } }],
    devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  asc.caps.B1 = ["PUSH_NOTIFICATIONS"];
  const r = await ensureProfile({ request: asc.request, bundleId: "a.b.beta", prefix: "com.ryha", udid: "U1", serials: ["abc"], cache: {} });
  assert.equal(r.entry.bundleIdId, "B1"); // exact match, not the prefix match
  assert.equal(r.deviceMade, false);
  await assert.rejects(ensureProfile({ request: asc.request, bundleId: "a.b.beta", prefix: "com.ryha", udid: "U1", serials: ["FFFF"], cache: {} }),
    (e) => e.code === "no-cert");
});

test("ensureProfile: a cached App ID deleted on Apple's side is made again", async () => {
  const asc = fakeAsc({ devices: [{ id: "D1", attributes: { udid: "U1", status: "ENABLED" } }] });
  const cache = { "com.ryha.beta": { identifier: "com.ryha.beta", bundleIdId: "GONE", content: "x", expires: "2030-01-01T00:00:00Z", udids: ["U1"], caps: [] } };
  const r = await ensureProfile({ request: asc.request, bundleId: "a.beta", prefix: "com.ryha", udid: "U1", serials: ["ABC"], cache });
  assert.equal(r.made, true);
  assert.notEqual(cache["com.ryha.beta"].bundleIdId, "GONE");
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
  const rows = profileRows({ a: { identifier: "com.ryha.a", made: "2026-11-18", expires: "2027-11-18T00:00:00Z", udids: ["1", "2"], push: "production" } }, Date.UTC(2026, 10, 19));
  assert.deepEqual(rows, [{ label: "com.ryha.a", subtitle: "Ad Hoc, 2 devices, Push, until 2027-11-18" }]);
});
