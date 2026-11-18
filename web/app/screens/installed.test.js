import { test } from "node:test";
import assert from "node:assert/strict";
import { pageKind, recordsApps, appSubtitle, appListRows, DPKG, APPS } from "./installed.js";

const r = (...path) => ({ tab: "installed", path });

test("installed tab: apps list without a jailbreak, dpkg in the jailbreak app (F30)", () => {
  assert.equal(recordsApps("site"), true);
  assert.equal(recordsApps("sideload"), true);
  assert.equal(recordsApps("jailbreak"), false);
  assert.equal(pageKind(r(), "site"), "apps");
  assert.equal(pageKind(r(), "sideload"), "apps");
  assert.equal(pageKind(r(), "jailbreak"), "dpkg");
  assert.equal(pageKind(r(DPKG), "site"), "dpkg"); // the upload stays on the site for jailbroken phones
  assert.equal(pageKind(r(DPKG), "sideload"), "browse");
  assert.equal(pageKind(r(DPKG, "package:x"), "site"), "browse");
  assert.equal(pageKind(r("package:x"), "jailbreak"), "browse");
});

test("installed tab: an app row says the upgrade, the source and the date", () => {
  const date = Date.UTC(2026, 10, 17, 12);
  assert.equal(appSubtitle({ sourceName: "AltStore", date, upgrade: "1.6" }, "en-US"), "Upgrade to 1.6 · AltStore · Nov 17, 2026");
  assert.equal(appSubtitle({ source: "https://a.example/apps.json", date: 0, upgrade: null }, "en-US"), "https://a.example/apps.json");
});

test("installed tab: My IPAs pages without a jailbreak (F77)", async () => {
  assert.equal(pageKind(r("myipas"), "sideload"), "myipas");
  assert.equal(pageKind(r("myipas", "ipa:A.ipa"), "site"), "myipas");
  assert.equal(pageKind(r("myipas"), "jailbreak"), "browse");
  const { myIpasRow } = await import("./installed.js");
  assert.equal(myIpasRow(r(), false).href, "#/installed/myipas");
  assert.equal(myIpasRow(r(), false).label, "Install IPAs"); // F79: the page is Install IPAs now
});

test("F87: the jailbreak app's Apps page: the phone's versions, I4's notes, no upgrade for an app that's gone", () => {
  assert.equal(pageKind(r(APPS), "jailbreak"), "apps");
  assert.equal(pageKind(r(APPS, "package:x"), "jailbreak"), "browse");
  assert.equal(pageKind(r(APPS), "sideload"), "browse"); // the list is the root there
  assert.equal(appSubtitle({ note: "Installed: 1.6 (Cydian remembered 1.5)", sourceName: "AltStore", date: 0, upgrade: "1.7" }),
    "Installed: 1.6 (Cydian remembered 1.5) · Upgrade to 1.7 · AltStore");
  const rows = appListRows([
    { id: "delta", name: "Delta", version: "1.6", actual: "1.6", remembered: "1.5", date: 2 },
    { id: "gone", name: "Gone", version: "2.0", actual: null, remembered: "2.0", date: 1 },
    { id: "plain", name: "Plain", version: "1.0", date: 3 }, // site/sideload record, no I4 fields
  ], () => ({ version: "9" }));
  assert.deepEqual(rows.map((x) => [x.id, x.upgrade]), [["plain", "9"], ["delta", "9"], ["gone", null]]);
});
