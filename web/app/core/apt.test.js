import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseControl, description, parseRelations, stripClearsign, parseRelease, repoLayout, parseSourceLine,
  resolveFilename, resolveIcon, isLocalUrl, parsePackages, parseVersion, compareVersions, satisfies,
  matchesArch, filterArch, DEFAULT_ARCH, ARCHES,
} from "./apt.js";
import { handle, reply } from "./worker.js";
import { createParser } from "./parser.js";

const fixture = (name) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const byName = (list) => Object.fromEntries(list.map((p) => [p.package, p]));

// ---- control stanzas ----

test("dist Packages fixture: every stanza, fields, multi-line Description", () => {
  const st = parseControl(fixture("dist-Packages"));
  assert.equal(st.length, 9);
  const p = byName(st);
  assert.equal(p["3proxy"].version, "0.5.3k-2p");
  assert.equal(p["3proxy"]["installed-size"], "1208");
  assert.equal(p["adv-cmds"]["pre-depends"], "dpkg (>= 1.14.25-8)");
  const gdb = description(p.gdb);
  assert.equal(gdb.short, "debugger for native software");
  assert.equal(gdb.long, "A debugger for native software from GNU. This is Apple's Open Source\n"
    + "GDB that targets ARM. It still has some limitations, but they are being\nworked on.");
  assert.equal(description(p.mobileterminal).long.split("\n").length, 6);
  assert.equal(p.gdb.depiction, "https://cydia.saurik.com/info/gdb/"); // the field after a continuation
  assert.deepEqual(description(p.apt), { short: "any advanced packaging tool from Debian", long: "" });
});

test("flat Packages fixture: lower-case field names, extra-indented continuation, paragraph break", () => {
  const p = byName(parseControl(fixture("flat-Packages")));
  assert.equal(Object.keys(p).length, 9);
  assert.equal(p.backgrounder.homepage, "http://iphone-backgrounder.googlecode.com/"); // shipped as `homepage:`
  assert.ok(description(p["co.cocoanuts.gremlinplugins"]).long.startsWith("  This plugin pack contains"));
  assert.equal(description(p["com.aa.wifipojiedashi"]).short, "一个查看wifi密码小工具。自己连上某个wifi");
  assert.deepEqual(description(p["org.example.flat"]), {
    short: "synthetic stanza for flat-repo paths",
    long: "First paragraph of the long description,\nwrapped over two lines.\n\n verbatim line (two spaces)",
  });
});

test("control edge cases: CRLF, BOM, blank lines with spaces, comments, duplicates, no trailing newline", () => {
  const text = "﻿Package: a\r\nVersion: 1\r\nDescription: x\r\n more\r\n  \r\n\n\n# comment\nPackage: b\n"
    + "Version: 2\nversion: 3\n continued-dup\nKey:no-space\nbad line\n Orphan: continuation\nTab:\tv\n\tnext";
  const st = parseControl(text);
  assert.equal(st.length, 2);
  assert.deepEqual(st[0], { package: "a", version: "1", description: "x\nmore" });
  assert.deepEqual(st[1], { package: "b", version: "2", key: "no-space", tab: "v\nnext" });
  assert.deepEqual(parseControl(""), []);
  assert.deepEqual(parseControl("\n\n \n"), []);
});

test("relations", () => {
  assert.deepEqual(parseRelations("mobilesubstrate, libactivator (>= 1.3.1), firmware (<< 4.0) | libstatusbar"), [
    [{ name: "mobilesubstrate" }],
    [{ name: "libactivator", op: ">=", version: "1.3.1" }],
    [{ name: "firmware", op: "<<", version: "4.0" }, { name: "libstatusbar" }],
  ]);
  assert.deepEqual(parseRelations("python3:any (>=3.9) [amd64]"), [[{ name: "python3", arch: "any", op: ">=", version: "3.9" }]]);
  assert.deepEqual(parseRelations("a,, b"), [[{ name: "a" }], [{ name: "b" }]]);
  assert.deepEqual(parseRelations(undefined), []);
});

