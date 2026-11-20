// The website's certificate serial from the .p12 itself (signing-client.js identityCert), used by screens/devaccount.js
// over the serials of a profile that lists several certificates (F276's profile from an API key lists them all).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteSerials, profileFromKey, dropOtherCertProfile } from "./devaccount.js";
import { identityCert } from "../signing-client.js";
import { certSerial } from "../core/freecert.js";
import { toBase64 } from "../core/signing.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/signing/${n}`, import.meta.url)));
const SERIAL = certSerial(fx("test-cert.der"));
const PROFILE = fx("test.mobileprovision");
const store = (start = null) => {
  let id = start;
  return { load: async () => (id ? { ...id } : null), save: async (patch) => (id = { ...(id ?? {}), ...patch }), get: () => id };
};

test("identityCert reads the .p12's certificate once and keeps it with the identity, keyed to the .p12", async () => {
  const ids = store({ p12: fx("test-legacy.p12"), password: "hunter2" });
  assert.deepEqual(await identityCert(await ids.load(), { save: ids.save }), { serial: SERIAL, team: "TESTTEAM42" });
  assert.equal(ids.get().p12Cert.serial, SERIAL);
  assert.match(ids.get().p12Cert.of, /^[0-9a-f]{64}$/);
  // kept: not read again
  const read = async () => { throw new Error("read again"); };
  assert.equal((await identityCert(await ids.load(), { save: ids.save, read }))?.serial, SERIAL);
  // another .p12 under the same identity: read again
  await ids.save({ p12: fx("test-nopass.p12"), password: "" });
  const other = await identityCert(await ids.load(), { save: ids.save });
  assert.notEqual(other.serial, SERIAL);
  assert.equal(ids.get().p12Cert.serial, other.serial);
});

test("identityCert: a wrong password or no .p12 gives null and keeps nothing", async () => {
  const ids = store({ p12: fx("test.p12"), password: "nope" });
  assert.equal(await identityCert(await ids.load(), { save: ids.save }), null);
  assert.equal(ids.get().p12Cert, undefined);
  assert.equal(await identityCert(null), null);
  assert.equal(await identityCert({ profile: PROFILE }), null);
});

test("siteSerials: the .p12's serial alone when it can be read, else every serial the profile lists", async () => {
  const id = { p12: Uint8Array.of(1), profile: PROFILE };
  assert.deepEqual(await siteSerials(id, { cert: async () => ({ serial: "ABC1", team: "T" }) }), ["ABC1"]);
  const listed = await siteSerials(id, { cert: async () => null });
  assert.ok(listed.length >= 1);
  assert.deepEqual(await siteSerials(id, { cert: async () => { throw new Error("x"); } }), listed);
  assert.deepEqual(await siteSerials({ p12: Uint8Array.of(1) }, { cert: async () => null }), []);
  // the real reader: the profile's certificate is the fixture .p12's
  assert.deepEqual(await siteSerials({ p12: fx("test.p12"), password: "hunter2", profile: PROFILE }, { save: async () => {} }), [SERIAL]);
});

// The parts of App Store Connect profileFromKey goes through.
function fakeAsc(certs) {
  const s = { calls: [], bundleIds: [], caps: {}, n: 0 };
  s.request = async (method, path, body) => {
    const p = path.split("?")[0];
    s.calls.push(`${method} ${p}`);
    if (method === "GET" && p === "/certificates") return { data: certs };
    if (method === "GET" && p === "/devices") return { data: [] };
    if (method === "GET" && p === "/bundleIds") return { data: s.bundleIds };
    if (method === "POST" && p === "/bundleIds") { const b = { id: `b${++s.n}`, attributes: body.data.attributes }; s.bundleIds.push(b); s.caps[b.id] = []; return { data: b }; }
    if (method === "POST" && p === "/bundleIdCapabilities") { s.caps[body.data.relationships.bundleId.data.id].push(body.data.attributes.capabilityType); return { data: {} }; }
    const m = /^\/bundleIds\/([^/]+)\/bundleIdCapabilities$/.exec(p);
    if (method === "GET" && m) return { data: s.caps[m[1]].map((c) => ({ attributes: { capabilityType: c } })) };
    if (method === "GET" && p === "/profiles") return { data: [] };
    if (method === "POST" && p === "/profiles") {
      s.lastProfile = body;
      return { data: { id: "p1", attributes: { name: body.data.attributes.name, profileContent: toBase64(PROFILE) } } };
    }
    throw new Error(`fake ASC: no route ${method} ${path}`);
  };
  return s;
}

test("a .p12 picked alone whose serial reads: the profile is made for its certificate only, under its team", async () => {
  const asc = fakeAsc([{ id: "A1", attributes: { certificateType: "DISTRIBUTION", serialNumber: "01" } },
    { id: "A2", attributes: { certificateType: "DISTRIBUTION", serialNumber: "02" } }]);
  const ids = store({ p12: Uint8Array.of(0x30, 1), p12Name: "me.p12" });
  const ok = await profileFromKey(false, { request: asc.request, identity: ids, hud: () => () => {}, info: async () => ({ keyId: "K" }),
    cert: async () => ({ serial: "02", team: "ABCDE12345" }) });
  assert.equal(ok, true);
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data.map((c) => c.id), ["A2"]);
  assert.ok(asc.bundleIds[0].attributes.identifier.includes("abcde12345"));
  assert.ok(ids.get().profile);
});

test("a cached per-app profile without the .p12's certificate is forgotten, one with it is kept", () => {
  const entry = { content: toBase64(PROFILE) };
  const c = { "x.app": { ...entry } };
  assert.equal(dropOtherCertProfile(c, "x.app", [SERIAL]), false);
  assert.ok(c["x.app"]);
  assert.equal(dropOtherCertProfile(c, "x.app", ["FFFF"]), true);
  assert.equal(c["x.app"], undefined);
  // several serials (the .p12's unknown), nothing cached, or an unreadable entry: left alone
  const d = { "x.app": { ...entry }, "y.app": { content: "!!" } };
  assert.equal(dropOtherCertProfile(d, "x.app", ["FFFF", "EEEE"]), false);
  assert.equal(dropOtherCertProfile(d, "z.app", ["FFFF"]), false);
  assert.equal(dropOtherCertProfile(d, "y.app", ["FFFF"]), false);
  assert.ok(d["x.app"] && d["y.app"]);
});
