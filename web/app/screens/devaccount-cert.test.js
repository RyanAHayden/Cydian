// Make Certificate and the .p12-alone profile (screens/devaccount.js makeCertificateFlow, pickRevoke, profileFromKey,
// nativeRequest), with a small fake App Store Connect, scripted alerts and an in-memory identity store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCertificateFlow, pickRevoke, profileFromKey, nativeRequest, hasCertificate, keepIdentity, MAKE_CERT_BUTTON, P12_NAME } from "./devaccount.js";
import { AscError, REVOKE_WARNING, LIMIT_TEXT } from "../core/asc.js";
import { unpem, tlv, seq, oid } from "../core/freecert.js";
import { der, children, checkP12Password, parseProfile } from "../core/signing.js";

// Apple's certificate for the CSR's key (unsigned), issuer OU "G3" before the subject's team OU.
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
function fakeProfile(appId) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Name</key><string>P</string>`
    + `<key>TeamIdentifier</key><array><string>S8NFX3A2LT</string></array><key>ExpirationDate</key><date>2027-11-19T00:00:00Z</date>`
    + `<key>ProvisionedDevices</key><array></array><key>Entitlements</key><dict><key>application-identifier</key>`
    + `<string>S8NFX3A2LT.${appId}</string><key>aps-environment</key><string>production</string></dict></dict></plist>`;
  return Buffer.from(`\x30\x80junk${xml}trailer`, "latin1").toString("base64");
}
function fakeAsc({ certs = [], limit = 2, failProfiles = 0 } = {}) {
  const s = { certs: [...certs], bundleIds: [], caps: {}, profiles: [], calls: [], n: 0, failProfiles };
  s.request = async (method, path, body) => {
    const p = path.split("?")[0];
    s.calls.push(`${method} ${p}`);
    const id = () => `id${++s.n}`;
    if (method === "GET" && p === "/certificates") return { data: s.certs };
    if (method === "DELETE" && p.startsWith("/certificates/")) { s.certs = s.certs.filter((c) => `/certificates/${c.id}` !== p); return {}; }
    if (method === "POST" && p === "/certificates") {
      if (s.certs.length >= limit) throw new AscError("App Store Connect POST /certificates: limit", { status: 409 });
      const serial = `7A${String(s.n + 1).padStart(2, "0")}`;
      const c = { id: id(), attributes: { certificateType: "DISTRIBUTION", serialNumber: serial, displayName: "Me", expirationDate: "2027-11-19T00:00:00.000+0000",
        certificateContent: Buffer.from(fakeCert(body.data.attributes.csrContent, serial)).toString("base64") } };
      s.certs.push(c);
      return { data: c };
    }
    if (method === "GET" && p === "/devices") return { data: [] };
    if (method === "GET" && p === "/bundleIds") return { data: s.bundleIds };
    if (method === "POST" && p === "/bundleIds") { const b = { id: id(), attributes: body.data.attributes }; s.bundleIds.push(b); s.caps[b.id] = []; return { data: b }; }
    if (method === "POST" && p === "/bundleIdCapabilities") { s.caps[body.data.relationships.bundleId.data.id].push(body.data.attributes.capabilityType); return { data: {} }; }
    const m = /^\/bundleIds\/([^/]+)\/bundleIdCapabilities$/.exec(p);
    if (method === "GET" && m) return { data: s.caps[m[1]].map((c) => ({ attributes: { capabilityType: c } })) };
    if (method === "GET" && p === "/profiles") return { data: [] };
    if (method === "POST" && p === "/profiles") {
      if (s.failProfiles-- > 0) throw new AscError("App Store Connect POST /profiles: busy", { status: 500 });
      s.lastProfile = body;
      const bid = s.bundleIds.find((b) => b.id === body.data.relationships.bundleId.data.id).attributes.identifier;
      return { data: { id: id(), attributes: { name: body.data.attributes.name, profileContent: fakeProfile(bid) } } };
    }
    throw new Error(`fake ASC: no route ${method} ${path}`);
  };
  return s;
}
const store = (start = null) => {
  let id = start;
  return { load: async () => (id ? { ...id } : null), save: async (patch) => (id = { ...(id ?? {}), ...patch }), get: () => id };
};
// Alerts answered in order by `answers` (functions of the alert's options, or button titles); `seen` keeps them.
function script(answers) {
  const seen = [];
  const alert = async (o) => {
    seen.push(o);
    const a = answers.shift();
    const want = typeof a === "function" ? a(o) : a;
    const index = typeof want === "number" ? want : o.buttons.indexOf(want ?? o.buttons[o.cancel ?? 0]);
    return { index };
  };
  return { alert, seen };
}
const hud = () => () => {};

test("Make Certificate on the website: confirmed, a certificate, the own profile, kept as the .p12 with its password", async () => {
  const asc = fakeAsc();
  const ids = store();
  const { alert, seen } = script(["Make", "OK"]);
  const ok = await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: ids });
  assert.equal(ok, true);
  const kept = ids.get();
  assert.equal(kept.p12Name, P12_NAME);
  assert.equal(kept.passwordOk, true);
  assert.equal(await checkP12Password(kept.p12, kept.password), true);
  assert.ok(parseProfile(kept.profile).appId);
  assert.match(seen[0].message, /in this browser and never leaves it/);
  assert.equal(seen.at(-1).title, "Certificate Made");
  assert.ok(!asc.calls.some((c) => c.startsWith("DELETE /certificates")), "nothing revoked");
});

test("Make Certificate in the app: signing.import gets the .p12, its password and the profile (base64)", async () => {
  const asc = fakeAsc();
  const ids = store();
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return m === "signing.status" ? { identity: null } : {}; } };
  const { alert, seen } = script(["Make", "OK"]);
  assert.equal(await makeCertificateFlow(native, { request: asc.request, alert, hud, identity: ids }), true);
  const imp = calls.find(([m]) => m === "signing.import")?.[1];
  assert.ok(imp && imp.p12 && imp.profile && imp.password);
  assert.equal(await checkP12Password(Buffer.from(imp.p12, "base64"), imp.password), true);
  assert.equal(ids.get().p12, undefined, "the app keeps only the names in memory");
  assert.match(seen[0].message, /on this iPhone/);
});

test("Cancel at the first alert makes nothing", async () => {
  const asc = fakeAsc();
  const { alert } = script(["Cancel"]);
  assert.equal(await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: store() }), false);
  assert.ok(!asc.calls.includes("POST /certificates"));
});

test("at Apple's limit: the picker lists them, the warning shows, only the picked one is revoked", async () => {
  const old = (i, ours) => ({ id: `OLD${i}`, attributes: { certificateType: "DISTRIBUTION", serialNumber: ours ? "0ABC" : `0${i}`, displayName: `Cert ${i}`, expirationDate: `2027-0${i}-01` } });
  const asc = fakeAsc({ certs: [old(1), old(2)] });
  const ids = store();
  const { alert, seen } = script(["Make", (o) => o.buttons.indexOf("Revoke 2"), "Revoke", "OK"]);
  assert.equal(await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: ids }), true);
  const picker = seen[1];
  assert.equal(picker.title, "Certificate Limit");
  assert.ok(picker.message.startsWith(LIMIT_TEXT));
  assert.equal(picker.buttons.at(-1), "Cancel");
  assert.ok(seen[2].message.includes(REVOKE_WARNING));
  const revoked = asc.calls.filter((c) => c.startsWith("DELETE /certificates"));
  assert.equal(revoked.length, 1);
  const picked = picker.message.split("\n\n")[2]; // "2. Cert N: ..."
  assert.ok(revoked[0].endsWith(picked.includes("Cert 1") ? "OLD1" : "OLD2"));
});

test("at the limit, Cancel in the picker or at the warning revokes nothing", async () => {
  const certs = [1, 2].map((i) => ({ id: `OLD${i}`, attributes: { certificateType: "DISTRIBUTION", serialNumber: `0${i}` } }));
  for (const answers of [["Make", "Cancel"], ["Make", "Revoke 1", "Cancel"]]) {
    const asc = fakeAsc({ certs });
    const { alert } = script(answers);
    assert.equal(await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: store() }), false);
    assert.ok(!asc.calls.some((c) => c.startsWith("DELETE")));
  }
});

test("pickRevoke marks the certificate in use and says so in the warning", async () => {
  const { alert, seen } = script(["Revoke 1", "Revoke"]);
  const id = await pickRevoke([{ id: "X", name: "Me", kind: "Apple Distribution", expires: "2027-01-02T00:00:00Z", ours: true }], { alert });
  assert.equal(id, "X");
  assert.match(seen[0].message, /Apple Distribution, until 2027-01-02 \(in use\)/);
  assert.match(seen[1].message, /signs with now/);
  assert.equal(seen[1].colors[1], "red");
  assert.equal(await pickRevoke([], { alert }), null);
});

test("a failed profile step: Try Again makes it, so the .p12 isn't lost", async () => {
  const asc = fakeAsc({ failProfiles: 1 });
  const ids = store();
  const { alert, seen } = script(["Make", "Try Again", "OK"]);
  assert.equal(await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: ids }), true);
  assert.equal(seen[1].title, "Certificate Made, No Profile");
  assert.ok(ids.get().profile);
});

test("a failed profile step on the website, Later: the .p12 is still kept", async () => {
  const asc = fakeAsc({ failProfiles: 5 });
  const ids = store();
  const { alert } = script(["Make", "Later"]);
  assert.equal(await makeCertificateFlow(false, { request: asc.request, alert, hud, identity: ids }), false);
  assert.ok(ids.get().p12 && ids.get().password && !ids.get().profile);
});

test("a non-Admin key: Apple's 403 is said plainly, nothing kept", async () => {
  const ids = store();
  const request = async (m, p) => {
    if (m === "POST" && p === "/certificates") throw new AscError("forbidden", { status: 403 });
    return { data: [] };
  };
  const { alert, seen } = script(["Make", "OK"]);
  assert.equal(await makeCertificateFlow(false, { request, alert, hud, identity: ids }), false);
  assert.match(seen[1].message, /Admin role/);
  assert.equal(ids.get(), null);
});

test("a .p12 picked alone with a key: the profile lists every distribution certificate", async () => {
  const asc = fakeAsc({ certs: [{ id: "A1", attributes: { certificateType: "DISTRIBUTION", serialNumber: "01" } },
    { id: "A2", attributes: { certificateType: "IOS_DISTRIBUTION", serialNumber: "02" } }] });
  const ids = store({ p12: Uint8Array.of(0x30, 1), p12Name: "me.p12" });
  const info = async () => ({ keyId: "K" });
  assert.equal(await profileFromKey(false, { request: asc.request, identity: ids, hud, info }), true);
  assert.ok(ids.get().profile);
  assert.deepEqual(asc.lastProfile.data.relationships.certificates.data.map((c) => c.id), ["A1", "A2"]);
  // a profile already there, or no key: nothing happens
  const n = asc.calls.length;
  assert.equal(await profileFromKey(false, { request: asc.request, identity: ids, hud, info }), false);
  assert.equal(await profileFromKey(false, { request: asc.request, identity: store({ p12: Uint8Array.of(0x30) }), hud, info: async () => null }), false);
  assert.equal(asc.calls.length, n);
});

test("nativeRequest gives the shell's asc_<status> errors a status", async () => {
  const n = { call: async () => { throw Object.assign(new Error("Apple: no"), { code: "asc_409" }); } };
  await assert.rejects(nativeRequest(n)("POST", "/certificates", {}), (e) => e.status === 409);
  const ok = { call: async (m, p) => ({ m, p }) };
  assert.deepEqual(await nativeRequest(ok)("GET", "/devices"), { m: "asc.request", p: { method: "GET", path: "/v1/devices" } });
});

test("hasCertificate: only a status saying there's no identity hides nothing", async () => {
  assert.equal(await hasCertificate({ call: async () => ({ identity: null }) }), false);
  assert.equal(await hasCertificate({ call: async () => ({ identity: { serial: "1" } }) }), true);
  assert.equal(await hasCertificate({ call: async () => { throw new Error("no"); } }), true);
  assert.equal(await hasCertificate(false, { load: async () => null }), false);
  assert.equal(await hasCertificate(false, { load: async () => ({ p12: Uint8Array.of(1) }) }), true);
});

test("keepIdentity on the website takes base64 or bytes for the profile", async () => {
  const ids = store();
  await keepIdentity(false, { p12: Uint8Array.of(1), password: "pw", profile: Buffer.from("abc").toString("base64") }, { save: ids.save });
  assert.deepEqual([...ids.get().profile], [...Buffer.from("abc")]);
  assert.equal(MAKE_CERT_BUTTON, "Make Certificate");
});
