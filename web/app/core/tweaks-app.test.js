// F302a: the app side of tweaks, core/tweaks.js's words and rules: kept .deb names, counts, the install popup's line,
// one progress step per tweak, which source tweaks are made for an app, tweak updates, and the App Store's
// encryption read from an IPA's main executable without reading it whole.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { debOf, tweakTitle, tweakCountText, withTweaksText, tweakSteps, madeFor, tweakUpdates, machoEncrypted, ipaEncrypted,
  ENCRYPTED_ALERT, HOW_TO_GET_ONE } from "./tweaks.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/tweaks/${n}`, import.meta.url)));

// A 64-bit Mach-O header with one LC_ENCRYPTION_INFO_64 (cryptid as given) and padding after it.
function macho(cryptid, pad = 0) {
  const b = new Uint8Array(32 + 24 + pad);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0xfeedfacf, true);
  dv.setUint32(4, 0x0100000c, true);
  dv.setUint32(16, 1, true);
  dv.setUint32(20, 24, true);
  dv.setUint32(32, 0x2c, true);
  dv.setUint32(36, 24, true);
  dv.setUint32(40, 0x4000, true);
  dv.setUint32(44, 0x1000, true);
  dv.setUint32(48, cryptid, true);
  for (let i = 56; i < b.length; i++) b[i] = i % 251;
  return b;
}

// A zip (deflated entries, or stored with `store`) in the IPA's layout.
function zip(entries, { store = false } = {}) {
  const parts = [], dir = [];
  let at = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const body = store ? Buffer.from(data) : deflateRawSync(Buffer.from(data));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(at, 42);
    parts.push(local, n, body);
    dir.push(c, n);
    at += 30 + n.length + body.length;
  }
  const d = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(d.length, 12);
  end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([...parts, d, end]));
}

const plist = (exe) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.x.tube</string>`
  + `<key>CFBundleDisplayName</key><string>Tube</string><key>CFBundleExecutable</key><string>${exe}</string></dict></plist>`;

test("kept tweak names: the package and version back from addDebTo's file name, a title for people", () => {
  assert.deepEqual(debOf("com.me.ytlite_5.0-1.deb"), { package: "com.me.ytlite", version: "5.0-1" });
  assert.equal(debOf("Plain.dylib"), null);
  assert.equal(tweakTitle({ name: "com.me.ytlite_5.0.deb", title: "YTLite" }), "YTLite");
  assert.equal(tweakTitle({ name: "com.me.ytlite_5.0.deb" }), "ytlite");
  assert.equal(tweakTitle({ name: "Plain.dylib" }), "Plain");
  assert.equal(tweakTitle({ name: "FixtureUI.framework.zip" }), "FixtureUI");
});

test("counts and the install popup's line", () => {
  assert.equal(tweakCountText(1), "1 Tweak");
  assert.equal(tweakCountText(3), "3 Tweaks");
  assert.equal(withTweaksText([]), "");
  assert.equal(withTweaksText(["A"]), "with A");
  assert.equal(withTweaksText(["A", "B"]), "with A and B");
  assert.equal(withTweaksText(["A", "B", "C", "A"]), "with A, B and C");
});

test("progress: one step per tweak, then the bundled ElleKit", () => {
  assert.deepEqual(tweakSteps(null), []);
  assert.deepEqual(tweakSteps({ names: ["com.me.ytlite_5.0.deb", "Plain.dylib"], bundled: ["ElleKit 1.2"] }, ["YTLite", null]),
    ["Adding YTLite", "Adding Plain", "Adding ElleKit 1.2"]);
});

test("madeFor keeps the source tweaks whose checked filter names the app (or every app)", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const info = { a: { ok: true, bundles: ["com.x.tube"] }, b: { ok: true, anyApp: true, bundles: [] }, c: { ok: true, bundles: ["com.y"] }, d: null };
  assert.deepEqual(madeFor(rows, "com.X.Tube", (r) => info[r.id]).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(madeFor(rows, "", (r) => info[r.id]), []);
});

test("tweakUpdates: a kept .deb whose package a source has newer", () => {
  const kept = [{ name: "com.me.a_1.0.deb", title: "A" }, { name: "com.me.b_2.0.deb" }, { name: "Plain.dylib" }];
  const rows = [{ id: "com.me.a", version: "1.1", name: "A Tweak" }, { id: "com.me.a", version: "1.0~b" }, { id: "com.me.b", version: "2.0" }];
  const up = tweakUpdates(kept, rows);
  assert.equal(up.length, 1);
  assert.deepEqual({ ...up[0], row: undefined }, { package: "com.me.a", title: "A", from: "1.0", to: "1.1", row: undefined });
});

test("machoEncrypted reads cryptid off the first slice; a fixture app binary is not encrypted", () => {
  assert.equal(machoEncrypted(macho(1)), true);
  assert.equal(machoEncrypted(macho(0)), false);
  assert.equal(machoEncrypted(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(machoEncrypted(macho(1).subarray(0, 40)), null, "cut short before the command");
  assert.equal(machoEncrypted(fx("app.macho")), false);
});

test("ipaEncrypted: the main executable (CFBundleExecutable) of a deflated or stored IPA", async () => {
  const big = macho(1, 3 << 20); // only its head is inflated
  const r = await ipaEncrypted(zip([["Payload/Tube.app/Info.plist", plist("TubeBin")], ["Payload/Tube.app/TubeBin", big]]));
  assert.deepEqual(r, { encrypted: true, bundleId: "com.x.tube", name: "Tube" });
  const open = await ipaEncrypted(new Blob([zip([["Payload/Tube.app/Info.plist", plist("TubeBin")], ["Payload/Tube.app/TubeBin", macho(0, 100)]], { store: true })]));
  assert.equal(open.encrypted, false);
  assert.equal(await ipaEncrypted(new Uint8Array([1, 2, 3])), null);
  assert.equal(await ipaEncrypted(zip([["Payload/Tube.app/Info.plist", plist("Missing")]])), null);
});

test("the locked alert offers How to Get One", () => {
  const a = ENCRYPTED_ALERT("YouTube");
  assert.equal(a.title, "YouTube Is Locked");
  assert.deepEqual(a.buttons, [HOW_TO_GET_ONE, "OK"]);
});
