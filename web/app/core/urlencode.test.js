// B149: a source's URL with a raw space (YouMod's iconURL ".../assets/YouTube Icon.png") is percent-encoded where
// URLs come in (core/altstore.js httpUrl), and again before an <img> (mediaUrl) or the shell (iconBytes), never
// encoded twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeUrl } from "./urlencode.js";
import { parseAltSource, httpUrl } from "./altstore.js";

const RAW = "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/assets/YouTube Icon.png";
const ENC = "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/assets/YouTube%20Icon.png";

test("encodeUrl: a raw space becomes %20, an existing %20 stays", () => {
  assert.equal(encodeUrl(RAW), ENC);
  assert.equal(encodeUrl(ENC), ENC);
  assert.equal(encodeUrl(encodeUrl(RAW)), ENC);
  assert.equal(encodeUrl(`  ${RAW}\n`), ENC);
});

test("encodeUrl: other characters a URL can't hold, and a stray %", () => {
  assert.equal(encodeUrl("https://a.dev/100% done.png"), "https://a.dev/100%25%20done.png");
  assert.equal(encodeUrl("https://a.dev/x.png?a=1&b=c d#f"), "https://a.dev/x.png?a=1&b=c%20d#f");
  assert.equal(encodeUrl('https://a.dev/"{x}"[1]|^`\\<>'), "https://a.dev/%22%7Bx%7D%22%5B1%5D%7C%5E%60%5C%3C%3E");
  assert.equal(encodeUrl("https://a.dev/café.png"), "https://a.dev/caf%C3%A9.png");
  assert.equal(encodeUrl("https://[::1]:8080/a b"), "https://[::1]:8080/a%20b"); // the host is left as written
  assert.equal(encodeUrl("https://a.dev"), "https://a.dev");
  assert.equal(encodeUrl("not a url"), "not a url");
  assert.equal(encodeUrl(null), "");
});

test("httpUrl takes a URL with a space after the host, and still refuses one in the host", () => {
  assert.equal(httpUrl(RAW), ENC);
  assert.equal(httpUrl(ENC), ENC);
  assert.equal(httpUrl("https://a b.dev/x.png"), null);
  assert.equal(httpUrl("javascript:alert(1)"), null);
});

test("parseAltSource: YouMod's iconURL with a space comes through encoded (source, app, screenshots, IPA)", () => {
  const s = parseAltSource({
    name: "Penguin", iconURL: RAW,
    apps: [{ name: "YouMod", bundleIdentifier: "com.google.ios.youtube", iconURL: RAW, screenshots: [RAW, { imageURL: RAW }],
      versions: [{ version: "1.0", downloadURL: "https://a.dev/ipas/You Mod.ipa" }] },
    { name: "Other", bundleIdentifier: "b", iconURL: ENC, versions: [{ version: "1", downloadURL: "https://a.dev/b.ipa" }] }],
  });
  assert.equal(s.iconURL, ENC);
  const [a, b] = s.apps;
  assert.equal(a.iconURL, ENC);
  assert.deepEqual(a.screenshots.map((x) => x.url), [ENC, ENC]);
  assert.equal(a.versions[0].downloadURL, "https://a.dev/ipas/You%20Mod.ipa");
  assert.equal(b.iconURL, ENC);
});

test("backend-native iconBytes hands the shell the encoded URL (iOS 15's URL(string:) refuses a space)", async () => {
  const { createNativeBackend } = await import("../backend-native.js");
  const asked = [];
  const native = {
    call: async (method, params) => {
      if (method === "net.icon") { asked.push(params.url); return { type: "image/png", body: btoa("\x89PNG\r\n\x1a\n") }; }
      return null;
    },
  };
  const b = createNativeBackend({ native, sourceOptions: { mode: "jailbreak", indexedDB: null, coreFoundation: () => "1800" } });
  await b.iconBytes(RAW);
  await b.iconBytes(ENC);
  assert.deepEqual(asked, [ENC, ENC]);
});
