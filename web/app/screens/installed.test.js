import { test } from "node:test";
import assert from "node:assert/strict";
import { pageKind, recordsApps, appSubtitle, DPKG } from "./installed.js";

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
