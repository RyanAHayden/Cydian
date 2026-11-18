// F89: the website has no server of its own, so it signs nothing. An app page's Install there hands the app on:
// Open in Cydian (cydian://install, incoming.js), Get in AltStore / SideStore / Feather (their install links,
// screens/handoff.js installLinks), Download IPA; Home's Install Cydian App adds Cydian's source to those sideloaders
// (home.js appInstallChoices); My IPAs' links get the same hand-offs (myipas.js siteInstallChoices).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows, SITE_INSTALL_FOOTER } from "./altstore.js";
import { installLinks, sourceHandoffs, HANDOFF_APPS } from "./handoff.js";
import { appInstallChoices, showsSigningTile } from "./home.js";
import { siteInstallChoices } from "./myipas.js";
import { installAsk } from "../incoming.js";
import { parseOtherLink } from "../core/otherlinks.js";
import { APP_SOURCE_URL, APP_IPA_URL } from "../core/appoffer.js";

const V = { version: "1.2", downloadURL: "https://example.com/My-Delta.ipa" };
const labels = (rows) => rows.map((r) => r.label);

test("the website's Install rows: Open in Cydian, Get in AltStore / SideStore / Feather, Download IPA", () => {
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => {}, null, "Delta", { site: true, jailbreak: false, custom: false });
  assert.deepEqual(labels(rows), ["Open in Cydian", "Get in AltStore", "Get in SideStore", "Get in Feather", "Download IPA"]);
  assert.ok(rows.slice(0, 4).every((r) => r.handoff === true), "hand-offs are marked for the nav button's sheet");
  assert.ok(!rows.some((r) => r.label === "Install" || r.label === "Custom Install"), "nothing that signs on the website");
});

test("each hand-off opens its app's link and records the app; Download IPA opens the file", () => {
  const opened = [];
  let recorded = 0;
  const { rows } = installRows(V, null, (u) => opened.push(["download", u]), () => { recorded++; }, null, "Delta",
    { site: true, jailbreak: false, custom: false, open: (u) => opened.push(["open", u]) });
  for (const r of rows) r.onClick();
  const enc = encodeURIComponent(V.downloadURL);
  assert.deepEqual(opened, [
    ["open", `cydian://install?url=${enc}&name=Delta`],
    ["open", `altstore://install?url=${enc}`],
    ["open", `sidestore://install?url=${enc}`],
    ["open", `feather://install/${V.downloadURL}`],
    ["download", V.downloadURL],
  ]);
  assert.equal(recorded, 4); // F30: the Installed tab's record on a hand-off, as Install did; not on Download IPA
});

test("a source's own signed link stays first on the website; the jailbreak app keeps its helper", () => {
  const itms = { version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" };
  assert.deepEqual(labels(installRows(itms, null, () => {}, () => {}, null, "X", { site: true, jailbreak: false }).rows), ["Install"]);
  const jb = installRows(V, null, () => {}, () => {}, null, "X", { site: false, jailbreak: true, custom: false }).rows;
  assert.deepEqual(labels(jb), ["Install", "Download IPA"]);
  assert.equal(jb[0].subtitle, "With the jailbreak");
});

test("the sideload app still signs: Install, no hand-offs", () => {
  const { rows } = installRows(V, null, () => {}, () => {}, null, "X", { site: false, jailbreak: false, custom: false });
  assert.deepEqual(labels(rows), ["Install", "Download IPA"]);
  assert.equal(rows[0].handoff, undefined);
});

test("by default (no bridge: the website in node) the rows are the hand-offs", () => {
  const saved = globalThis.cydianNative;
  try {
    delete globalThis.cydianNative;
    assert.equal(installRows(V, null).rows[0].label, "Open in Cydian");
  } finally { if (saved) globalThis.cydianNative = saved; }
  assert.match(SITE_INSTALL_FOOTER, /can't install apps itself/);
});

test("the hand-off links read back as what they say: Cydian's own and the sideloaders' (core/otherlinks.js)", () => {
  const links = installLinks(V.downloadURL, { name: "Delta" });
  assert.deepEqual(links.map((l) => l.app), ["Cydian", ...HANDOFF_APPS]);
  assert.deepEqual(installAsk(links[0].url), { url: V.downloadURL, name: "Delta" });
  for (const l of links.slice(1)) {
    const o = parseOtherLink(l.url);
    assert.equal(o?.action, "install", l.url);
    assert.equal(o.app, l.app);
    assert.equal(decodeURI(o.url), V.downloadURL);
  }
  // Feather takes https only; nothing for a link that isn't http(s).
  assert.deepEqual(installLinks("http://plain.example/a.ipa").map((l) => l.app), ["Cydian", "AltStore", "SideStore"]);
  assert.deepEqual(installLinks("ftp://x/a.ipa"), []);
});

test("Home's Install Cydian App: Cydian's source in AltStore, SideStore, Feather, then Download IPA", () => {
  const c = appInstallChoices();
  assert.deepEqual(c.map((x) => x.label), ["Add to AltStore", "Add to SideStore", "Add to Feather", "Download IPA"]);
  for (const x of c.slice(0, 3)) {
    const o = parseOtherLink(x.url);
    assert.equal(o?.action, "source", x.url);
    assert.equal(o.url, APP_SOURCE_URL);
  }
  assert.equal(c[3].url, APP_IPA_URL);
  assert.deepEqual(sourceHandoffs(APP_SOURCE_URL).map((l) => l.app), HANDOFF_APPS);
  assert.equal(showsSigningTile("site"), false);
  assert.equal(showsSigningTile("sideload"), true);
});

test("My IPAs on the website: a link's Install offers the same hand-offs and Download IPA", () => {
  const c = siteInstallChoices({ file: "a", url: "https://e.example/A.ipa", name: "A" });
  assert.deepEqual(c.map((x) => x.label), ["Open in Cydian", "Get in AltStore", "Get in SideStore", "Get in Feather", "Download IPA"]);
  assert.equal(c[4].url, "https://e.example/A.ipa");
  assert.deepEqual(siteInstallChoices({ file: "a" }), []);
});
