// F204: the banner no longer pushes the page, and goes by itself (5 s, 8 s with an action) unless it waits for iOS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bannerTime, AUTO_MS, ACTION_MS } from "./banner.js";

test("a banner goes by itself after 5 s, 8 s with an action, the caller's duration when given", () => {
  assert.equal(AUTO_MS, 5000);
  assert.equal(ACTION_MS, 8000);
  assert.equal(bannerTime({}), AUTO_MS);
  assert.equal(bannerTime({ action: { label: "Upgrade" } }), ACTION_MS);
  assert.equal(bannerTime({ duration: 6000 }), 6000);
});

test("a banner that waits for iOS has no timer", () => {
  assert.equal(bannerTime({ wait: true }), 0);
  assert.equal(bannerTime({ wait: true, duration: 6000 }), 0);
});

test("the banners that tell the user which button to press in iOS's prompt wait for it", () => {
  for (const f of ["../screens/importlink.js", "../signing-client.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const calls = [...src.matchAll(/showBanner\(\{[^\n]*?Press (Open|Install)[^\n]*?\}\);/g)];
    assert.ok(calls.length, `${f}: the Press banner`);
    for (const m of calls) assert.match(m[0], /wait:\s*true/, f);
  }
});

test("the banner moves nothing on the page and animates only transform", () => {
  const src = readFileSync(new URL("./banner.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /has-banner|--banner-h|classList/);
  for (const m of src.matchAll(/\.animate\(\[([^\]]*)\]/g)) assert.doesNotMatch(m[1], /\b(?!transform\b)\w+\s*:/, m[1]);
});
