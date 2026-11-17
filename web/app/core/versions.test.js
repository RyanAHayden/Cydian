// F29: Version History, from APT Packages fixtures (several versions in one source, the same version in two) and
// from an AltStore source's versions[] (fixtures/versions/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalog, aptVersionList, altVersionList, runCatalog } from "./catalog.js";
import { parseAltSource } from "./altstore.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/versions/${name}`, import.meta.url), "utf8");
const A = "deb:https://a.example/:./";
const B = "deb:https://b.example/:./";
const ALT = "alt:https://alt.example/apps.json";

function apt() {
  const c = createCatalog();
  c.load(A, fixture("repo-a-Packages"), "https://a.example/");
  c.load(B, fixture("repo-b-Packages"), "https://b.example/");
  return c;
}

test("APT: every version the sources offer, newest first, merged by version", () => {
  const h = apt().history("com.example.flip");
  assert.equal(h.kind, "apt");
  assert.equal(h.name, "Flip");
  // 1.0.9 is a rootful build: not this architecture, so not offered. ~rc sorts before the release.
  assert.deepEqual(h.versions.map((v) => v.version), ["1.0.16", "1.0.16~rc3", "1.0.16~rc2", "1.0.15"]);
  const [cur, rc3, rc2, old] = h.versions;
  assert.equal(cur.candidate, true);
  assert.deepEqual(cur.keys, [A]);
  assert.equal(cur.size, 2465792);
  assert.equal(cur.debUrl, "https://a.example/debs/flip_1.0.16.deb");
  assert.deepEqual(rc3.keys, [A, B], "the same version in two sources is one entry");
  assert.equal(rc3.candidate, false);
  assert.equal(rc2.debUrl, "https://a.example/debs/flip_1.0.16~rc2.deb");
  assert.deepEqual(old.keys, [B]);
  assert.equal(old.debUrl, "https://b.example/pool/flip-1.0.15.deb");
  assert.ok(h.versions.every((v) => !v.installed));
});

test("APT: a source's page gets every source's versions; the candidate mark is that source's newest", () => {
  const c = apt();
  // The candidate is still the newest anywhere; history merges every source (Cydia's Downgrade does too).
  assert.equal(c.package("com.example.flip", A).stanza.version, "1.0.16");
  assert.equal(c.history("com.example.flip", B).versions[0].version, "1.0.16");
  assert.equal(c.history("com.example.flip", B).versions.find((v) => v.candidate).version, "1.0.16~rc3",
    "on B's page the candidate is B's newest");
});

test("APT: the installed version is marked, and listed even when no source offers it any more", () => {
  const c = apt();
  c.setInstalled("Package: com.example.flip\nStatus: install ok installed\nVersion: 1.0.16~rc2\nName: Flip\n\n"
    + "Package: com.example.gone\nStatus: install ok installed\nVersion: 0.9\nName: Gone\n");
  const h = c.history("com.example.flip");
  assert.deepEqual(h.versions.filter((v) => v.installed).map((v) => v.version), ["1.0.16~rc2"]);
  c.setInstalled("Package: com.example.flip\nStatus: install ok installed\nVersion: 1.0.1\nName: Flip\n");
  const h2 = c.history("com.example.flip");
  assert.deepEqual(h2.versions.at(-1), { version: "1.0.1", keys: [], size: null, debUrl: null, filename: null, candidate: false, installed: true });
  assert.equal(c.history("com.example.nothing"), null);
});

test("APT: a package with one version, and an installed-only package", () => {
  const c = apt();
  assert.deepEqual(c.history("com.example.single").versions.map((v) => [v.version, v.candidate]), [["2", true]]);
  c.setInstalled("Package: com.example.gone\nStatus: install ok installed\nVersion: 0.9\nName: Gone\n");
  assert.deepEqual(c.history("com.example.gone"), { kind: "apt", id: "com.example.gone", name: "Gone",
    versions: [{ version: "0.9", keys: [], size: null, debUrl: null, filename: null, candidate: false, installed: true }] });
});

test("aptVersionList: dedupes, sorts by Debian version order, skips stanzas with no version", () => {
  const list = aptVersionList([
    { key: "x", stanza: { version: "1:0.1" } }, { key: "x", stanza: { version: "2.0" } },
    { key: "y", stanza: { version: "2.0", debUrl: "https://y/2.deb" } }, { key: "x", stanza: {} },
  ], { candidate: "1:0.1" });
  assert.deepEqual(list.map((v) => [v.version, v.keys, v.candidate]), [["1:0.1", ["x"], true], ["2.0", ["x", "y"], false]]);
  assert.equal(list[1].debUrl, "https://y/2.deb", "the first source with a .deb gives it");
});

test("AltStore: every versions[] entry, with date, size, notes, whether it runs and whether it installs", () => {
  const c = createCatalog();
  assert.equal(c.loadAlt(ALT, fixture("altstore-history.json"), "17.2"), 1);
  const h = c.history("dev.example.tracker", ALT);
  assert.equal(h.kind, "ipa");
  assert.equal(h.sourceUrl, "https://alt.example/apps.json");
  assert.deepEqual(h.versions.map((v) => [v.version, v.runs, v.candidate, v.installable]), [
    ["3.0", false, false, true], // needs iOS 18
    ["2.1", true, true, true],   // the newest that runs: the page's version
    ["2.0", true, false, false], // no downloadURL: listed, not installable
    ["1.0", false, false, true], // iOS 16 or earlier
  ]);
  const v21 = h.versions[1];
  assert.equal(new Date(v21.date).toISOString().slice(0, 10), "2026-09-15");
  assert.equal(v21.size, 28000000);
  assert.equal(v21.localizedDescription, "Bug fixes.");
  assert.equal(v21.downloadURL, "https://example.dev/tracker-2.1.ipa");
  // The package page still shows only what runs (core/altstore.js appStanza); the history keeps them all.
  assert.deepEqual(c.package("dev.example.tracker", ALT).stanza.ipa.versions.map((v) => v.version), ["2.1", "2.0"]);
});

test("AltStore: with no iOS known every version runs; the shared fixture's 1.x app has one version", () => {
  const app = parseAltSource(fixture("altstore-history.json")).apps[0];
  assert.deepEqual(altVersionList(app).map((v) => [v.version, v.runs, v.candidate]), [["3.0", true, true], ["2.1", true, false], ["2.0", true, false], ["1.0", true, false]]);
  const shared = parseAltSource(readFileSync(new URL("./fixtures/altstore-source.json", import.meta.url), "utf8"));
  const legacy = shared.apps.find((a) => a.bundleIdentifier === "dev.example.legacy");
  assert.deepEqual(altVersionList(legacy).map((v) => v.version), ["3.1"]);
  assert.deepEqual(altVersionList(null), []);
});

test("history is a worker op", () => {
  const c = apt();
  assert.equal(runCatalog(c, "history", ["com.example.single"]).versions.length, 1);
});
