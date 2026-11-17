import { test } from "node:test";
import assert from "node:assert/strict";
import { launchURL, isStandaloneWeb, navigationType } from "./launch.js";

function win({ standalone = "media", type = "navigate", url = "https://cydian.dev/#/sources/x", native = false } = {}) {
  const u = new URL(url);
  return {
    location: { pathname: u.pathname, search: u.search, hash: u.hash },
    matchMedia: (q) => ({ matches: standalone === "media" && q === "(display-mode: standalone)" }),
    navigator: { standalone: standalone === "apple" },
    performance: { getEntriesByType: (k) => (k === "navigation" && type ? [{ type }] : []) },
    ...(native ? { cydianApp: {} } : {}),
  };
}

test("fresh standalone launch opens Home, whatever page it was added from", () => {
  assert.equal(launchURL(win()), "/#/home");
  assert.equal(launchURL(win({ standalone: "apple" })), "/#/home"); // older iOS: navigator.standalone only
  assert.equal(launchURL(win({ url: "https://cydian.dev/" })), "/#/home");
  assert.equal(launchURL(win({ url: "https://cydian.dev/#/home" })), null); // already there
});

test("a reload or back/forward in the standalone app keeps the route", () => {
  assert.equal(launchURL(win({ type: "reload" })), null);
  assert.equal(launchURL(win({ type: "back_forward" })), null);
});

test("resume from the background keeps the route", () => {
  assert.equal(launchURL(win({ url: "https://cydian.dev/#/changes" }), { resumed: true }), null);
  assert.equal(launchURL(win({ url: "https://cydian.dev/#/sources/x" }), { resumed: true }), null);
});

test("Safari tabs and the native app keep the URL", () => {
  assert.equal(launchURL(win({ standalone: false })), null);
  assert.equal(launchURL(win({ native: true })), null);
});

test("a notification tap keeps its page and drops the mark", () => {
  assert.equal(launchURL(win({ url: "https://cydian.dev/?launch=push#/changes" })), "/#/changes");
  assert.equal(launchURL(win({ standalone: false, url: "https://cydian.dev/?launch=push&a=1#/settings" })), "/?a=1#/settings");
});

test("navigationType falls back to performance.navigation", () => {
  assert.equal(navigationType({ performance: { navigation: { type: 1 } } }), "reload");
  assert.equal(navigationType({ performance: { navigation: { type: 0 } } }), "navigate");
  assert.equal(navigationType({}), null);
  assert.equal(isStandaloneWeb({ navigator: { standalone: true }, cydianNative: {} }), false);
});
