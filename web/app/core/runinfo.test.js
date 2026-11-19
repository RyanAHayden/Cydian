// F234: catalog.runInfo, what the queue run needs per package: the version's link, hashes, size and dependencies,
// and dpkg's versions of what those name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, runCatalog } from "./catalog.js";

const A = "deb:https://a.example/:./";
const PACKAGES = `Package: com.example.tweak
Name: Tweak
Version: 1.1
Architecture: iphoneos-arm64
Filename: debs/tweak_1.1.deb
Size: 4000000
SHA256: ${"b".repeat(64)}
Depends: com.example.lib (>= 2.0), mobilesubstrate
Pre-Depends: firmware (>= 14.0)

Package: com.example.tweak
Name: Tweak
Version: 1.0
Architecture: iphoneos-arm64
Filename: debs/tweak_1.0.deb
Size: 3000000
MD5sum: ${"c".repeat(32)}

Package: com.example.lib
Version: 2.0
Architecture: iphoneos-arm64
Filename: debs/lib_2.0.deb
`;
const STATUS = `Package: mobilesubstrate
Status: install ok installed
Version: 0.9.7

Package: firmware
Status: install ok installed
Version: 15.8
`;

test("runInfo: the asked version's stanza, and the installed versions of what it depends on", () => {
  const c = createCatalog();
  c.load(A, PACKAGES, "https://a.example/");
  c.setInstalled(STATUS);
  const info = runCatalog(c, "runInfo", [[{ id: "com.example.tweak", version: "1.1" }, { id: "com.example.lib", version: "2.0" }, { id: "nowhere" }]]);
  const t = info["com.example.tweak"];
  assert.equal(t.name, "Tweak");
  assert.equal(t.debUrl, "https://a.example/debs/tweak_1.1.deb");
  assert.equal(t.sha256, "b".repeat(64));
  assert.equal(t.size, 4000000);
  assert.match(t.depends, /com\.example\.lib \(>= 2\.0\)/);
  assert.match(t.preDepends, /firmware/);
  assert.equal(info["com.example.lib"].debUrl, "https://a.example/debs/lib_2.0.deb");
  assert.deepEqual(info.nowhere, { name: null });
  assert.deepEqual(info.installed, { mobilesubstrate: "0.9.7", firmware: "15.8" });
  const old = c.runInfo([{ id: "com.example.tweak", version: "1.0" }])["com.example.tweak"];
  assert.equal(old.debUrl, "https://a.example/debs/tweak_1.0.deb");
  assert.equal(old.md5sum, "c".repeat(32));
  assert.equal(old.sha256, null);
});
