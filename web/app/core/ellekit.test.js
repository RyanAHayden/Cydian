// The bundled ElleKit for tweak injection: the pinned file is the one ELLEKIT names, and a tweak that links
// CydiaSubstrate gets its libellekit.dylib instead of being refused.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { ELLEKIT, checkElleKit, withElleKit, needsElleKit, prepareTweaks, tweakProblem, dylibsOf, idOf, loadCommands, LC } from "./tweaks.js";
import { sha256Hex } from "./sha256.js";

const app = new URL("../", import.meta.url);
const deb = () => new Uint8Array(readFileSync(new URL(ELLEKIT.file, app)));
const fx = (n) => new Uint8Array(readFileSync(new URL(`fixtures/tweaks/${n}`, import.meta.url)));
const file = (p, path) => p.files.find((f) => f.path === path);

test("sha256Hex matches node's for every padding edge", () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 70001]) {
    const b = randomBytes(n);
    assert.equal(sha256Hex(new Uint8Array(b)), createHash("sha256").update(b).digest("hex"), `${n} bytes`);
  }
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the vendored ElleKit is the pinned file: size, SHA-256, source, licence next to it", () => {
  const b = deb();
  assert.equal(b.length, ELLEKIT.size);
  assert.equal(createHash("sha256").update(b).digest("hex"), ELLEKIT.sha256);
  assert.equal(checkElleKit(b), b);
  assert.match(ELLEKIT.source, /^https:\/\/ellekit\.space\/pool\/ellekit_1\.2_iphoneos-arm64\.deb$/);
  assert.ok(ELLEKIT.source.endsWith(ELLEKIT.file.split("/").pop()));
  const lic = readFileSync(new URL("vendor/ellekit/LICENSE", app), "utf8");
  assert.match(lic, /Redistributions in binary form must reproduce/);
  const readme = readFileSync(new URL("vendor/ellekit/README.md", app), "utf8");
  for (const s of [ELLEKIT.sha256, ELLEKIT.source, String(ELLEKIT.size), "BSD-3-Clause"]) assert.ok(readme.includes(s), s);
});

test("checkElleKit refuses any other bytes, with words", () => {
  const b = deb().slice();
  b[1000] ^= 1;
  assert.throws(() => checkElleKit(b), /bundled ElleKit isn't the expected file/);
  assert.throws(() => checkElleKit(b.subarray(1)), /isn't the expected file/);
  assert.throws(() => checkElleKit(null), /isn't the expected file/);
});

test("withElleKit: a tweak that links CydiaSubstrate gets the bundled libellekit.dylib, pointed at by @rpath", () => {
  const items = [{ name: "fixture.deb", data: fx("tweak-xz.deb") }];
  assert.ok(needsElleKit(prepareTweaks(items)));
  const p = withElleKit(items, checkElleKit(deb()));
  assert.equal(tweakProblem(p), null);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.bundled, ["ElleKit 1.2"]);
  assert.deepEqual(p.names, ["fixture.deb"]); // the user's only
  assert.deepEqual(p.inject, ["@rpath/Fixture.dylib"]); // ElleKit itself isn't injected
  assert.ok(!p.ignored.some((s) => /ellekit/i.test(s)), p.ignored.join());
  // only libellekit.dylib comes from the package (no loader, pspawn or MobileSafety)
  assert.deepEqual(p.files.filter((f) => /ellekit/i.test(f.path)).map((f) => f.path), ["Frameworks/libellekit.dylib"]);
  const ek = file(p, "Frameworks/libellekit.dylib").data;
  assert.equal(idOf(ek), "@rpath/libellekit.dylib");
  assert.ok(loadCommands(ek).some((c) => c.cmd === LC.RPATH && c.name === "/usr/lib/swift")); // its Swift runtime
  assert.ok(dylibsOf(file(p, "Frameworks/Fixture.dylib").data).includes("@rpath/libellekit.dylib"));
});

test("withElleKit: nothing is added when no tweak needs it, when the user's own ElleKit is there, or without the file", () => {
  const plain = withElleKit([{ name: "Plain.dylib", data: fx("Plain.dylib") }], checkElleKit(deb()));
  assert.deepEqual(plain.bundled, []);
  assert.ok(!plain.files.some((f) => /ellekit/.test(f.path)));
  const own = withElleKit([{ name: "fixture.deb", data: fx("tweak-xz.deb") }, { name: "ellekit.deb", data: fx("ellekit.deb") }], checkElleKit(deb()));
  assert.deepEqual(own.bundled, []);
  assert.equal(file(own, "Frameworks/libellekit.dylib").data.length < 100000, true); // the fixture's (tiny), not the bundled 760 KB one
  const none = withElleKit([{ name: "fixture.deb", data: fx("tweak-xz.deb") }], null);
  assert.deepEqual(none.missing, ["CydiaSubstrate"]);
  assert.match(tweakProblem(none), /needs CydiaSubstrate/);
});
