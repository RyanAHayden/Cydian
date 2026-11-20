// F314: package and app pages in the iOS 6 hint style (AGENTS.md, Hints): a footer explains only the group above it,
// one or two short sentences, a group per switch, never two hints joined, status rows get none.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { installedSections, paidDebSection, IGNORE_UPGRADES_FOOTER, DPKG_HELD_FOOTER, AUTO_UPDATE_FOOTER, PAID_DEB_FOOTER } from "./browse.js";
import { installSections, infoSections, LOCAL_INSTALL_FOOTER, GATE_FOOTER, SITE_SLOW_FOOTER, SITE_INSTALL_FOOTER, ITMS_FOOTER } from "./altstore.js";
import { whereFromGroup, PUBLIC_CODE_FOOTER } from "./safety.js";
import { purchaseSections } from "./extras.js";
import { waitNoteGroups } from "./queue.js";
import { AUTO_MARK_LABEL } from "../core/automark.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { TOO_BIG_FOOTER } from "../signing-client.js";
import { NAME } from "../brand.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const labels = (s) => (s.rows ?? []).map((r) => r.label);
// one or two short sentences
const short = (f) => {
  const n = f.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.ok(n >= 1 && n <= 2, `"${f}": ${n} sentences`);
  assert.ok(f.length <= 110, `"${f}": ${f.length} characters`);
};

test("Installed Package: Version alone, then Ignore Upgrades and Update Automatically each with its own footer", () => {
  const g = installedSections({ version: "1.2", mark: true });
  assert.deepEqual(g.map(labels), [["Version"], ["Ignore Upgrades"], [AUTO_MARK_LABEL]]);
  assert.equal(g[0].header, "Installed Package");
  assert.equal(g[0].footer, undefined, "Version is a status row: no footer");
  assert.equal(g[1].footer, "Leaves this package out of Upgrade All.");
  assert.equal(g[2].footer, "Installs its updates by itself.");
  for (const f of [IGNORE_UPGRADES_FOOTER, DPKG_HELD_FOOTER, AUTO_UPDATE_FOOTER, PAID_DEB_FOOTER]) short(f);
  // no Update Automatically group unless Only Packages I Mark shows it
  assert.deepEqual(installedSections({ version: "1.2" }).map(labels), [["Version"], ["Ignore Upgrades"]]);
  // a dpkg hold from the phone: shown, its footer says what holds it and where to change it
  const held = installedSections({ version: "1.2", dpkgHeld: true });
  assert.equal(held[1].rows[0].detail, "Held by dpkg");
  assert.equal(held[1].footer, DPKG_HELD_FOOTER);
});

test("a paid package on the site: a greyed Download .deb row carries the note, not a footer-only group", () => {
  const s = paidDebSection();
  assert.deepEqual(labels(s), ["Download .deb"]);
  assert.equal(s.footer, PAID_DEB_FOOTER);
});

const row = (label) => ({ label });

test("app Install: Install and Custom Install under one footer, Download IPA its own group", () => {
  const rows = [row("Install"), row("Custom Install"), row("Download IPA")];
  const g = installSections(rows, { local: true });
  assert.deepEqual(g.map(labels), [["Install", "Custom Install"], ["Download IPA"]]);
  assert.equal(g[0].header, "Install");
  assert.equal(g[0].footer, "Signed with your certificate on this iPhone.");
  assert.equal(g[1].footer, undefined);
  assert.equal(installSections([row("Install"), row("Download IPA")], { jailbreak: true, local: true })[0].footer, IPA_FOOTER);
  assert.equal(installSections([row("Install"), row("Download IPA")], { itms: true })[0].footer, ITMS_FOOTER);
  assert.equal(installSections([row("Install"), row("Download IPA")], {})[0].footer, SITE_INSTALL_FOOTER);
  assert.doesNotMatch(SITE_INSTALL_FOOTER, /Download IPA/);
  assert.equal(installSections([], { download: false })[0].footer, null);
  for (const f of [LOCAL_INSTALL_FOOTER, GATE_FOOTER, SITE_SLOW_FOOTER, SITE_INSTALL_FOOTER, ITMS_FOOTER]) short(f);
});

test("the website's gate: Install in NAME, Download IPA, Install on the Website, each its own group", () => {
  const g = installSections([row(`Install in ${NAME}`), row("Download IPA"), row("Install on the Website")], { gated: true });
  assert.deepEqual(g.map(labels), [[`Install in ${NAME}`], ["Download IPA"], ["Install on the Website"]]);
  assert.equal(g[0].footer, `Opens in the ${NAME} app, which signs and installs it.`);
  assert.equal(g[1].footer, undefined);
  assert.match(g[2].footer, /slower/);
});

test("Information: the size cap's footer under Size, the fit detail under Compatibility", () => {
  const info = ["Developer", "Version", "Size", "Updated", "Compatibility", "Bundle ID"].map(row);
  const one = infoSections(info, { fitDetail: "Runs on iOS 15 and later." });
  assert.equal(one.length, 1);
  assert.equal(one[0].footer, "Runs on iOS 15 and later.");
  const big = infoSections(info, { fitDetail: "Runs on iOS 15 and later.", tooBig: true });
  assert.deepEqual(big.map(labels), [["Developer", "Version", "Size"], ["Updated", "Compatibility", "Bundle ID"]]);
  assert.equal(big[0].header, "Information");
  assert.equal(big[0].footer, TOO_BIG_FOOTER);
  assert.equal(big[1].footer, "Runs on iOS 15 and later.");
  assert.equal(infoSections(info, { tooBig: true })[1].footer, null);
});

test("Where It Comes From: the trust label under Source, the public-code note in a group of its own", () => {
  const w = whereFromGroup({ sourceName: "Repo", sourceUrl: "https://repo.example/apps.json", github: { owner: "a", repo: "b" } }, { trusted: new Set() });
  const groups = w.node.querySelectorAll(".group");
  assert.equal(groups.length, 2);
  const foot = (g) => g.querySelectorAll(".group-footer").map((p) => p.textContent);
  assert.deepEqual(foot(groups[0]), ["Repo isn't on the known-safe list. That doesn't make it bad."]);
  assert.deepEqual(foot(groups[1]), [PUBLIC_CODE_FOOTER]);
  const hidden = whereFromGroup({ sourceName: "Repo", sourceUrl: "https://repo.example/apps.json" }, { trusted: new Set() });
  assert.equal(hidden.node.querySelectorAll(".group")[1].querySelectorAll(".group-footer").length, 0);
});

test("Purchase: the UDID note is a second group, not glued to Sold by", () => {
  const rows = [{ label: "Price", detail: "$1.99" }];
  assert.deepEqual(purchaseSections(rows, "Sold by Havoc."), [{ header: "Purchase", rows, footer: "Sold by Havoc." }]);
  const two = purchaseSections(rows, "Sold by Havoc.", "Pair this iPhone first.");
  assert.equal(two.length, 2);
  assert.equal(two[0].footer, "Sold by Havoc.");
  assert.deepEqual(two[1], { footer: "Pair this iPhone first." });
});

test("Confirm's wait notes: one group each", () => {
  const frag = waitNoteGroups(["Waits for A.", "Waits for B."]);
  const groups = frag.querySelectorAll(".group");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.querySelectorAll(".group-footer").map((p) => p.textContent)), [["Waits for A."], ["Waits for B."]]);
});
