// B269: entries that can't be signed and installed stay out of the sideload build's lists, Search and source lists,
// by the same check the install page's appJob makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signableApp, signableDownload } from "./altstore.js";
import { createCatalog, ALL } from "./catalog.js";
import { appJob } from "./appqueue.js";

const app = (name, version, extra = {}) => ({
  name, bundleIdentifier: `dev.mixed.${name.toLowerCase().replace(/\W/g, "")}`, developerName: "Mixed", localizedDescription: `${name} app`,
  versions: [{ version: "1.0", date: "2026-11-01", ...version }], ...extra,
});
const MIXED = {
  name: "Mixed Source", identifier: "dev.mixed",
  apps: [
    app("Good", { downloadURL: "https://example.dev/good.ipa" }),
    app("Release", { downloadURL: "https://github.com/a/b/releases/download/v1/build" }), // no .ipa extension: still an IPA
    app("NoDownload", {}),
    app("ManifestOnly", { manifestURL: "https://example.dev/manifest.plist" }),
    app("ItmsLink", { downloadURL: "itms-services://?action=download-manifest&url=https://example.dev/m.plist" }),
    app("TweakDeb", { downloadURL: "https://repo.example.dev/debs/com.x.tweak_1.0_iphoneos-arm64.deb" }),
    app("StoreLink", { downloadURL: "https://apps.apple.com/us/app/example/id123456789" }),
    app("WebClip", { downloadURL: "https://example.dev/clip.mobileconfig" }),
    app("NeedsNewer", { downloadURL: "https://example.dev/new.ipa", minOSVersion: "28.0" }),
  ],
};
const KEY = "alt:https://example.dev/mixed.json";
const SIGNABLE = ["Good", "Release"];

function loaded(jailbreak = "none") {
  const c = createCatalog();
  c.setDevice({ ios: "27.0", jailbreak }, { filter: false });
  c.loadAlt(KEY, JSON.stringify(MIXED), "27.0");
  return c;
}
const names = (rows) => rows.map((r) => r.name).sort();

test("B269 signableDownload: an http(s) IPA; not a .deb, an App Store page, a web clip or nothing", () => {
  assert.equal(signableDownload("https://x.dev/a.ipa").ok, true);
  assert.equal(signableDownload("https://x.dev/dl?id=4").ok, true);
  assert.equal(signableDownload(null).why, "no-ipa");
  assert.equal(signableDownload("itms-services://?action=download-manifest").why, "no-ipa");
  assert.equal(signableDownload("https://x.dev/t.deb").why, "deb");
  assert.equal(signableDownload("https://x.dev/T%2Edeb").why, "deb");
  assert.equal(signableDownload("https://itunes.apple.com/app/id1").why, "app-store");
  assert.equal(signableDownload("https://x.dev/c.mobileconfig").why, "web-clip");
  assert.equal(signableApp({ kind: undefined, package: "x" }).ok, false);
});

test("B269: the sideload build's source list, All Sources and Search keep only apps it can sign", () => {
  const c = loaded("none");
  assert.deepEqual(names(c.list(KEY)), SIGNABLE);
  assert.deepEqual(names(c.list(ALL)), SIGNABLE);
  assert.deepEqual(names(c.search("app")), SIGNABLE);
  assert.deepEqual(names(c.search("tweakdeb")), []);
  assert.deepEqual(names(c.free("apps")), SIGNABLE);
  assert.equal(c.altSource(KEY).count, SIGNABLE.length);
  assert.equal(c.sections(KEY).total, SIGNABLE.length);
});

test("B269: every row a list keeps queues an install job; every row it hides would be refused by Install", () => {
  const c = loaded("none");
  const shown = new Set(c.list(KEY).map((r) => r.id));
  for (const a of MIXED.apps) {
    const pkg = c.package(a.bundleIdentifier, KEY);
    const job = pkg?.stanza ? appJob(pkg) : null;
    assert.equal(Boolean(job), shown.has(a.bundleIdentifier), a.name);
  }
});

test("B269: a jailbroken phone's lists are as before (only the iOS range drops an entry)", () => {
  const c = loaded("rootless");
  assert.equal(c.list(KEY).length, MIXED.apps.length - 1);
  assert.ok(!c.list(KEY).some((r) => r.name === "NeedsNewer"));
});
