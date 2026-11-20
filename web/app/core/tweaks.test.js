// F288: tweak injection's pure half: the archive readers (core/unpack.js) and the plan and Mach-O edits
// (core/tweaks.js), on fixtures from fixtures/tweaks/make.py (stdlib Python).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync, deflateRawSync, zstdCompressSync, constants as zlibConstants } from "node:zlib";
import { inflate, gunzip, unxz, unlzma, unzstd, bunzip2, readAr, readTar, readZip, decompress } from "./unpack.js";
import { prepareTweaks, injectInto, dylibsOf, loadCommands, idOf, slices, tweakParams, tweakProblem, unpackDeb, isMachO,
  LC, SUBSTRATE, RPATH, rewriteDylibs } from "./tweaks.js";

const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/tweaks/${name}`, import.meta.url)));
const text = (s) => new TextEncoder().encode(s);
const b64 = (u) => Buffer.from(u).toString("base64");
const file = (prep, path) => prep.files.find((f) => f.path === path)?.data;

test("inflate and gunzip read what zlib writes, stored and compressed blocks alike", () => {
  const data = new Uint8Array(200000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919) % 251 ^ (i >> 9);
  for (const level of [0, 1, 9]) {
    assert.deepEqual(inflate(new Uint8Array(deflateRawSync(data, { level }))), data, `level ${level}`);
    assert.deepEqual(gunzip(new Uint8Array(gzipSync(data, { level }))), data);
  }
  assert.deepEqual(gunzip(new Uint8Array(Buffer.concat([gzipSync(text("ab")), gzipSync(text("cd"))]))), text("abcd"), "gzip members in a row");
  assert.throws(() => gunzip(text("not gzip")), /isn't gzip/);
  assert.throws(() => inflate(new Uint8Array(deflateRawSync(data)), 1000), /too big/, "a bomb stops at the limit");
});

test("the .debs' archives: ar, then each compressed tar", () => {
  for (const [name, kind] of [["tweak-xz.deb", ".xz"], ["tweak-lzma.deb", ".lzma"], ["ellekit.deb", ".gz"],
    ["tweak-zst.deb", ".zst"], ["tweak-bz2.deb", ".bz2"]]) {
    const ar = readAr(fx(name));
    assert.deepEqual(ar.map((m) => m.name), ["debian-binary", "control.tar.gz", `data.tar${kind}`], name);
    const tar = readTar(decompress(ar[2].name, ar[2].data));
    assert.ok(tar.some((e) => e.type === "file" && e.path.endsWith(".dylib")), name);
  }
  const ellekit = readTar(gunzip(readAr(fx("ellekit.deb"))[2].data));
  assert.deepEqual(ellekit.find((e) => e.type === "symlink"), { path: "./var/jb/usr/lib/libsubstrate.dylib", type: "symlink",
    data: new Uint8Array(0), link: "libellekit.dylib" });
  assert.ok(ellekit.some((e) => e.type === "dir" && e.path === "./var/jb/usr/lib"));
  assert.throws(() => readAr(text("hello")), /no ar header/);
});

test("xz and lzma decoders round-trip the fixtures' payloads, and refuse damage", () => {
  const xz = readAr(fx("tweak-xz.deb"))[2].data;
  const tar = unxz(xz);
  assert.equal(tar.length % 512, 0);
  const bad = xz.slice(); bad[40] ^= 0xff;
  assert.throws(() => unxz(bad));
  assert.throws(() => unxz(text("not xz at all")), /isn't xz/);
  const lz = readAr(fx("tweak-lzma.deb"))[2].data;
  assert.equal(unlzma(lz).length % 512, 0);
  assert.throws(() => decompress("data.tar.zst", new Uint8Array(4)), /zstd/);
  assert.throws(() => decompress("data.tar.bz2", new Uint8Array(4)), /bzip2/);
});

// F294: the same text as make.py's payload(), to compare the decoders' output with.
const payload = () => {
  let s = "";
  for (let i = 0; i < 4000; i++) {
    s += `${String(i).padStart(5, "0")} ${"abcdefghij"[i % 10].repeat(i % 13)} tweak ${String(i * 7919 % 1000).padStart(3, "0")} `
      + `${i % 3 ? "Fixture" : "Other"}.dylib ${"=".repeat(i % 40)}\n`;
  }
  return text(s);
};

test("unzstd and bunzip2 read Python's zstd and bz2: frames and streams in a row, checksums, several blocks", () => {
  assert.deepEqual(unzstd(fx("payload.zst")), payload());
  assert.deepEqual(bunzip2(fx("payload.bz2")), payload());
  assert.deepEqual(decompress("data.tar.zstd", fx("payload.zst")), payload());
  assert.throws(() => unzstd(fx("payload.zst"), 1000), /too big/, "a bomb stops at the limit");
  assert.throws(() => bunzip2(fx("payload.bz2"), 1000), /too big/);
  assert.throws(() => unzstd(text("not zstd at all")), /isn't zstd/);
  assert.throws(() => bunzip2(text("not bzip2 at all")), /isn't bzip2/);
});

test("unzstd and bunzip2 refuse damage instead of returning garbage", () => {
  const bz = fx("payload.bz2");
  for (const at of [20, 200, 5000, bz.length - 12]) {
    const bad = bz.slice(); bad[at] ^= 0x55;
    assert.throws(() => bunzip2(bad), /bzip2/, `byte ${at}`);
  }
  assert.throws(() => bunzip2(bz.subarray(0, bz.length >> 1)), /ends too soon|damaged/);
  const zs = fx("payload.zst");
  assert.throws(() => unzstd(zs.subarray(0, zs.length >> 1)), /ends too soon|damaged/);
  // zstd has no checksum on every frame, so flip bytes in the first frame's block headers and literal headers: a
  // damaged header must throw; a flip inside entropy-coded data may decode wrong, but must not hang or overrun
  let thrown = 0;
  for (let at = 6; at < 400; at += 7) {
    const bad = zs.slice(); bad[at] ^= 0xa5;
    try { const out = unzstd(bad); assert.ok(out.length < 1 << 20); } catch (e) { assert.equal(e.name, "UnpackError", `byte ${at}: ${e.message}`); thrown++; }
  }
  assert.ok(thrown > 20, `${thrown} damaged copies refused`);
});

test("unzstd: raw, RLE and compressed blocks at every level node's zlib writes, when it has zstd", { skip: !zstdCompressSync && "node has no zstd" }, () => {
  const rnd = new Uint8Array(70000);
  let x = 1;
  for (let i = 0; i < rnd.length; i++) { x = (x * 1103515245 + 12345) >>> 0; rnd[i] = x >>> 24; }
  const p = payload();
  for (const data of [new Uint8Array(0), text("a"), new Uint8Array(300000).fill(9), rnd, p, new Uint8Array([...rnd.subarray(0, 9000), ...p, ...rnd.subarray(0, 9000)])]) {
    for (const level of [1, 3, 12, 19, 22]) {
      const z = new Uint8Array(zstdCompressSync(data, { params: { [zlibConstants.ZSTD_c_compressionLevel]: level, [zlibConstants.ZSTD_c_checksumFlag]: level & 1 } }));
      assert.deepEqual(unzstd(z), data, `${data.length} bytes, level ${level}`);
    }
  }
});

test("readZip: deflated entries, folders and the macOS litter", () => {
  const z = readZip(fx("FixtureUI.framework.zip"));
  assert.deepEqual(z.map((e) => e.path), ["FixtureUI.framework/FixtureUI", "FixtureUI.framework/Info.plist", "__MACOSX/FixtureUI.framework/._FixtureUI"]);
  assert.ok(isMachO(z[0].data));
  assert.deepEqual(z[1].data, text("<plist/>"));
});

test("unpackDeb sorts a rootless tweak into the app and names the package", () => {
  const d = unpackDeb(fx("tweak-xz.deb"), "fixture.deb");
  assert.equal(d.pkg, "Fixture Tweak");
  assert.deepEqual(d.files.map((f) => [f.path, f.inject]), [
    ["Frameworks/Fixture.dylib", true],
    ["Fixture.bundle/Info.plist", false],
  ]);
  assert.deepEqual(d.ignored, ["Library/PreferenceLoader/Preferences"]);
});

test("unpackDeb: zstd and bzip2 .debs unpack like the others", () => {
  assert.deepEqual(unpackDeb(fx("tweak-zst.deb"), "z.deb").files.map((f) => [f.path, f.inject]), [["Frameworks/Z.dylib", true]]);
  const b = unpackDeb(fx("tweak-bz2.deb"), "b.deb");
  assert.deepEqual(b.files.map((f) => [f.path, f.inject]), [["Frameworks/B.dylib", true], ["Frameworks/libFixtureKit.dylib", false]]);
  assert.deepEqual(b.files[0].data, fx("Plain.dylib"));
  assert.deepEqual(prepareTweaks([{ name: "z.deb", data: fx("tweak-zst.deb") }, { name: "b.deb", data: fx("tweak-bz2.deb") }]).inject,
    ["@rpath/Z.dylib", "@rpath/B.dylib"]);
});

test("prepareTweaks: a tweak that links CydiaSubstrate without ElleKit is refused, with what to add", () => {
  const p = prepareTweaks([{ name: "fixture.deb", data: fx("tweak-xz.deb") }]);
  assert.deepEqual(p.missing, ["CydiaSubstrate"]);
  assert.match(tweakProblem(p), /fixture\.deb needs CydiaSubstrate.*ElleKit/);
  assert.equal(tweakProblem(prepareTweaks([{ name: "Plain.dylib", data: fx("Plain.dylib") }])), null);
});

test("prepareTweaks: with ElleKit, every load command between them points at @rpath, fat slices too", () => {
  const p = prepareTweaks([
    { name: "fixture.deb", data: fx("tweak-xz.deb") },
    { name: "other.deb", data: fx("tweak-lzma.deb") },
    { name: "ellekit.deb", data: fx("ellekit.deb") },
  ]);
  assert.deepEqual(p.missing, []);
  assert.equal(tweakProblem(p), null);
  assert.deepEqual(p.names, ["fixture.deb", "other.deb", "ellekit.deb"]);
  assert.deepEqual(p.files.map((f) => f.path).sort(), [
    "Fixture.bundle/Info.plist",
    "Frameworks/CydiaSubstrate.framework/CydiaSubstrate",
    "Frameworks/CydiaSubstrate.framework/Info.plist",
    "Frameworks/Fixture.dylib",
    "Frameworks/Other.dylib",
    "Frameworks/libFixtureKit.dylib",
    "Frameworks/libellekit.dylib",
  ], "the symlink stays out");
  // only the tweaks are injected, never ElleKit or what they link
  assert.deepEqual(p.inject, ["@rpath/Fixture.dylib", "@rpath/Other.dylib"]);
  const fixture = file(p, "Frameworks/Fixture.dylib");
  assert.equal(slices(fixture).length, 2);
  for (const [off] of slices(fixture)) {
    const names = loadCommands(fixture.subarray(off)).filter((c) => c.name).map((c) => c.name);
    assert.deepEqual(names, ["@rpath/Fixture.dylib", "/usr/lib/libSystem.B.dylib", SUBSTRATE]);
  }
  assert.deepEqual(dylibsOf(file(p, "Frameworks/Other.dylib")), [SUBSTRATE, "@rpath/libFixtureKit.dylib"]);
  assert.equal(idOf(file(p, "Frameworks/libFixtureKit.dylib")), "@rpath/libFixtureKit.dylib");
  const cs = file(p, "Frameworks/CydiaSubstrate.framework/CydiaSubstrate");
  assert.equal(idOf(cs), SUBSTRATE);
  assert.deepEqual(dylibsOf(cs), ["@rpath/libellekit.dylib"], "ElleKit's re-export follows it in");
  assert.equal(idOf(file(p, "Frameworks/libellekit.dylib")), "@rpath/libellekit.dylib");
});

test("prepareTweaks: libellekit.dylib alone stands in for CydiaSubstrate", () => {
  // ElleKit's .deb without its framework: substrate links go to libellekit
  const ar = readAr(fx("ellekit.deb"));
  const tar = readTar(gunzip(ar[2].data)).filter((e) => !e.path.includes("CydiaSubstrate.framework"));
  const lib = tar.find((e) => e.path.endsWith("libellekit.dylib"));
  const p = prepareTweaks([{ name: "Other.deb", data: fx("tweak-lzma.deb") }, { name: "libellekit.dylib", data: lib.data }]);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(dylibsOf(file(p, "Frameworks/Other.dylib")), ["@rpath/libellekit.dylib", "@rpath/libFixtureKit.dylib"]);
  // a loose dylib the user adds is injected: libellekit too, harmless (it hooks nothing by itself)
  assert.deepEqual(p.inject, ["@rpath/Other.dylib", "@rpath/libellekit.dylib"]);
});

test("prepareTweaks: a zipped .framework is injected by its executable; a plain .dylib as it is", () => {
  const p = prepareTweaks([{ name: "FixtureUI.framework.zip", data: fx("FixtureUI.framework.zip") }, { name: "Plain.dylib", data: fx("Plain.dylib") }]);
  assert.deepEqual(p.files.map((f) => f.path), ["Frameworks/FixtureUI.framework/FixtureUI", "Frameworks/FixtureUI.framework/Info.plist", "Frameworks/Plain.dylib"]);
  assert.deepEqual(p.inject, ["@rpath/FixtureUI.framework/FixtureUI", "@rpath/Plain.dylib"]);
  assert.throws(() => prepareTweaks([{ name: "notes.txt", data: text("hi") }]), /add a \.dylib/);
  assert.throws(() => prepareTweaks([{ name: "fake.dylib", data: text("not a binary") }]), /isn't a dylib/);
});

test("tweakParams: base64 for the app's bridge; nothing when there are no tweaks", () => {
  const p = prepareTweaks([{ name: "Plain.dylib", data: fx("Plain.dylib") }]);
  const j = tweakParams(p, b64);
  assert.deepEqual(j.inject, ["@rpath/Plain.dylib"]);
  assert.deepEqual(j.names, ["Plain.dylib"]);
  assert.equal(j.files[0].path, "Frameworks/Plain.dylib");
  assert.deepEqual(new Uint8Array(Buffer.from(j.files[0].data, "base64")), file(p, "Frameworks/Plain.dylib"));
  assert.equal(tweakParams(prepareTweaks([]), b64), null);
});

test("injectInto: weak load commands and the Frameworks rpath after the last command; nothing twice", () => {
  const app = fx("app.macho");
  const before = loadCommands(app);
  const out = injectInto(app, ["@rpath/Fixture.dylib", "@rpath/FixtureUI.framework/FixtureUI"]);
  assert.equal(out.length, app.length, "the file keeps its size: the commands go in the header's room");
  const after = loadCommands(out);
  assert.equal(after.length, before.length + 3);
  assert.deepEqual(after.slice(before.length).map((c) => [c.cmd, c.name]), [
    [LC.RPATH, RPATH],
    [LC.LOAD_WEAK_DYLIB, "@rpath/Fixture.dylib"],
    [LC.LOAD_WEAK_DYLIB, "@rpath/FixtureUI.framework/FixtureUI"],
  ]);
  for (const c of after) assert.equal(c.size % 8, 0);
  const dv = new DataView(out.buffer);
  assert.equal(dv.getUint32(16, true), after.length, "ncmds");
  assert.equal(dv.getUint32(20, true), after.reduce((n, c) => n + c.size, 0), "sizeofcmds");
  assert.deepEqual(out.subarray(0x4000), app.subarray(0x4000), "code untouched");
  // again: already there, so the same bytes
  assert.deepEqual(injectInto(out, ["@rpath/Fixture.dylib"]), out);
  // an app that has the rpath gets only the load command
  const r = loadCommands(injectInto(fx("app-rpath.macho"), ["@rpath/Fixture.dylib"]));
  assert.equal(r.filter((c) => c.cmd === LC.RPATH).length, 1);
  assert.equal(injectInto(app, []), app);
});

test("injectInto: every slice of a fat binary; a binary with no room says so", () => {
  const fat = file(prepareTweaks([{ name: "f.deb", data: fx("tweak-xz.deb") }, { name: "e.deb", data: fx("ellekit.deb") }]), "Frameworks/Fixture.dylib");
  const out = injectInto(fat, ["@rpath/X.dylib"]);
  for (const [off] of slices(out)) assert.ok(loadCommands(out.subarray(off)).some((c) => c.cmd === LC.LOAD_WEAK_DYLIB && c.name === "@rpath/X.dylib"));
  assert.throws(() => injectInto(fx("app-full.macho"), ["@rpath/Fixture.dylib"]), /no room/);
});

test("rewriteDylibs: a longer path moves the commands after it; a map that changes nothing changes nothing", () => {
  const app = fx("app.macho");
  const long = "/a/very/long/path/to/some/library/that/makes/the/command/grow/a/lot/libSystem.B.dylib";
  const out = rewriteDylibs(app, (p) => (p === "/usr/lib/libSystem.B.dylib" ? long : null));
  assert.deepEqual(dylibsOf(out), [long]);
  assert.deepEqual(rewriteDylibs(app, () => null), app);
});

// B193: the library-description check walks words instead of using a lookbehind (iOS 15 has none).
test("library descriptions: the word before library/framework decides", async () => {
  const { isLibraryStanza } = await import("./tweaks.js");
  const lib = (description) => isLibraryStanza({ section: "Tweaks", description });
  for (const d of ["A SwiftUI Prefs Framework", "library for Foxfort tweaks", "  The color picker support library",
    "an a b c d e library", "app library framework", "webapp library"]) assert.equal(lib(d), true, d);
  for (const d of ["Moves the app library", "A photo library button", "my library", "x b c d e f library",
    "an a b c d e f library", "web-app library", "librarything", ""]) assert.equal(lib(d), false, d);
});