// ---- Release ----

test("Release fixture fields and hash lists", () => {
  const r = parseRelease(fixture("dist-Release"));
  assert.equal(r.origin, "Cydia/Telesphoreo");
  assert.equal(r.label, "Cydia/Telesphoreo");
  assert.equal(r.suite, "stable");
  assert.equal(r.codename, "ios");
  assert.equal(r.version, "1.0r282");
  assert.equal(r.description, "Distribution of Unix Software for iOS");
  assert.equal(r.fields.support, "https://cydia.saurik.com/api/support/*");
  assert.deepEqual(r.architectures, ["darwin-arm", "iphoneos-arm"]);
  assert.deepEqual(r.components, ["main"]);
  assert.equal(r.hashes.md5sum.length, 4);
  assert.deepEqual(r.hashes.md5sum[3], { hash: "b77b80d3f47650ab67d4d384a8868668", size: 174237, path: "main/binary-iphoneos-arm/Packages" });
});

test("InRelease: clear-signature stripped, dash-escaping undone", () => {
  const signed = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nOrigin: Example\n- -dashed: no\nSHA256:\n"
    + " abc 12 main/binary-iphoneos-arm/Packages\n-----BEGIN PGP SIGNATURE-----\n\nxyz\n-----END PGP SIGNATURE-----\n";
  assert.equal(stripClearsign(signed), "Origin: Example\n-dashed: no\nSHA256:\n abc 12 main/binary-iphoneos-arm/Packages");
  const r = parseRelease(signed);
  assert.equal(r.origin, "Example");
  assert.deepEqual(r.hashes.sha256, [{ hash: "abc", size: 12, path: "main/binary-iphoneos-arm/Packages" }]);
  assert.equal(stripClearsign("Origin: x\n"), "Origin: x\n");
  assert.deepEqual(parseRelease("").architectures, []);
});

// ---- URLs ----

test("repo layout: flat and dist", () => {
  assert.deepEqual(repoLayout("deb https://repo.example/cydia ./"), {
    flat: true, root: "https://repo.example/cydia/", base: "https://repo.example/cydia/",
    release: "https://repo.example/cydia/Release", inRelease: "https://repo.example/cydia/InRelease",
    packages: ["https://repo.example/cydia/Packages"],
  });
  assert.equal(repoLayout({ uri: "https://repo.example/" }).release, "https://repo.example/Release");
  const d = repoLayout("deb http://apt.saurik.com/ ios/793.00 main", "iphoneos-arm");
  assert.equal(d.flat, false);
  assert.equal(d.root, "http://apt.saurik.com/");
  assert.equal(d.release, "http://apt.saurik.com/dists/ios/793.00/Release");
  assert.deepEqual(d.packages, ["http://apt.saurik.com/dists/ios/793.00/main/binary-iphoneos-arm/Packages"]);
  assert.deepEqual(repoLayout("deb https://r.example/x stable main extra").packages, [ // rootless by default
    "https://r.example/x/dists/stable/main/binary-iphoneos-arm64/Packages",
    "https://r.example/x/dists/stable/extra/binary-iphoneos-arm64/Packages",
  ]);
  assert.equal(repoLayout("deb https://r.example/ sub/").release, "https://r.example/sub/Release");
  assert.deepEqual(parseSourceLine("deb [arch=iphoneos-arm] https://r.example/ ./ # c"),
    { type: "deb", uri: "https://r.example/", dist: "./", components: [] });
  assert.throws(() => repoLayout({}));
});

test("Filename resolves against the repo root", () => {
  const root = "http://apt.saurik.com/";
  assert.equal(resolveFilename(root, "debs/apt_1:0-23_iphoneos-arm.deb"), "http://apt.saurik.com/debs/apt_1:0-23_iphoneos-arm.deb");
  assert.equal(resolveFilename(root, "apt_1:0.deb"), "http://apt.saurik.com/apt_1:0.deb");
  assert.equal(resolveFilename("https://r.example/repo/", "./debs/x y#1?.deb"), "https://r.example/repo/debs/x%20y%231%3F.deb");
  assert.equal(resolveFilename("https://r.example/repo/", "/abs/x.deb"), "https://r.example/abs/x.deb");
  assert.equal(resolveFilename(root, "https://cdn.example/x.deb"), "https://cdn.example/x.deb");
  assert.equal(resolveFilename(root, ""), null);
});

