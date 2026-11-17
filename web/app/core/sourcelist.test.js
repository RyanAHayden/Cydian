import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportText, exportLine, parseImport, reviewImport, entryKeys, orderSources, loadOrder, saveOrder, altLink, ORDER_KEY,
} from "./sourcelist.js";
import { DEFAULT_SOURCES, DEFAULT_ALT_SOURCES } from "./sources.js";
import { seedRecord, normalizeAltUrl, looksLikeAltUrl } from "./altstore.js";
import { RECOMMENDED_SOURCES, RECOMMENDED_GAMES } from "./recommended.js";
import { qrMatrix, qrSvg } from "./qr.js";

const ALT = DEFAULT_ALT_SOURCES.map(seedRecord);
const ALL = [...DEFAULT_SOURCES, ...ALT];

test("export writes one line per source: a URL, or a deb line for a dist repo", () => {
  const text = exportText(ALL, { date: new Date("2026-11-17T12:00:00Z") });
  const lines = text.trim().split("\n");
  assert.equal(lines[0], `# Cydian sources (${ALL.length}), 2026-11-17`);
  assert.ok(lines.includes("deb http://apt.saurik.com/ ios/1800.00 main"));
  assert.ok(lines.includes("deb https://apt.procurs.us/ 1800 main"));
  assert.ok(lines.includes("https://repo.chariz.com/"));
  assert.ok(lines.includes("https://fizl0.github.io/apps/source.json"));
  assert.equal(exportLine({ key: "alt:https://alt.crystall1ne.dev/", uri: "https://alt.crystall1ne.dev/" }), "https://alt.crystall1ne.dev/");
});

test("export and import round trip: every exported source comes back as already listed", () => {
  const { format, entries } = parseImport(exportText(ALL));
  assert.equal(format, "lines");
  assert.equal(entries.length, ALL.length);
  const reviewed = reviewImport(entries, ALL);
  assert.deepEqual(reviewed.filter((e) => e.status !== "listed").map((e) => e.uri), []);
  // Each source's key is among the keys its entry could be stored under.
  for (const s of ALL) assert.ok(entries.some((e) => entryKeys(e).includes(s.key)), s.key);
});

test("import into an empty list: every source is new, dist repos too (F48)", () => {
  const reviewed = reviewImport(parseImport(exportText(ALL)).entries, []);
  const by = (st) => reviewed.filter((e) => e.status === st).map((e) => e.uri);
  assert.deepEqual(by("unsupported"), []);
  assert.equal(by("new").length, ALL.length);
  const procursus = reviewed.find((e) => e.uri === "https://apt.procurs.us/");
  assert.deepEqual(procursus.input, { uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] });
  for (const e of reviewed.filter((x) => x.status === "new")) assert.ok(e.input);
});

test("plain pasted text: URLs anywhere in a line, links, comments, repeats dropped", () => {
  const { entries } = parseImport([
    "My sources:",
    "  https://repo.example.com/  and https://example.org/apps.json,",
    "# https://commented.example.com/",
    "altstore://source?url=https%3A%2F%2Fapps.altstore.io%2F",
    "https://repo.example.com/",
    "repo.bare.com",
  ].join("\n"));
  assert.deepEqual(entries.map((e) => [e.kind, e.uri]), [
    ["any", "https://repo.example.com/"],
    ["altstore", "https://example.org/apps.json"],
    ["altstore", "https://apps.altstore.io/"],
  ]);
  assert.equal(entries[1].input, altLink("https://example.org/apps.json"));
});

test("an AltStore entry's input goes to AltStore and keeps its URL", () => {
  const input = altLink("https://apps.altstore.io/");
  assert.ok(looksLikeAltUrl(input));
  assert.equal(normalizeAltUrl(input), "https://apps.altstore.io/");
});

test("Cydia's sources.list.d/cydia.list", () => {
  const { format, entries } = parseImport([
    "deb http://apt.saurik.com/ ios/1800.00 main",
    "deb https://repo.chariz.com/ ./",
    "deb-src https://src.example.com/ ./",
    "deb [arch=iphoneos-arm64] https://havoc.app ./",
  ].join("\n"));
  assert.equal(format, "list");
  assert.deepEqual(entries.map((e) => [e.uri, e.dist, e.components, e.input]), [
    ["http://apt.saurik.com/", "ios/1800.00", ["main"], { uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] }],
    ["https://repo.chariz.com/", "./", [], "https://repo.chariz.com/"],
    ["https://havoc.app/", "./", [], "https://havoc.app/"],
  ]);
  const r = reviewImport(entries, DEFAULT_SOURCES);
  assert.deepEqual(r.map((e) => e.status), ["listed", "listed", "listed"]);
});

