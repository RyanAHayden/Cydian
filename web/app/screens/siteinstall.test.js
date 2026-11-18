// The website's Install (F92, user 2026-11-18: "the webpage install still shows open in and get in all these apps. we
// shouldnt"): an app page offers only Install and Download IPA. Install signs in the browser (F93); until then it says
// the certificate is needed, with Download IPA beside OK. Home's Install Cydian App does the same. My IPAs' links
// still get the F89 hand-offs (myipas.js siteInstallChoices); Share keeps the sideloaders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows, SITE_INSTALL_FOOTER, SITE_INSTALL_SUBTITLE, SITE_CERT_TITLE, siteCertificateAlert } from "./altstore.js";
import { installLinks, HANDOFF_APPS } from "./handoff.js";
import { installAppSheet, APP_INSTALL_SUBTITLE, showsSigningTile } from "./home.js";
import { siteInstallChoices } from "./myipas.js";
import { installAsk } from "../incoming.js";
import { parseOtherLink } from "../core/otherlinks.js";
import { APP_IPA_URL } from "../core/appoffer.js";

const V = { version: "1.2", downloadURL: "https://example.com/My-Delta.ipa" };
const labels = (rows) => rows.map((r) => r.label);

const SITE = { site: true, jailbreak: false, custom: false };

test("the website's Install rows: only Install and Download IPA, no hand-offs", () => {
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => {}, null, "Delta", SITE);
  assert.deepEqual(labels(rows), ["Install", "Download IPA"]);
  assert.equal(rows[0].subtitle, SITE_INSTALL_SUBTITLE);
  assert.equal(rows[0].needsCertificate, true);
  assert.ok(!rows.some((r) => r.handoff), "no hand-off rows");
  assert.ok(!rows.some((r) => /Open in|Get in|AltStore|SideStore|Feather/.test(`${r.label} ${r.subtitle}`)), labels(rows).join());
  assert.doesNotMatch(SITE_INSTALL_FOOTER, /AltStore|SideStore|Feather|Open in/);
});

test("the website's Install says the certificate is needed and offers Download IPA; nothing is recorded", async () => {
  const opened = [];
  const asked = [];
  let recorded = 0;
  const { rows } = installRows(V, null, (u) => opened.push(u), () => { recorded++; }, null, "Delta",
    { ...SITE, needsCertificate: (o) => { asked.push(o); return o; } });
  rows[0].onClick();
  assert.equal(asked.length, 1);
  assert.deepEqual(opened, []);
  asked[0].download(); // the alert's Download IPA
  assert.deepEqual(opened, [V.downloadURL]);
  rows[1].onClick(); // Download IPA
  assert.deepEqual(opened, [V.downloadURL, V.downloadURL]);
  assert.equal(recorded, 0, "nothing installed, so nothing on the Installed tab");
});

test("siteCertificateAlert: OK does nothing, Download IPA downloads", async () => {
  let downloads = 0;
  let shown = null;
  const alert = (index) => async (o) => { shown = o; return { index } };
  assert.equal(await siteCertificateAlert({ download: () => downloads++, alert: alert(0) }), false);
  assert.equal(shown.title, SITE_CERT_TITLE);
  assert.deepEqual(shown.buttons, ["OK", "Download IPA"]);
  assert.equal(downloads, 0);
  assert.equal(await siteCertificateAlert({ download: () => downloads++, alert: alert(1) }), true);
  assert.equal(downloads, 1);
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
  assert.equal(rows[0].subtitle, "Signed with your certificate");
  assert.equal(rows[0].needsCertificate, undefined);
});

test("by default (no bridge: the website in node) the rows are the website's Install and Download IPA", () => {
  const saved = globalThis.cydianNative;
  try {
    delete globalThis.cydianNative;
    const { rows } = installRows(V, null);
    assert.deepEqual(labels(rows), ["Install", "Download IPA"]);
    assert.equal(rows[0].needsCertificate, true);
  } finally { if (saved) globalThis.cydianNative = saved; }
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

test("Home's Install Cydian App: the certificate alert with Download IPA, no sideloaders", async () => {
  const opened = [];
  let shown = null;
  assert.equal(await installAppSheet({ alert: async (o) => { shown = o; return { index: 1 }; }, open: (u) => opened.push(u) }), true);
  assert.deepEqual(shown.buttons, ["OK", "Download IPA"]);
  assert.deepEqual(opened, [APP_IPA_URL]);
  assert.equal(await installAppSheet({ alert: async () => ({ index: 0 }), open: (u) => opened.push(u) }), false);
  assert.deepEqual(opened, [APP_IPA_URL]);
  assert.doesNotMatch(APP_INSTALL_SUBTITLE, /AltStore|SideStore|Feather/);
  assert.equal(showsSigningTile("site"), false);
  assert.equal(showsSigningTile("sideload"), true);
});

test("My IPAs on the website: a link's Install offers the same hand-offs and Download IPA", () => {
  const c = siteInstallChoices({ file: "a", url: "https://e.example/A.ipa", name: "A" });
  assert.deepEqual(c.map((x) => x.label), ["Open in Cydian", "Get in AltStore", "Get in SideStore", "Get in Feather", "Download IPA"]);
  assert.equal(c[4].url, "https://e.example/A.ipa");
  assert.deepEqual(siteInstallChoices({ file: "a" }), []);
});