test("Icon: remote kept, device paths normalised to file:///, relative against the repo", () => {
  const root = "https://r.example/repo/";
  const cases = [
    ["http://i.imgur.com/tvLxnB5.png", "http://i.imgur.com/tvLxnB5.png"],
    ["file:///Applications/Eraser.app/Icon-60.png", "file:///Applications/Eraser.app/Icon-60.png"],
    ["files:///Applications/My Battery.app/AppIcon29x29@2x.png", "file:///Applications/My%20Battery.app/AppIcon29x29@2x.png"],
    ["file::///Library/PreferenceBundles/SilquaPrefs.bundle/icon@2x.png", "file:///Library/PreferenceBundles/SilquaPrefs.bundle/icon@2x.png"],
    ["file://Applications/WifiPoJieDaShi.app/icon.png", "file:///Applications/WifiPoJieDaShi.app/icon.png"],
    ["/Applications/Copy9.app/Icon.png", "file:///Applications/Copy9.app/Icon.png"],
    ["icons/flat.png", "https://r.example/repo/icons/flat.png"],
  ];
  for (const [icon, want] of cases) assert.equal(resolveIcon(root, icon), want, icon);
  assert.equal(resolveIcon(root, ""), null);
  assert.equal(resolveIcon(root, undefined), null);
  assert.ok(isLocalUrl(resolveIcon(root, "/x.png")));
  assert.ok(!isLocalUrl(resolveIcon(root, "x.png")));
});

test("parsePackages adds debUrl and iconUrl from the fixtures", () => {
  const dist = byName(parsePackages(fixture("dist-Packages"), repoLayout("deb http://apt.saurik.com/ ios/793.00 main").root));
  assert.equal(dist.gdb.debUrl, "http://apt.saurik.com/debs/gdb_1518-12_iphoneos-arm.deb");
  assert.equal(dist.gdb.iconUrl, null);
  assert.equal(dist["com.saurik.impactor"].iconUrl, "file:///Applications/Eraser.app/Icon-60.png");
  const flat = byName(parsePackages(fixture("flat-Packages"), repoLayout("deb https://r.example/repo/ ./").root));
  assert.equal(flat["org.example.flat"].debUrl, "https://r.example/repo/debs/org.example.flat_1.0~beta1-3_iphoneos-arm.deb");
  assert.equal(flat["org.example.flat"].iconUrl, "https://r.example/repo/icons/flat.png");
  assert.equal(flat["com.alexzielenski.zeppelin"].iconUrl, "http://i.imgur.com/tvLxnB5.png");
  assert.equal(flat.libspeex.debUrl, "https://r.example/repo/debs2.0/libspeex_1.2~rc1.deb");
  assert.deepEqual(parsePackages("Version: 1\n\nPackage: x\n", null), [{ package: "x", debUrl: null, iconUrl: null }]);
});

// ---- versions ----

test("parseVersion splits epoch, upstream, revision", () => {
  assert.deepEqual(parseVersion("1:0-23"), { epoch: 1, upstream: "0", revision: "23" });
  assert.deepEqual(parseVersion("2:1.0~beta1-3"), { epoch: 2, upstream: "1.0~beta1", revision: "3" });
  assert.deepEqual(parseVersion("1.0-beta-1"), { epoch: 0, upstream: "1.0-beta", revision: "1" });
  assert.deepEqual(parseVersion("3~EarlyAccess4"), { epoch: 0, upstream: "3~EarlyAccess4", revision: "" });
  assert.deepEqual(parseVersion("1:2:3"), { epoch: 1, upstream: "2:3", revision: "" });
});

