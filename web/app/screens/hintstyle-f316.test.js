// F316: the signing pages in the iOS 6 hint style (AGENTS.md, Hints): a footer explains only the group above it, one
// or two short sentences, never joined, the fix when something is off, status rows get none.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_HINTS, udidFindRows, udidPageSections, UDID_STEPS, UDID_WAITING, UDID_FOUND, DOWNLOAD_PROFILE, FIND_UDID } from "./signing.js";
import { profileLayout, certificateFooter, certFilesFooter, CERT_KEPT_FOOTER, CERT_NONE_FOOTER, SHARE_FOOTER, nav } from "./settings.js";
import { statusLayout, STATUS_UNCHECKED, SIGNATURES_UNTIL } from "./signed-apps.js";
import { accountFooter, withRoleHint, ROLE_HINT } from "./devaccount.js";
import { websiteInstallsFooter, WEBSITE_INSTALLS_FOOTER, WEBSITE_INSTALLS_LOCKED } from "./website-settings.js";
import { deviceCheck, deviceCheckText } from "../core/signing.js";

const short = (f, max = 140) => {
  const n = f.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.ok(n >= 1 && n <= 2, `"${f}": ${n} sentences`);
  assert.ok(f.length <= max, `"${f}": ${f.length} characters`);
};
const UDID = "00008030-0011223344556677";
const labels = (s) => (s.rows ?? []).map((r) => r.label);

test("every new footer is one or two short sentences", () => {
  for (const f of [...Object.values(DEVICE_HINTS), ...UDID_STEPS, UDID_WAITING, UDID_FOUND, CERT_KEPT_FOOTER, CERT_NONE_FOOTER,
    certFilesFooter(true), certFilesFooter(false), SHARE_FOOTER, STATUS_UNCHECKED, "Last checked 11/20/2026.",
    accountFooter({ key: false }), accountFooter({ key: true, app: true }), accountFooter({ key: true, app: false }),
    ROLE_HINT, WEBSITE_INSTALLS_FOOTER, WEBSITE_INSTALLS_LOCKED]) short(f);
});

test("Provisioning Profile: status rows with no hint, This iPhone with its state hint, Find UDID its own group", () => {
  const status = [{ label: "Name", detail: "P" }, { label: "Expires", detail: "1/1/2027" }];
  const none = profileLayout(status, null);
  assert.deepEqual(none.sections, [{ header: "Provisioning Profile", rows: status }]);

  const out = profileLayout(status, deviceCheckText({ state: "out", udid: UDID, count: 2 }));
  assert.deepEqual(out.sections.map(labels), [["Name", "Expires"], ["This iPhone", "UDID", "Copy UDID"]]);
  assert.equal(out.sections[0].footer, undefined, "status rows get none");
  assert.equal(out.sections[1].footer, DEVICE_HINTS.outCopy);
  assert.equal(out.warn, true);

  assert.equal(profileLayout(status, deviceCheckText({ state: "in", udid: UDID, count: 2 })).sections[1].footer, DEVICE_HINTS.in);

  const check = deviceCheck({ udids: [UDID, "00008030-AAAA"] }, null);
  const site = profileLayout(status, deviceCheckText(check), udidFindRows(check));
  assert.deepEqual(site.sections.map(labels), [["Name", "Expires"], ["This iPhone"], [FIND_UDID]]);
  assert.equal(site.sections[1].footer, DEVICE_HINTS.unknownFind);
  assert.equal(site.sections[2].footer, undefined, "the steps are on the page it opens");
  const waiting = profileLayout(status, deviceCheckText(check), udidFindRows(check, { pending: true }));
  assert.equal(waiting.sections[2].footer, UDID_WAITING);
  for (const s of [...out.sections, ...site.sections]) assert.doesNotMatch(s.footer ?? "", /Find This iPhone's UDID downloads/);
});

test("Find UDID's page: one group per step, Download Profile starts it, then the UDID", () => {
  const g = udidPageSections();
  assert.deepEqual(g.map(labels), [[DOWNLOAD_PROFILE], [], []]);
  assert.equal(g[0].rows[0].start, true);
  assert.deepEqual(g.map((s) => s.footer), UDID_STEPS.map((s, i) => `${i + 1}. ${s}`));
  const w = udidPageSections({ pending: true });
  assert.equal(w[0].rows[0].detail, "Waiting");
  assert.equal(w[0].footer, UDID_WAITING);
  const done = udidPageSections({ udid: UDID });
  assert.equal(done.length, 1);
  assert.equal(done[0].rows[0].subtitle, UDID);
  assert.equal(done[0].footer, UDID_FOUND);
  assert.equal(nav({ tab: "home", path: ["signing", "udid"] }).title, "Find UDID");
});

test("Certificate: only the most important problem, else Kept in this iPhone's Keychain.", () => {
  assert.equal(certificateFooter({ notes: ["First.", "Second."], has: true }), "First.");
  assert.equal(certificateFooter({ has: true }), "Kept in this iPhone's Keychain.");
  assert.equal(certificateFooter({ has: false }), CERT_NONE_FOOTER);
});

test("Certificate Status: Last checked or the revoked message; Signatures Until a status row", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const good = statusLayout({ revocation: { status: "good", checked: "2026-11-19T10:00:00Z" }, signatureExpires: "2027-06-01T00:00:00Z" }, now);
  assert.deepEqual(good.rows.map((r) => r.label), ["Check Certificate", SIGNATURES_UNTIL]);
  assert.match(good.footer, /^Last checked .+\.$/);
  assert.doesNotMatch(good.footer, /Signatures/);
  assert.equal(good.warn, false);
  const revoked = statusLayout({ revocation: { status: "revoked", revokedAt: "2026-11-01T00:00:00Z", checked: "2026-11-19T10:00:00Z" },
    signatureExpires: "2026-11-22T00:00:00Z" }, now);
  assert.match(revoked.footer, /^Apple has revoked this certificate/);
  assert.doesNotMatch(revoked.footer, /Signatures end/, "one warning, not two joined");
  assert.equal(revoked.warn, true);
  assert.equal(statusLayout({}, now).footer, STATUS_UNCHECKED);
  assert.deepEqual(statusLayout({}, now).rows.map((r) => r.label), ["Check Certificate"]);
});

test("Apple Developer Account: the key rows' two sentences; the role only on failure", () => {
  assert.match(accountFooter({ key: true, app: true }), /makes a profile with Push for each app you sign\. The key stays in this iPhone's Keychain\.$/);
  assert.match(accountFooter({ key: true, app: false }), /The key stays in this browser\.$/);
  for (const k of [true, false]) assert.doesNotMatch(accountFooter({ key: k }), /role/);
  assert.equal(withRoleHint(Object.assign(new Error("Error: Apple refused the key"), { status: 403 })), `Apple refused the key. ${ROLE_HINT}`);
  assert.equal(withRoleHint("App Store Connect GET /devices: FORBIDDEN_ERROR"), `App Store Connect GET /devices: FORBIDDEN_ERROR. ${ROLE_HINT}`);
  assert.equal(withRoleHint(new Error("Couldn't reach App Store Connect (offline).")), "Couldn't reach App Store Connect (offline).", "not for a network error");
});

test("Website > Other Apps: the footer by lock state", () => {
  assert.equal(websiteInstallsFooter(false), "Slower than the app, and big apps can fail.");
  assert.equal(websiteInstallsFooter(true), "Locked until you tap Browse Anyway on Home.");
});
