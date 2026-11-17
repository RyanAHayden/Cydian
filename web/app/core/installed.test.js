import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatus, parseStatusField, findUpgrades, looksLikeStatus, STATUS_PATHS } from "./installed.js";
import { createCatalog, runCatalog } from "./catalog.js";
import { handle } from "./worker.js";

const fixture = (name) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const ARM = "iphoneos-arm"; // the 4S's packages

test("installed: status fixture keeps what dpkg has on disk, held ones marked, sorted by name", () => {
  const pkgs = parseStatus(fixture("dpkg-status"));
  // config-files (AppCake) and not-installed (iCleaner Pro) stanzas are leftovers, not installed packages
  assert.deepEqual(pkgs.map((p) => p.id), ["apt7", "bash", "coreutils", "cydia", "mobilesubstrate", "org.herf.flux",
    "com.saurik.substrate.safemode", "winterboard"]);
  const by = Object.fromEntries(pkgs.map((p) => [p.id, p]));
  assert.equal(by.cydia.name, "Cydia Installer");
  assert.equal(by.cydia.version, "1.1.30");
  assert.equal(by.bash.section, "Terminal Support");
  assert.equal(by.bash.author, "Jay Freeman (saurik)"); // no Author: the Maintainer
  assert.deepEqual(pkgs.filter((p) => p.held).map((p) => p.id), ["org.herf.flux", "winterboard"]);
  assert.deepEqual(parseStatusField("hold ok installed"), { want: "hold", state: "installed" });
  assert.ok(looksLikeStatus(fixture("dpkg-status")));
  assert.equal(looksLikeStatus(fixture("upgrades-Packages")), false);
  assert.deepEqual(parseStatus("not a status file"), []);
  assert.deepEqual(STATUS_PATHS, ["/var/lib/dpkg/status", "/var/jb/var/lib/dpkg/status"]);
});

test("upgrades: fixture status + fixture repos give the expected upgrade list", () => {
  const c = createCatalog();
  c.load("r1", fixture("upgrades-Packages"), "https://r1.example/", ARM);
  c.load("r2", fixture("upgrades-Packages-2"), "https://r2.example/", ARM);
  assert.equal(c.upgrades().available.length, 0); // no status file yet: nothing installed
  assert.equal(c.installed(), null);
  assert.equal(c.setInstalled(fixture("dpkg-status")), 8);

  const { available, ignored } = c.upgrades();
  // apt7: an epoch on the second repo beats 0.7.25.3-9; bash: -17 on r1 beats r2's equal -16; cydia: 1.1.32~b1
  // beats 1.1.30. coreutils (equal), mobilesubstrate (older), safemode (only on arm64 or tagged obsolete) and
  // f.lux (on no source) have none; AppCake and iCleaner Pro aren't installed.
  assert.deepEqual(available.map((r) => [r.id, r.installed, r.version, r.key]), [
    ["apt7", "0.7.25.3-9", "1:0.7.25.3-1", "r2"],
    ["bash", "4.0.44-16", "4.0.44-17", "r1"],
    ["cydia", "1.1.30", "1.1.32~b1", "r1"],
  ]);
  // WinterBoard is held in dpkg (hold ok installed): an ignored upgrade, not an available one.
  assert.deepEqual(ignored.map((r) => [r.id, r.installed, r.version]), [["winterboard", "0.9.3915", "0.9.3919"]]);

  // Cydian's Ignored Upgrades list moves a package out of the available ones too.
  const held = c.upgrades(["cydia"]);
  assert.deepEqual(held.available.map((r) => r.id), ["apt7", "bash"]);
  assert.deepEqual(held.ignored.map((r) => r.id), ["cydia", "winterboard"]);

  // Hidden sections don't hide upgrades.
  c.setHidden(["Packaging", "Terminal Support"]);
  assert.equal(c.upgrades().available.length, 3);

  // A source going away takes its upgrades with it.
  c.remove("r2");
  assert.deepEqual(c.upgrades().available.map((r) => r.id), ["bash", "cydia"]);
});

