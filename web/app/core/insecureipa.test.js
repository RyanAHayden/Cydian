// B104: plain-http IPA links: the URL rules, the alert's words, and our words for ATS refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHttpIpa, httpsTwin, INSECURE_IPA_ALERT, INSTALL_ANYWAY, isInsecure, isAts, ATS_TITLE, atsText, insecureText } from "./insecureipa.js";
import { deviceError } from "./signing.js";
import { ipaError } from "./ipainstall.js";
import { NAME } from "../brand.js";

test("isHttpIpa: http links only", () => {
  assert.equal(isHttpIpa("http://e.example/a.ipa"), true);
  assert.equal(isHttpIpa("HTTP://e.example/a.ipa"), true);
  assert.equal(isHttpIpa("  http://e.example/a.ipa "), true);
  assert.equal(isHttpIpa("https://e.example/a.ipa"), false);
  assert.equal(isHttpIpa("http://"), false);
  assert.equal(isHttpIpa("ftp://e.example/a.ipa"), false);
  assert.equal(isHttpIpa(null), false);
});

test("httpsTwin: the same link over https, port 80 dropped, others kept", () => {
  assert.equal(httpsTwin("http://e.example/dir/a.ipa?x=1#f"), "https://e.example/dir/a.ipa?x=1#f");
  assert.equal(httpsTwin("http://e.example:80/a.ipa"), "https://e.example/a.ipa");
  assert.equal(httpsTwin("http://127.0.0.1:8099/a%20b.ipa"), "https://127.0.0.1:8099/a%20b.ipa");
  assert.equal(httpsTwin("https://e.example/a.ipa"), null);
  assert.equal(httpsTwin("not a link"), null);
});

test("the alert: Zebra-style words, Cancel the darker safe button, Install Anyway second", () => {
  assert.equal(INSECURE_IPA_ALERT.title, "This Download Is Not Secure");
  assert.equal(INSECURE_IPA_ALERT.message,
    `The app is sent without encryption, and someone on the same network could change it before ${NAME} signs it. Install anyway?`);
  assert.deepEqual(INSECURE_IPA_ALERT.buttons, ["Cancel", "Install Anyway"]);
  assert.equal(INSECURE_IPA_ALERT.cancel, 0);
  assert.equal(INSECURE_IPA_ALERT.buttons[INSTALL_ANYWAY], "Install Anyway");
});

const raw = "The resource could not be loaded because the App Transport Security policy requires the use of a secure connection.";

test("isInsecure / isAts: the shell's codes, and iOS's raw sentence from an older shell", () => {
  assert.equal(isInsecure({ code: "insecure" }), true);
  assert.equal(isInsecure({ code: "network" }), false);
  assert.equal(isAts({ code: "ats", message: "x" }), true);
  assert.equal(isAts({ code: "network", message: raw }), true);
  assert.equal(isAts(new Error(`network: ${raw}`)), true);
  assert.equal(isAts({ code: "network", message: "An SSL error has occurred and a secure connection to the server cannot be made." }), false);
});

test("deviceError: never iOS's raw ATS text; insecure where nothing asked says what it means", () => {
  for (const e of [{ code: "network", message: raw }, { code: "ats", message: "the link leads to a plain http address (e.example), which iOS blocks here" }]) {
    const why = deviceError(e, "Delta");
    assert.equal(why.title, ATS_TITLE);
    assert.equal(why.message, atsText("Delta"));
    assert.doesNotMatch(why.message, /App Transport Security/);
  }
  const why = deviceError({ code: "insecure", message: "e.example offers this IPA only over plain http" }, "Delta");
  assert.equal(why.title, "This Download Is Not Secure");
  assert.equal(why.message, insecureText("Delta"));
  assert.equal(deviceError({ code: "network", message: "the server answered 404" }, "D").message, "The server answered 404");
});

test("ipaError (jailbreak build): an ATS refusal gets our words too", () => {
  const e = ipaError(Object.assign(new Error(`network: ${raw}`), { code: "network" }), "Delta");
  assert.equal(e.title, ATS_TITLE);
  assert.equal(e.message, atsText("Delta"));
  assert.equal(ipaError(new Error("network: offline"), "Delta").message, `${NAME} couldn't download Delta: offline.`);
});
