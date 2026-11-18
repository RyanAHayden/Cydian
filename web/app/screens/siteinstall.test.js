// F89: the website has no server of its own. F93: it signs in the browser again: an app page's Install there signs
// (signing-client.js signInBrowser), then the hand-offs: Open in Cydian (cydian://install, incoming.js), Get in
// AltStore / SideStore / Feather (their install links, screens/handoff.js installLinks), Download IPA; Home's
// Install Cydian App signs Cydian (home.js installApp); My IPAs' links get the hand-offs (myipas.js siteInstallChoices).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows, SITE_INSTALL_FOOTER } from "./altstore.js";
import { installLinks, sourceHandoffs, HANDOFF_APPS } from "./handoff.js";
import { installApp, showsSigningTile } from "./home.js";
import { siteInstallChoices } from "./myipas.js";
import { installAsk } from "../incoming.js";
import { parseOtherLink } from "../core/otherlinks.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";

const V = { version: "1.2", downloadURL: "https://example.com/My-Delta.ipa" };
const labels = (rows) => rows.map((r) => r.label);

test("the website's Install rows: Install (in the browser), Open in Cydian, Get in AltStore / SideStore / Feather, Download IPA", () => {
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => {}, null, "Delta", { site: true, jailbreak: false, custom: false });
  assert.deepEqual(labels(rows), ["Install", "Open in Cydian", "Get in AltStore", "Get in SideStore", "Get in Feather", "Download IPA"]);
  assert.ok(!rows[0].handoff, "Install comes first: the nav button runs it straight away (browse.js)");
  assert.ok(rows.slice(1, 5).every((r) => r.handoff === true), "hand-offs are marked");
  assert.ok(!rows.some((r) => r.label === "Custom Install"), "no Custom Install on the website");
});

test("each hand-off opens its app's link and records the app; Download IPA opens the file", () => {
  const opened = [];
  let recorded = 0;
  const { rows } = installRows(V, null, (u) => opened.push(["download", u]), () => { recorded++; }, null, "Delta",
    { site: true, jailbreak: false, custom: false, open: (u) => opened.push(["open", u]) });
  for (const r of rows.slice(1)) r.onClick(); // Install signs (signing-client.test.js covers it)
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

test("by default (no bridge: the website in node) the rows are Install in the browser, then the hand-offs", () => {
  const saved = globalThis.cydianNative;
  try {
    delete globalThis.cydianNative;
    assert.deepEqual(labels(installRows(V, null).rows).slice(0, 2), ["Install", "Open in Cydian"]);
  } finally { if (saved) globalThis.cydianNative = saved; }
  assert.match(SITE_INSTALL_FOOTER, /signs the app here in the browser/);
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

test("Home's Install Cydian App (F93, as before F89): signs Cydian with the certificate, or opens Settings > Signing", async () => {
  const calls = [];
  const deps = (ready, bring) => ({ ready: async () => ready, bring: () => bring, install: (o) => calls.push(["install", o]), go: (h) => calls.push(["go", h]) });
  assert.equal(await installApp(deps(false, true)), "signing");
  assert.equal(await installApp(deps(true, false)), "install");
  assert.deepEqual(calls, [["go", "/settings/signing"], ["install", { url: APP_IPA_URL, name: APP_NAME, bring: false }]]);
  assert.equal(showsSigningTile("site"), true);
  assert.equal(showsSigningTile("sideload"), true);
  assert.equal(showsSigningTile("jailbreak"), false);
});

test("My IPAs on the website: a link's Install offers the same hand-offs and Download IPA", () => {
  const c = siteInstallChoices({ file: "a", url: "https://e.example/A.ipa", name: "A" });
  assert.deepEqual(c.map((x) => x.label), ["Open in Cydian", "Get in AltStore", "Get in SideStore", "Get in Feather", "Download IPA"]);
  assert.equal(c[4].url, "https://e.example/A.ipa");
  assert.deepEqual(siteInstallChoices({ file: "a" }), []);
});