test("installed rows carry the source's icon and key where a source has the package", () => {
  const c = createCatalog();
  c.load("r1", fixture("upgrades-Packages"), "https://r1.example/", ARM);
  c.setInstalled(fixture("dpkg-status"));
  const rows = c.installed();
  const bash = rows.find((r) => r.id === "bash");
  assert.equal(bash.key, "r1");
  assert.equal(bash.version, "4.0.44-16"); // the installed version, not the candidate
  assert.equal(rows.find((r) => r.id === "org.herf.flux").key, null);
  assert.equal(c.setInstalled(null), -1);
  assert.equal(c.installed(), null);
});

test("findUpgrades: equal or older candidates aren't upgrades; holds by id", () => {
  const inst = [{ id: "a", name: "A", version: "1.0" }, { id: "b", name: "B", version: "2.0" }, { id: "c", name: "C", version: "1" }];
  const cands = { a: { id: "a", name: "A", version: "1.0" }, b: { id: "b", name: "B", version: "1.9" }, c: { id: "c", name: "C", version: "1.0.1" } };
  assert.deepEqual(findUpgrades(inst, (id) => cands[id] ?? null), { available: [{ ...cands.c, installed: "1" }], ignored: [] });
  assert.deepEqual(findUpgrades(inst, (id) => cands[id] ?? null, ["c"]).ignored.map((r) => r.id), ["c"]);
});

test("the worker takes the status file as text or bytes", () => {
  handle({ type: "catalog", op: "load", args: ["r1", undefined, "https://r1.example/", ARM], text: fixture("upgrades-Packages") });
  const bytes = new TextEncoder().encode(fixture("dpkg-status")).buffer;
  assert.equal(handle({ type: "catalog", op: "setInstalled", args: [], bytes }), 8);
  assert.deepEqual(handle({ type: "catalog", op: "upgrades", args: [[]] }).available.map((r) => r.id), ["bash", "cydia"]);
  assert.equal(runCatalog(createCatalog(), "installed"), null);
});

test("upgrades: dpkgHolds off (the app) trusts the holds list over the status file's hold flags", () => {
  const c = createCatalog();
  c.load("r1", fixture("upgrades-Packages"), "https://r1.example/", ARM);
  c.setInstalled(fixture("dpkg-status"));
  const u = c.upgrades(["bash"], { dpkgHolds: false });
  assert.deepEqual(u.available.map((r) => r.id), ["cydia", "winterboard"]);
  assert.deepEqual(u.ignored.map((r) => r.id), ["bash"]);
});

test("package page of an installed package no source carries comes from its status stanza (F27)", () => {
  const c = createCatalog();
  c.load("r1", fixture("upgrades-Packages"), "https://r1.example/", ARM);
  assert.equal(c.package("org.herf.flux"), null, "no status file yet");
  c.setInstalled(fixture("dpkg-status"));
  const p = c.package("org.herf.flux");
  assert.equal(p.installedOnly, true);
  assert.equal(p.key, null);
  assert.deepEqual(p.others, []);
  assert.equal(p.stanza.name, "f.lux");
  assert.equal(p.stanza.version, "0.998");
  assert.equal(p.stanza.author, "F.lux Software LLC <justgetflux@gmail.com>");
  assert.match(p.stanza.depends, /preferenceloader/);
  assert.deepEqual([p.row.name, p.row.section, p.row.author], ["f.lux", "Tweaks", "F.lux Software LLC"]);
  // a package a source carries still comes from the source
  assert.equal(c.package("bash").key, "r1");
  assert.ok(!c.package("bash").installedOnly);
  // Depends links reach installed packages too; leftovers (config-files) don't count
  assert.deepEqual(c.has(["org.herf.flux", "nope"]), ["org.herf.flux"]);
  assert.equal(runCatalog(c, "package", ["org.herf.flux"]).stanza.package, "org.herf.flux");
  c.setInstalled(null);
  assert.equal(c.package("org.herf.flux"), null);
  assert.deepEqual(c.has(["org.herf.flux"]), []);
});
