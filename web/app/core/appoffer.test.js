// I7: when the website offers the Cydian app (core/appoffer.js): Home's tile, the Signing page's row and the alert
// after an import, by certificate set or not, in the app or not, Not Jailbroken or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeOffer, signingRowShows, offerAfterImport, certificateWorks, debUrl, debAlert, IMPORT_ALERT,
  APP_IPA_URL, APP_DEB_URL, APP_SOURCE_URL } from "./appoffer.js";
import { parseRelease, debFor } from "./selfupdate.js";
import { DEFAULT_ALT_SOURCES } from "./sources.js";

const bytes = new Uint8Array([0x30]);
const works = { p12: bytes, profile: bytes, passwordOk: true };

test("Home: Not Jailbroken on the site, the tile signs and installs with a certificate, opens Signing without", () => {
  assert.deepEqual(homeOffer({ mode: "site", deviceType: "none", certificate: true }), { action: "install" });
  assert.deepEqual(homeOffer({ mode: "site", deviceType: "none", certificate: false }), { action: "signing", href: "#/settings/signing" });
});

test("Home: jailbroken on the site, the tile is the .deb for the arch, certificate or not", () => {
  for (const arch of ["iphoneos-arm64", "iphoneos-arm", "iphoneos-arm64e"]) {
    for (const certificate of [true, false]) {
      assert.deepEqual(homeOffer({ mode: "site", deviceType: arch, certificate }), { action: "deb", arch });
    }
  }
});

test("Home: nothing inside the app, either build, whatever the certificate or device", () => {
  for (const mode of ["sideload", "jailbreak"]) {
    for (const deviceType of ["none", "iphoneos-arm64"]) {
      for (const certificate of [true, false]) assert.equal(homeOffer({ mode, deviceType, certificate }), null);
    }
  }
});

test("a certificate works with a .p12, a profile and a password not known to be wrong", () => {
  assert.equal(certificateWorks(null), false);
  assert.equal(certificateWorks({ p12: bytes }), false);
  assert.equal(certificateWorks({ profile: bytes }), false);
  assert.equal(certificateWorks({ p12: bytes, profile: bytes, passwordOk: false }), false);
  assert.equal(certificateWorks({ p12: bytes, profile: bytes, passwordOk: null }), true); // the server checks it
  assert.equal(certificateWorks(works), true);
});

test("Signing page: the green row shows on the site once the certificate works, never in the app", () => {
  assert.equal(signingRowShows({ mode: "site", identity: works }), true);
  assert.equal(signingRowShows({ mode: "site", identity: null }), false);
  assert.equal(signingRowShows({ mode: "site", identity: { ...works, passwordOk: false } }), false);
  assert.equal(signingRowShows({ mode: "sideload", identity: works }), false);
  assert.equal(signingRowShows({ mode: "jailbreak", identity: works }), false);
});

test("the alert asks once, on the import that made the certificate work", () => {
  assert.equal(offerAfterImport({ mode: "site", before: null, after: works }), true);
  assert.equal(offerAfterImport({ mode: "site", before: { p12: bytes, profile: bytes, passwordOk: false }, after: works }), true);
  assert.equal(offerAfterImport({ mode: "site", before: works, after: works }), false); // already worked
  assert.equal(offerAfterImport({ mode: "site", before: null, after: { p12: bytes } }), false); // not complete yet
  assert.equal(offerAfterImport({ mode: "site", before: null, after: { ...works, passwordOk: false } }), false);
  assert.equal(offerAfterImport({ mode: "sideload", before: null, after: works }), false);
  assert.deepEqual(IMPORT_ALERT.buttons, ["Not Now", "Install"]);
  assert.match(IMPORT_ALERT.message, /^Your certificate works\. Install the Cydian app/);
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
