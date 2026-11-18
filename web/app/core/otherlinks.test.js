// F83: other sideloaders' links -> iFizBox's own (core/otherlinks.js), one test per app's link shape, and the scheme
// list kept the same in the plist, the shell and the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOtherLink, OTHER_SCHEMES, otherLinksOn, setOtherLinks } from "./otherlinks.js";

const SRC = "https://repo.example.com/apps.json";
const IPA = "https://cdn.example.com/dl/My%20App.ipa";
const P = (l) => { const r = parseOtherLink(l); return r && [r.app, r.action, r.url]; };

test("AltStore: source and install, url= encoded", () => {
  assert.deepEqual(P(`altstore://source?url=${encodeURIComponent(SRC)}`), ["AltStore", "source", SRC]);
  assert.deepEqual(P(`altstore://install?url=${encodeURIComponent(IPA)}`), ["AltStore", "install", IPA]);
  assert.deepEqual(P(`altstore-classic://source?url=${encodeURIComponent(SRC)}`), ["AltStore Classic", "source", SRC]);
});

test("AltStore: raw url= and a URL with its own query (encoded) survive", () => {
  assert.deepEqual(P(`altstore://source?url=${SRC}`), ["AltStore", "source", SRC]);
  const q = "https://x.example/s.json?a=1&b=2";
  assert.deepEqual(P(`altstore://source?url=${encodeURIComponent(q)}`), ["AltStore", "source", q]);
  assert.deepEqual(P(`ALTSTORE://SOURCE?URL=${SRC}`), ["AltStore", "source", SRC]); // AltStore lowercases the names too
});

test("SideStore: source and install", () => {
  assert.deepEqual(P(`sidestore://source?url=${encodeURIComponent(SRC)}`), ["SideStore", "source", SRC]);
  assert.deepEqual(P(`sidestore://install?url=${encodeURIComponent(IPA)}`), ["SideStore", "install", IPA]);
});

test("Feather and Ksign: /source/<url> and /install/<url>, raw", () => {
  assert.deepEqual(P(`feather://source/${SRC}`), ["Feather", "source", SRC]);
  assert.deepEqual(P(`feather://install/${IPA}`), ["Feather", "install", IPA]);
  const q = "https://x.example/get?id=5&t=abc";
  assert.deepEqual(P(`feather://install/${q}`), ["Feather", "install", q]);
  assert.deepEqual(P(`ksign://source/${SRC}`), ["Ksign", "source", SRC]);
  assert.deepEqual(P(`ksign://install/${encodeURIComponent(IPA)}`), ["Ksign", "install", IPA]);
});

test("TrollApps, StikStore, ESign, Scarlet, GBox", () => {
  assert.deepEqual(P(`trollapps://add?url=${encodeURIComponent(SRC)}`), ["TrollApps", "source", SRC]);
  assert.deepEqual(P(`stikstore://add-source?url=${encodeURIComponent(SRC)}`), ["StikStore", "source", SRC]);
  assert.deepEqual(P(`esign://addsource?url=${SRC}`), ["ESign", "source", SRC]);
  assert.deepEqual(P(`esign://install?url=${encodeURIComponent(IPA)}`), ["ESign", "install", IPA]);
  assert.deepEqual(P(`scarlet://repo=${SRC}`), ["Scarlet", "source", SRC]);
  assert.deepEqual(P(`scarlet://install=${IPA}`), ["Scarlet", "install", IPA]);
  assert.deepEqual(P(`gbox://AddSource/${SRC}`), ["GBox", "source", SRC]);
});

test("an unknown word with an .ipa URL installs; the apps' own callbacks are 'other'", () => {
  assert.deepEqual(P(`altstore://whatever?url=${encodeURIComponent(IPA)}`), ["AltStore", "install", IPA]);
  assert.deepEqual(P(`altstore://whatever?url=${encodeURIComponent(SRC)}`), ["AltStore", "other", null]);
  assert.deepEqual(P("feather://import-certificate?p12=AAA&mobileprovision=BBB&password=CCC"), ["Feather", "other", null]);
  assert.deepEqual(P("sidestore://pairing?urlname=x"), ["SideStore", "other", null]);
  assert.deepEqual(P("altstore://appbackupresponse/success"), ["AltStore", "other", null]);
  assert.deepEqual(P("altstore://source"), ["AltStore", "other", null]); // no URL
});

test("no http(s) URL, credentials, file: and other schemes", () => {
  assert.deepEqual(P("altstore://source?url=file:///etc/passwd"), ["AltStore", "other", null]);
  assert.deepEqual(P("feather://install/javascript:alert(1)"), ["Feather", "other", null]);
  assert.deepEqual(P("altstore://source?url=https://u:p@x.example/s.json"), ["AltStore", "other", null]);
  for (const l of ["cydian://add?url=" + SRC, "sileo://source/" + SRC, "livecontainer://source?url=" + SRC, SRC, "", null, "x".repeat(9000)]) {
    assert.equal(parseOtherLink(l), null, String(l).slice(0, 40));
  }
});

test("the same schemes in Info-sideload.plist, App.swift and OTHER_SCHEMES", () => {
  const root = new URL("../../../", import.meta.url);
  const plist = readFileSync(new URL("native/Info-sideload.plist", root), "utf8");
  const block = plist.match(/com\.ryha\.cydian\.other<\/string>\s*<key>CFBundleURLSchemes<\/key><array>(.*?)<\/array>/s)?.[1] ?? "";
  const inPlist = [...block.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  const swift = readFileSync(new URL("native/Sources/App.swift", root), "utf8");
  const set = swift.match(/enum OtherLink \{\s*static let schemes: Set<String> = \[(.*?)\]/s)?.[1] ?? "";
  const inSwift = [...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const sorted = (a) => [...a].sort();
  assert.deepEqual(sorted(inPlist), sorted(OTHER_SCHEMES));
  assert.deepEqual(sorted(inSwift), sorted(OTHER_SCHEMES));
  assert.ok(!OTHER_SCHEMES.includes("cydian"));
});

test("Open Other Apps' Links: on by default, off is remembered", () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(otherLinksOn(st), true);
  setOtherLinks(false, st);
  assert.equal(otherLinksOn(st), false);
  setOtherLinks(true, st);
  assert.equal(otherLinksOn(st), true);
  assert.equal(otherLinksOn(null), true);
});
