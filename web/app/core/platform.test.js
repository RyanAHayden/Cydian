import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as storage } from "../test-fakes.js";
import { notIphoneKind, notIphonePage, dismissNotIphone, notIphoneText, DISMISS_KEY } from "./platform.js";
import { NAME } from "../brand.js";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ asks for the desktop site by default: the Mac's user agent, told apart only by its touch points
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  chromeos: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  // the native app's WKWebView: an iPhone's own user agent, and its bridge
  app: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
};

test("iPhone, iPad and iPadOS's desktop user agent get the app", () => {
  assert.equal(notIphoneKind({ userAgent: UA.iphone, maxTouchPoints: 5 }), null);
  assert.equal(notIphoneKind({ userAgent: UA.ipad, maxTouchPoints: 5 }), null);
  assert.equal(notIphoneKind({ userAgent: UA.mac, maxTouchPoints: 5 }), null);
});

test("Mac, Windows, Linux, ChromeOS and Android get the page", () => {
  assert.equal(notIphoneKind({ userAgent: UA.mac, maxTouchPoints: 0 }), "mac");
  assert.equal(notIphoneKind({ userAgent: UA.mac }), "mac");
  assert.equal(notIphoneKind({ userAgent: UA.windows, maxTouchPoints: 10 }), "pc"); // a touch-screen PC is still a PC
  assert.equal(notIphoneKind({ userAgent: UA.linux, maxTouchPoints: 0 }), "pc");
  assert.equal(notIphoneKind({ userAgent: UA.chromeos, maxTouchPoints: 0 }), "pc");
  assert.equal(notIphoneKind({ userAgent: UA.android, maxTouchPoints: 5 }), "android");
});

test("the native app always gets the app, whatever its user agent says", () => {
  assert.equal(notIphoneKind({ userAgent: UA.app, maxTouchPoints: 5 }, { native: true }), null);
  assert.equal(notIphoneKind({ userAgent: UA.mac, maxTouchPoints: 0 }, { native: true }), null);
  assert.equal(notIphonePage({ navigator: { userAgent: UA.app, maxTouchPoints: 5 }, ifizboxNative: {} }), null);
  assert.equal(notIphonePage({ navigator: { userAgent: UA.mac }, ifizboxApp: {} }), null);
});

test("an unknown user agent (crawler, link preview, none) gets the app", () => {
  assert.equal(notIphoneKind({ userAgent: "facebookexternalhit/1.1" }), null);
  assert.equal(notIphoneKind({ userAgent: "" }), null);
  assert.equal(notIphoneKind(undefined), null);
});

test("Look Around Anyway is remembered in ifizbox.* storage", () => {
  assert.ok(DISMISS_KEY.startsWith("ifizbox."));
  const win = { navigator: { userAgent: UA.windows, maxTouchPoints: 0 }, localStorage: storage() };
  assert.equal(notIphonePage(win), "pc");
  dismissNotIphone(win);
  assert.equal(win.localStorage.m.get(DISMISS_KEY), "1");
  assert.equal(notIphonePage(win), null);
});

test("storage that throws (private mode) still shows the page and doesn't break dismissal", () => {
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const win = { navigator: { userAgent: UA.android }, localStorage: bad };
  assert.equal(notIphonePage(win), "android");
  assert.doesNotThrow(() => dismissNotIphone(win));
  assert.equal(notIphonePage({ navigator: { userAgent: UA.mac } }), "mac"); // no storage at all
});

test("each kind names its device, and the name comes from brand.js", () => {
  assert.equal(notIphoneText("mac", NAME).title, `Open ${NAME} on Your iPhone`);
  assert.match(notIphoneText("mac", NAME).why, /this Mac can't run it/);
  assert.match(notIphoneText("pc", NAME).why, /this PC can't run it/);
  assert.match(notIphoneText("android", NAME).why, /Android phones can't run it/);
  assert.match(notIphoneText("pc", "Zed").why, /^Zed /);
});
