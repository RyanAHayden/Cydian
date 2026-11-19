// F178: iFizBox's own sources at its domain (https://<DOMAIN>/repo/ and /repo/source.json), and lite and full kept
// apart: the sideload app shows only the IPA, the jailbreak app only the .deb, the website both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMAIN, BUNDLE_ID } from "../brand.js";
import { APP_SOURCE_URL, APP_APT_REPO, ownBuilds, hiddenAltApps, homeOffer } from "./appoffer.js";
import { SELF_ALT_URL, SELF_APT_URI, builtinSources } from "./essential.js";
import { loadAppSources } from "./sources.js";

const DEFAULT_ALT_SOURCES = await loadAppSources(); // web/app/app-sources.json
import { createCatalog } from "./catalog.js";

const SOURCE = readFileSync(new URL("../source.json", import.meta.url), "utf8");

test("F178: the AltStore source is https://<DOMAIN>/repo/source.json everywhere, beside the APT repo", () => {
  const url = `https://${DOMAIN}/repo/source.json`;
  assert.equal(APP_SOURCE_URL, url);
  assert.equal(SELF_ALT_URL, url);
  assert.equal(DEFAULT_ALT_SOURCES[0], url);
  assert.equal(JSON.parse(SOURCE).sourceURL, url);
  assert.equal(APP_APT_REPO, `https://${DOMAIN}/repo/`);
  assert.equal(SELF_APT_URI, APP_APT_REPO);
  assert.ok(![APP_SOURCE_URL, SELF_ALT_URL, ...DEFAULT_ALT_SOURCES.slice(0, 1)].some((u) => u.includes("raw.githubusercontent.com")));
  // each build's built-in: the APT repo in the jailbreak app, the AltStore source elsewhere
  assert.equal(builtinSources("jailbreak")[0].uri, APP_APT_REPO);
  assert.equal(builtinSources("sideload")[0].uri, url);
  assert.equal(builtinSources("site")[0].uri, url);
});

test("F178: ownBuilds: lite the IPA only, full the .deb and APT repo only, the site both", () => {
  assert.deepEqual(ownBuilds("sideload"), { ipa: true, deb: false, aptRepo: false });
  assert.deepEqual(ownBuilds("jailbreak"), { ipa: false, deb: true, aptRepo: true });
  assert.deepEqual(ownBuilds("site"), { ipa: true, deb: true, aptRepo: true });
  assert.deepEqual(hiddenAltApps("jailbreak"), [BUNDLE_ID]);
  assert.deepEqual(hiddenAltApps("sideload"), []);
  assert.deepEqual(hiddenAltApps("site"), []);
  // the install tile (IPA or .deb) is the website's only
  assert.equal(homeOffer({ mode: "sideload" }), null);
  assert.equal(homeOffer({ mode: "jailbreak", deviceType: "iphoneos-arm64" }), null);
  assert.deepEqual(homeOffer({ mode: "site" }), { action: "sideloaders" });
});

test("F178: the jailbreak app's catalog never lists the lite IPA from an AltStore source; the others do", () => {
  const other = { name: "Other", bundleIdentifier: "com.example.other", versions: [{ version: "1.0", date: "2026-11-01", downloadURL: "https://example.com/o.ipa", size: 10 }] };
  const json = JSON.parse(SOURCE);
  json.apps.push(other);
  json.featuredApps = [BUNDLE_ID, "com.example.other"];
  for (const mode of ["jailbreak", "sideload", "site"]) {
    const c = createCatalog();
    const count = c.loadAlt("alt:" + APP_SOURCE_URL, JSON.stringify(json), "17.0", null, hiddenAltApps(mode));
    const own = c.package(BUNDLE_ID);
    if (mode === "jailbreak") {
      assert.equal(count, 1, mode);
      assert.ok(!own, "the jailbreak app hides the lite IPA");
      assert.deepEqual(c.altSource("alt:" + APP_SOURCE_URL).featured.map((r) => r.id), ["com.example.other"]);
    } else {
      assert.equal(count, 2, mode);
      assert.ok(own, `${mode} lists iFizBox's IPA`);
    }
    assert.ok(c.package("com.example.other"), mode);
  }
});

test("F178: Home's Install Full tile is the website's only (screens/home.js asks ownBuilds)", () => {
  const home = readFileSync(new URL("../screens/home.js", import.meta.url), "utf8");
  assert.match(home, /const debTile = settings\.mode === "site" && ownBuilds\(settings\.mode\)\.deb \?/);
  const catalogUi = readFileSync(new URL("../catalog.js", import.meta.url), "utf8");
  assert.match(catalogUi, /"loadAlt", \[[^\]]*hiddenAltApps\(detectMode\(\)\)\]/);
});