// Debian policy 5.6.12 (Version): epoch compared numerically and absent = 0; upstream and revision compared by
// alternating non-digit parts (letters before non-letters, "~" before anything, even the end) and digit parts
// (numerically); absent revision = "0". Policy's own example: ~~ < ~~a < ~ < (empty) < a. [a, b, a vs b]
const TABLE = [
  // policy's ~ example, as upstream suffixes
  ["1.0~~", "1.0~~a", -1], ["1.0~~a", "1.0~", -1], ["1.0~", "1.0", -1], ["1.0", "1.0a", -1],
  ["1.0~rc1", "1.0", -1], ["1.0~rc1", "1.0~rc2", -1], ["1.0~beta", "1.0~beta1", -1], ["3~EarlyAccess4", "3", -1],
  ["1.2~rc1", "1.2", -1], ["1.2.3~rc1-1", "1.2.3-1", -1], ["1.0-1~bpo1", "1.0-1", -1],
  // epochs
  ["1:0.1", "2.0", 1], ["0:1.0", "1.0", 0], ["1:1.0", "1.0", 1], ["2:1.0~beta1-3", "1:9", 1], ["10:1", "9:1", 1],
  ["1:0-23", "0-24", 1],
  // revisions
  ["1.0", "1.0-0", 0], ["1.0-1", "1.0-2", -1], ["1.0-1", "1.0.1-1", -1], ["1.0-2", "1.0-10", -1],
  ["1.0-beta-1", "1.0-beta-2", -1], ["1.0-1", "1.0", 1], ["1.0-0.1", "1.0-0", 1],
  // numbers compare as numbers
  ["1.10", "1.9", 1], ["1.010", "1.10", 0], ["1.0", "1.00", 0], ["0", "00", 0], ["1.2.3", "1.2", 1],
  ["2.0", "10.0", -1], ["1.002", "1.2", 0],
  // letters before other characters, all after the end of the part
  ["1.0a", "1.0+", -1], ["1.0+", "1.0.", -1], ["1.0a", "1.0b", -1], ["1.0A", "1.0a", -1], ["1.0Z", "1.0a", -1],
  ["1.0", "1.0+1", -1], ["1.0", "1.0.1", -1], ["1.2a", "1.2", 1], ["0.5.3k-2p", "0.5.3k-2", 1],
  ["1.0.0", "1.0+0", 1],
  // equal
  ["1.0", "1.0", 0], ["1:2.3-4", "1:2.3-4", 0], ["", "", 0], ["", "0", 0],
];

test("compareVersions: the policy 5.6.12 table, both ways round", () => {
  for (const [a, b, want] of TABLE) {
    assert.equal(compareVersions(a, b), want, `${a} vs ${b}`);
    assert.equal(compareVersions(b, a), -want || 0, `${b} vs ${a}`);
  }
});

test("compareVersions sorts and agrees with itself on the fixtures' versions", () => {
  const versions = [...parseControl(fixture("dist-Packages")), ...parseControl(fixture("flat-Packages"))].map((p) => p.version);
  const sorted = [...versions].sort(compareVersions);
  for (let i = 1; i < sorted.length; i++) assert.ok(compareVersions(sorted[i - 1], sorted[i]) <= 0);
  assert.deepEqual(["1.0", "1.0~rc1", "1:0.1", "1.0-1", "0.9"].sort(compareVersions), ["0.9", "1.0~rc1", "1.0", "1.0-1", "1:0.1"]);
});

test("satisfies", () => {
  assert.ok(satisfies("1.14.25-8", ">=", "1.14.25-8"));
  assert.ok(satisfies("1.0.2842", "<<", "1.0.2843-1"));
  assert.ok(!satisfies("1.0", ">>", "1.0"));
  assert.ok(satisfies("1.0", "=", "1.0-0"));
  assert.ok(satisfies("1.0", "<", "1.0")); // obsolete < means <=
  assert.ok(satisfies("1.0", ">", "1.0"));
  assert.ok(satisfies("1.0", "<=", "1.1"));
  assert.throws(() => satisfies("1", "!=", "1"));
});

