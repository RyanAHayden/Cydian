// I7: when the website offers the Cydian app (core/appoffer.js): Home's tile, in the app or not, Not Jailbroken or
// not. F89: no certificate on the website, so Not Jailbroken always gets the sideloaders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeOffer, debUrl, debAlert, APP_IPA_URL, APP_DEB_URL, APP_SOURCE_URL } from "./appoffer.js";
import { parseRelease, debFor } from "./selfupdate.js";
import { DEFAULT_ALT_SOURCES } from "./sources.js";

test("Home: Not Jailbroken on the site, the tile hands Cydian to a sideloader (F89)", () => {
  assert.deepEqual(homeOffer({ mode: "site", deviceType: "none" }), { action: "sideloaders" });
  assert.deepEqual(homeOffer(), { action: "sideloaders" });
});

test("Home: jailbroken on the site, the tile is the .deb for the arch", () => {
  for (const arch of ["iphoneos-arm64", "iphoneos-arm", "iphoneos-arm64e"]) {
    assert.deepEqual(homeOffer({ mode: "site", deviceType: arch }), { action: "deb", arch });
  }
});

test("Home: nothing inside the app, either build, whatever the device", () => {
  for (const mode of ["sideload", "jailbreak"]) {
    for (const deviceType of ["none", "iphoneos-arm64"]) assert.equal(homeOffer({ mode, deviceType }), null);
  }
});

test("the .deb: the release's asset for the arch, else rootless Cydian.deb, else none", () => {
  const release = parseRelease({ tag_name: "v0.2.0", assets: [
    { name: "Cydian.ipa", browser_download_url: "https://x/Cydian.ipa" },
    { name: "Cydian.deb", browser_download_url: "https://x/Cydian.deb" },
    { name: "com.ryha.cydian_0.2.0_iphoneos-arm64e.deb", browser_download_url: "https://x/roothide.deb" },
  ] });
  assert.equal(debUrl("iphoneos-arm64", { release, debFor }), "https://x/Cydian.deb");
  assert.equal(debUrl("iphoneos-arm64e", { release, debFor }), "https://x/roothide.deb");
  assert.equal(debUrl("iphoneos-arm", { release, debFor }), null);
  assert.equal(debUrl("iphoneos-arm64"), APP_DEB_URL); // GitHub didn't answer
  assert.equal(debUrl("iphoneos-arm"), null);
  assert.deepEqual(debAlert("iphoneos-arm64", APP_DEB_URL).buttons, ["Cancel", "Download"]);
  assert.match(debAlert("iphoneos-arm", null).message, /rootful/);
});

test("the IPA and the source: the release's latest Cydian.ipa, Cydian's source first among the defaults", () => {
  assert.match(APP_IPA_URL, /\/releases\/latest\/download\/Cydian\.ipa$/);
  assert.equal(DEFAULT_ALT_SOURCES[0], APP_SOURCE_URL);
});