test("Sileo's sileo.sources (deb822)", () => {
  const { format, entries } = parseImport([
    "Types: deb",
    "URIs: https://repo.chariz.com/",
    "Suites: ./",
    "Components:",
    "",
    "Types: deb",
    "URIs: https://apt.procurs.us/",
    "Suites: 1800",
    "Components: main",
    "",
    "Types: deb",
    "URIs: https://disabled.example.com/",
    "Suites: ./",
    "Enabled: no",
  ].join("\n"));
  assert.equal(format, "deb822");
  assert.deepEqual(entries.map((e) => [e.uri, e.dist]), [["https://repo.chariz.com/", "./"], ["https://apt.procurs.us/", "1800"]]);
  assert.deepEqual(reviewImport(entries, []).map((e) => e.status), ["new", "new"]);
});

test("AltStore, SideStore and Feather JSON lists", () => {
  const urls = (text) => parseImport(text).entries.map((e) => [e.kind, e.uri]);
  assert.deepEqual(urls('["https://a.example.com/apps.json", "https://b.example.com/"]'),
    [["altstore", "https://a.example.com/apps.json"], ["any", "https://b.example.com/"]]);
  // objects with url / sourceURL / identifier, as sideloaders keep their sources
  assert.deepEqual(urls(JSON.stringify({ sources: [
    { name: "A", sourceURL: "https://a.example.com/" },
    { identifier: "b", url: "https://b.example.com/x" },
    { name: "no url" },
  ] })), [["altstore", "https://a.example.com/"], ["altstore", "https://b.example.com/x"]]);
  // an AltStore source file names its own URL
  assert.deepEqual(urls(JSON.stringify({ name: "S", sourceURL: "https://s.example.com/s", apps: [] })), [["altstore", "https://s.example.com/s"]]);
  assert.deepEqual(urls(JSON.stringify({ name: "S", apps: [] })), []);
  assert.deepEqual(parseImport("{not json").entries, []);
});

test("an AltStore source listed without its trailing slash still counts as listed", () => {
  const list = [seedRecord("https://repository.apptesters.org/")];
  const [e] = reviewImport(parseImport('["https://repository.apptesters.org"]').entries, list);
  assert.equal(e.status, "listed");
});

test("orderSources: saved keys first in their order, newer sources after", () => {
  const list = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  assert.deepEqual(orderSources(list, ["c", "gone", "a"]).map((s) => s.key), ["c", "a", "b", "d"]);
  assert.equal(orderSources(list, null), list);
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(loadOrder(storage), null);
  saveOrder(["c", "a"], storage);
  assert.deepEqual(loadOrder(storage), ["c", "a"]);
  saveOrder(null, storage);
  assert.equal(mem.has(ORDER_KEY), false);
});

test("the recommended list: each entry has a reason and an addable URL", () => {
  for (const r of [...RECOMMENDED_SOURCES, ...RECOMMENDED_GAMES]) {
    assert.ok(r.why && r.why.length > 10, r.name);
    assert.ok(normalizeAltUrl(r.url), r.url);
  }
  const srcUrls = new Set(RECOMMENDED_SOURCES.map((s) => s.url));
  for (const g of RECOMMENDED_GAMES) assert.ok(g.bundleId && srcUrls.has(g.url), `${g.name}'s source is recommended too`);
});

test("QR: sizes grow with the text, and a list too long for version 40 throws", () => {
  assert.equal(qrMatrix("hi").size, 21);
  assert.equal(qrMatrix("x".repeat(100), { ecc: "L" }).version, 5); // v5-L holds 106 bytes
  assert.throws(() => qrMatrix("x".repeat(3000)), /Too long/);
  assert.match(qrSvg("hi"), /^<svg[^>]+viewBox="0 0 29 29"/);
});

// zbarimg (zbar-tools) reads the codes back where it is installed; elsewhere this is skipped.
let zbar = true;
try { execFileSync("zbarimg", ["--version"], { stdio: "ignore" }); } catch { zbar = false; }
test("QR: zbarimg decodes the export of the default list", { skip: !zbar && "zbarimg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cydian-qr-"));
  try {
    for (const [text, ecc] of [[exportText(ALL), "M"], ["héllo · https://example.com/", "L"], ["https://repo.chariz.com/", "M"]]) {
      const m = qrMatrix(text, { ecc });
      const sc = 3, q = 4, n = (m.size + 2 * q) * sc;
      const rows = [];
      for (let y = 0; y < n; y++) {
        let r = "";
        for (let x = 0; x < n; x++) r += m.get(Math.floor(x / sc) - q, Math.floor(y / sc) - q) ? "1" : "0";
        rows.push(r);
      }
      const file = join(dir, "q.pbm");
      writeFileSync(file, `P1\n${n} ${n}\n${rows.join("\n")}\n`);
      const got = execFileSync("zbarimg", ["-q", "--raw", file], { encoding: "utf8" });
      assert.equal(got.replace(/\n+$/, ""), text.replace(/\n+$/, ""));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