// ---- worker and parser ----

test("worker handle: text and bytes (bad UTF-8 becomes U+FFFD), errors as replies", () => {
  const text = fixture("dist-Packages");
  const fromText = handle({ type: "packages", text, root: "http://apt.saurik.com/" });
  const bytes = new TextEncoder().encode(text).buffer;
  assert.deepEqual(handle({ type: "packages", bytes, root: "http://apt.saurik.com/" }), fromText);
  const bad = new Uint8Array([...new TextEncoder().encode("Package: x\nName: a"), 0xd5, 0x0a]);
  assert.equal(handle({ type: "control", bytes: bad })[0].name, "a�");
  assert.equal(handle({ type: "release", text: fixture("dist-Release") }).codename, "ios");
  assert.deepEqual(reply({ id: 7, type: "nope", text: "" }), { id: 7, ok: false, error: "unknown parse type nope" });
});

// A Worker stand-in that runs worker.js's reply() asynchronously, like a real one.
class FakeWorker {
  constructor(url, opts) { this.url = String(url); this.opts = opts; this.posted = []; }
  postMessage(msg, transfer) {
    this.posted.push({ msg, transfer });
    setTimeout(() => this.onmessage({ data: reply(msg) }), 0);
  }
  terminate() { this.terminated = true; }
}

test("parser: posts to a module worker and matches replies by id", async () => {
  let w;
  const parser = createParser({ Worker: class extends FakeWorker { constructor(...a) { super(...a); w = this; } } });
  assert.ok(parser.inWorker);
  assert.equal(w.opts.type, "module");
  assert.ok(w.url.endsWith("/core/worker.js"));
  const buf = new TextEncoder().encode(fixture("flat-Packages")).buffer;
  const [pk, rel] = await Promise.all([parser.packages(buf, "https://r.example/"), parser.release(fixture("dist-Release"))]);
  assert.equal(pk.length, 9);
  assert.equal(rel.origin, "Cydia/Telesphoreo");
  assert.deepEqual(w.posted[0].transfer, [buf]); // bytes are transferred, not copied
  w.postMessage = () => setTimeout(() => w.onerror({ message: "worker died" }), 0); // a crash rejects what's pending
  await assert.rejects(parser.control("A: 1\n"), /worker died/);
  parser.close();
  assert.ok(w.terminated);
});

test("parser: falls back to parsing inline without Worker", async () => {
  const parser = createParser({ Worker: null });
  assert.ok(!parser.inWorker);
  assert.equal((await parser.control("A: 1\n\nA: 2\n")).length, 2);
  const broken = createParser({ Worker: class { constructor() { throw new Error("no module workers"); } } });
  assert.ok(!broken.inWorker);
  assert.equal((await broken.release("Origin: o\n")).origin, "o");
});

test("architecture filter: rootless by default, plus all; no Architecture is dropped", () => {
  const st = parseControl("Package: a\nArchitecture: iphoneos-arm64\n\nPackage: b\nArchitecture: iphoneos-arm\n\n"
    + "Package: c\nArchitecture: all\n\nPackage: d\n");
  assert.equal(DEFAULT_ARCH, "iphoneos-arm64");
  assert.deepEqual(filterArch(st).map((p) => p.package), ["a", "c"]);
  assert.deepEqual(filterArch(st, "iphoneos-arm").map((p) => p.package), ["b", "c"]);
  assert.equal(matchesArch({}), false);
});

test("F38: roothide lists iphoneos-arm64e packages and all", () => {
  const st = parseControl("Package: a\nArchitecture: iphoneos-arm64\n\nPackage: e\nArchitecture: iphoneos-arm64e\n\n"
    + "Package: c\nArchitecture: all\n");
  assert.ok(ARCHES.includes("iphoneos-arm64e"));
  assert.deepEqual(filterArch(st, "iphoneos-arm64e").map((p) => p.package), ["e", "c"]);
});
