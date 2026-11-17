import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListFile, parseDeb822File, parseAptSources, listFileName, listNamesFor } from "./aptsources.js";

test("one-line .list: deb only, options and comments skipped", () => {
  const text = "# comment\ndeb https://a.test/ ./\ndeb-src https://a.test/ ./\n"
    + "deb [arch=iphoneos-arm64 signed-by=/x.gpg] https://b.test/ stable main extra # trailing\n\nrubbish\n";
  assert.deepEqual(parseListFile(text), [
    { uri: "https://a.test/", dist: "./", components: [] },
    { uri: "https://b.test/", dist: "stable", components: ["main", "extra"] },
  ]);
});

test("deb822 .sources: URIs x Suites, Enabled: no and deb-src skipped, folded fields", () => {
  const text = "Types: deb deb-src\nURIs: https://a.test/ https://b.test/\nSuites: 1800\nComponents: main\n\n"
    + "# off\nTypes: deb\nURIs: https://off.test/\nSuites: ./\nEnabled: no\n\n"
    + "Types: deb-src\nURIs: https://src.test/\nSuites: ./\n\n"
    + "types: deb\nuris:\n https://flat.test/\nsuites: ./\ncomponents: main\n";
  assert.deepEqual(parseDeb822File(text), [
    { uri: "https://a.test/", dist: "1800", components: ["main"] },
    { uri: "https://b.test/", dist: "1800", components: ["main"] },
    { uri: "https://flat.test/", dist: "./", components: [] },
  ]);
});

test("parseAptSources: keys like core/sources.js, first file wins, only http(s)", () => {
  const files = [
    { path: "/var/jb/etc/apt/sources.list.d/a.list", text: "deb https://r.test ./\ndeb file:///local ./\n" },
    { path: "/var/jb/etc/apt/sources.list.d/b.sources", text: "Types: deb\nURIs: https://r.test/\nSuites: ./\n" },
  ];
  assert.deepEqual(parseAptSources(files), [
    { uri: "https://r.test/", dist: "./", components: [], file: "/var/jb/etc/apt/sources.list.d/a.list", key: "deb:https://r.test/:./" },
  ]);
});

test("listFileName is apt's URItoFileName", () => {
  assert.equal(listFileName("https://apt.procurs.us/dists/1800/main/binary-iphoneos-arm64/Packages"),
    "apt.procurs.us_dists_1800_main_binary-iphoneos-arm64_Packages");
  assert.equal(listFileName("http://user:pw@repo.test:8080/~me/a_b/Release"), "repo.test:8080_%7eme_a%5fb_Release");
  assert.deepEqual(listNamesFor("https://havoc.app/Packages"), ["havoc.app_._Packages", "havoc.app_Packages"]);
  assert.deepEqual(listNamesFor("https://r.test/dists/stable/Release"), ["r.test_dists_stable_Release"]);
});
