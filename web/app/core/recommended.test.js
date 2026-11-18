// F142: the recommended list per build. The jailbreak build lists APT repos (and FIZL0's own source), the sideload
// IPA and the website AltStore sources only; every entry says what it carries; deps.js's library homes are all on it.
// When each entry was last fetched: CHECKED, re-checked with tools/recommended_check.py (network, so not here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RECOMMENDED_SOURCES, CHECKED, JAILBREAKS, recommendedFor } from "./recommended.js";
import { recommendedRows } from "./sourcelist.js";

const apt = RECOMMENDED_SOURCES.filter((r) => r.jailbreak);
const alt = RECOMMENDED_SOURCES.filter((r) => !r.jailbreak);

test("F142: every entry is a source with a name, an https URL and a one-line description of what it carries", () => {
  const names = new Set();
  const urls = new Set();
  for (const r of RECOMMENDED_SOURCES) {
    assert.equal(r.kind, "source", r.name);
    assert.ok(r.name && !names.has(r.name), `name once: ${r.name}`);
    assert.ok(/^https:\/\//.test(r.url) && !urls.has(r.url), `https URL once: ${r.url}`);
    names.add(r.name);
    urls.add(r.url);
    assert.ok(r.why.length >= 30 && r.why.length <= 120 && !r.why.includes("\n"), `one line: ${r.name}`);
    assert.match(r.why, /\.$/, r.name);
  }
  assert.match(CHECKED, /^\d{4}-\d{2}-\d{2}$/);
});

test("F142: the APT repos are flat repos with the jailbreaks they suit; the old picks are gone except FIZL0", () => {
  const ids = new Set(JAILBREAKS.map((j) => j.id));
  for (const r of apt) {
    assert.ok(r.url.endsWith("/"), `a flat repo URL: ${r.url}`);
    assert.ok(Array.isArray(r.for) && r.for.length && r.for.every((j) => ids.has(j) && j !== "other"), r.name);
  }
  assert.deepEqual(apt.map((r) => r.name), ["Havoc", "Chariz", "ElleKit", "palera1n", "Zebra"]);
  assert.deepEqual(RECOMMENDED_SOURCES.filter((r) => r.own).map((r) => r.name), ["FIZL0"]);
  assert.ok(alt.length >= 10);
});

test("F142: the jailbreak build lists APT repos and FIZL0; the IPA and website list AltStore sources", () => {
  for (const jb of [...JAILBREAKS.map((j) => j.id), null]) {
    const recs = recommendedFor(RECOMMENDED_SOURCES, jb);
    const rows = recommendedRows(recs, [], { jailbroken: true });
    assert.ok(rows.every((r) => r.rec.jailbreak || r.rec.own), String(jb));
    assert.ok(rows.some((r) => r.rec.jailbreak), String(jb));
    assert.ok(rows.every((r) => !r.rec.jailbreak || r.key.startsWith("deb:")), String(jb));
  }
  const ipa = recommendedRows(RECOMMENDED_SOURCES, [], { jailbroken: false });
  assert.equal(ipa.length, alt.length);
  assert.ok(ipa.every((r) => !r.rec.jailbreak && r.key.startsWith("alt:")));
  assert.equal(ipa[0].label, "FIZL0");
});

test("F142: every repo deps.js names as a library's home is also on the list", () => {
  const text = readFileSync(new URL("./deps.js", import.meta.url), "utf8");
  const homes = [...text.matchAll(/\{ name: "([^"]+)", url: "([^"]+)" \}/g)].map((m) => m[2]);
  assert.ok(homes.length >= 4);
  for (const url of homes) assert.ok(apt.some((r) => r.url === url), url);
});

test("matchRecommendedApps: every word, across sources, capped", async () => {
  const { matchRecommendedApps } = await import("./recommended.js");
  const a = { row: { key: "a" }, apps: [{ name: "YouMod", subtitle: "YouTube with YouMod tweaks" }, { name: "Delta" }] };
  const b = { row: { key: "b" }, apps: [{ name: "RyukGram", developerName: "faroukbmiled" }] };
  assert.deepEqual(matchRecommendedApps([a, b], "youtube tweaks").map((m) => m.app.name), ["YouMod"]);
  assert.deepEqual(matchRecommendedApps([a, b], "FAROUK").map((m) => m.row.key), ["b"]);
  assert.deepEqual(matchRecommendedApps([a, b], "  "), []);
  assert.equal(matchRecommendedApps([a, a, a], "delta", 2).length, 2);
});
