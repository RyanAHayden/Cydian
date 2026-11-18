import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseProfile, parseCert, parsePlist, checkP12Password, summary, profileCert, profileKind, normalizeServer,
  bmpPassword, toBase64, APP_SERVER, LEGACY_SERVER,
} from "./signing.js";

// Throwaway certificates with fixed dates, written by the old web/signer/make_fixtures.py (gone with the server, 9905b05).
const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${name}`, import.meta.url)));
const PROFILE = fx("test.mobileprovision");
const P12 = fx("test.p12");
const P12_LEGACY = fx("test-legacy.p12");

test("the profile: name, team, app ID, expiry, device count", () => {
  const p = parseProfile(PROFILE);
  assert.equal(p.name, "Cydian Test Profile");
  assert.equal(p.teamId, "TESTTEAM42");
  assert.equal(p.teamName, "Test Person");
  assert.equal(p.appId, "*");
  assert.equal(p.devices, 3);
  assert.equal(p.allDevices, false);
  assert.equal(p.expires.toISOString(), "2026-11-24T00:00:00.000Z"); // created 17 Nov, 7 days
  assert.equal(profileKind(p), "Development");
  assert.equal(p.certs.length, 2);
});

test("the certificate in the profile: name, team, expiry; the profile's own team first", () => {
  const p = parseProfile(PROFILE);
  const c = profileCert(p);
  assert.equal(c.name, "Apple Development: Test Person (ABCDE12345)");
  assert.equal(c.team, "TESTTEAM42");
  assert.equal(c.org, "Test Person");
  assert.equal(c.notBefore.toISOString(), "2026-11-16T00:00:00.000Z");
  assert.equal(c.notAfter.toISOString(), "2027-11-16T00:00:00.000Z");
  assert.equal(p.certs[0].team, "OTHERTEAM1"); // listed first, but not the profile's team
});

test("not a profile", () => {
  assert.throws(() => parseProfile(new TextEncoder().encode("hello")), /not a provisioning profile/);
  assert.throws(() => parseCert(new Uint8Array([0x30, 0x05, 1])), /truncated/);
});

test("plist values: dict, array, data, date, numbers, booleans, entities, empty forms", () => {
  const v = parsePlist(`<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict>
    <key>s</key><string>a &amp; b &#x41;</string><key>e</key><string/><key>i</key><integer>-3</integer>
    <key>r</key><real>1.5</real><key>t</key><true/><key>f</key><false/><key>d</key><date>2027-01-02T03:04:05Z</date>
    <key>b</key><data>AAEC</data><key>a</key><array><string>x</string><dict/></array><key>z</key><array/>
  </dict></plist>`);
  assert.deepEqual({ ...v, d: v.d.toISOString(), b: [...v.b] },
    { s: "a & b A", e: "", i: -3, r: 1.5, t: true, f: false, d: "2027-01-02T03:04:05.000Z", b: [0, 1, 2], a: ["x", {}], z: [] });
});

test("the .p12's password, checked against its MAC (SHA-256 and SHA-1)", async () => {
  assert.equal(await checkP12Password(P12, "hunter2"), true);
  assert.equal(await checkP12Password(P12, "hunter3"), false);
  assert.equal(await checkP12Password(P12, ""), false);
  assert.equal(await checkP12Password(P12_LEGACY, "hunter2"), true);
  assert.equal(await checkP12Password(P12_LEGACY, "Hunter2"), false);
  assert.equal(await checkP12Password(new Uint8Array([1, 2, 3]), "x"), null);
});

test("BMPString password with its terminator", () => {
  assert.deepEqual([...bmpPassword("ab")], [0, 0x61, 0, 0x62, 0, 0]);
  assert.deepEqual([...bmpPassword(null)], []);
});

test("summary rows and problems", () => {
  const profile = parseProfile(PROFILE);
  const ok = summary({ profile, passwordOk: true, now: new Date("2026-11-18T00:00:00Z"), locale: "en-US", timeZone: "UTC" });
  const rows = Object.fromEntries(ok.rows.map((r) => [r.label, r.detail]));
  assert.equal(rows.Certificate, "Apple Development: Test Person (ABCDE12345)");
  assert.equal(rows.Team, "Test Person (TESTTEAM42)");
  assert.equal(rows["Certificate Expires"], "Nov 16, 2027");
  assert.equal(rows["Profile Expires"], "Nov 24, 2026");
  assert.equal(rows.Devices, "3");
  assert.equal(rows["Certificates in Profile"], "2");
  assert.deepEqual(ok.problems, []);
  const late = summary({ profile, passwordOk: false, now: new Date("2028-01-01T00:00:00Z"), locale: "en-US", timeZone: "UTC" });
  assert.deepEqual(late.problems, [
    "The certificate expired on Nov 16, 2027.",
    "The provisioning profile expired on Nov 24, 2026.",
    "The certificate's password is wrong.",
  ]);
});

test("signing server addresses", () => {
  assert.equal(APP_SERVER, "https://sign.ifizbox.com"); // B22: brand.js SIGN_HOST, not the dead sign.cydian.dev
  assert.equal(LEGACY_SERVER, "https://ifizbox.com");
  assert.equal(normalizeServer("sign.example.org"), "https://sign.example.org");
  assert.equal(normalizeServer(" https://box.tail1234.ts.net:8443/ "), "https://box.tail1234.ts.net:8443");
  assert.equal(normalizeServer("http://192.168.1.5:8080"), "http://192.168.1.5:8080");
  assert.equal(normalizeServer("https://example.org/cydian/"), "https://example.org/cydian");
  assert.equal(normalizeServer(""), null);
  assert.equal(normalizeServer("ftp://x"), null);
  assert.equal(normalizeServer("https://u:p@x.org"), null);
});

test("bytes go to the bridge as base64", () => {
  assert.equal(toBase64(new Uint8Array([255, 0, 1])), "/wAB");
});
