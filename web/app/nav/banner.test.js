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
  for (const f of ["../screens/importlink.js", "../signing/route.js"]) {
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

// B62: on launch the refresh-failure banner hid "iFizBox X is out." before its Upgrade could be tapped. Banners queue.
import { bannerQueue, MAX_WAITING } from "./banner.js";

function fakePresent() {
  const up = [];       // the banners drawn, in order
  const live = new Map();
  const present = (opts, left) => {
    up.push(opts.message);
    const hide = () => { if (live.delete(hide)) left(); };
    live.set(hide, opts.message);
    return hide;
  };
  const onScreen = () => [...live.values()];
  const end = () => [...live.keys()].at(-1)();   // the newest banner up goes (its timer, a tap, a swipe)
  return { present, up, onScreen, end };
}

test("two banners in a row both get shown, the second once the first has gone", () => {
  const p = fakePresent();
  const show = bannerQueue(p.present);
  show({ title: "iFizBox", message: "iFizBox 1.2 is out.", action: { label: "Upgrade" } });
  show({ title: "Source Failed to Refresh", message: "palera1n" });
  assert.deepEqual(p.onScreen(), ["iFizBox 1.2 is out."], "the update banner stays up");
  p.end();
  assert.deepEqual(p.onScreen(), ["palera1n"]);
  p.end();
  assert.deepEqual(p.onScreen(), []);
  assert.deepEqual(p.up, ["iFizBox 1.2 is out.", "palera1n"]);
});

test("a waiting banner's hide takes it out of the queue; the same banner twice is queued once", () => {
  const p = fakePresent();
  const show = bannerQueue(p.present);
  show({ title: "A", message: "a" });
  const hideB = show({ title: "B", message: "b" });
  show({ title: "B", message: "b" });
  show({ title: "C", message: "c" });
  hideB();
  p.end();
  p.end();
  assert.deepEqual(p.up, ["a", "c"]);
});

test("a Press banner goes up at once and the timed one it pushed off comes back after it", () => {
  const p = fakePresent();
  const show = bannerQueue(p.present);
  show({ title: "iFizBox", message: "iFizBox 1.2 is out." });
  show({ title: "iFizBox", message: "Press Install.", wait: true });
  assert.deepEqual(p.onScreen(), ["Press Install."]);
  p.end();
  assert.deepEqual(p.onScreen(), ["iFizBox 1.2 is out."]);
  p.end();
  assert.deepEqual(p.up, ["iFizBox 1.2 is out.", "Press Install.", "iFizBox 1.2 is out."]);
});

test("the queue holds a few banners and drops the rest", () => {
  const p = fakePresent();
  const show = bannerQueue(p.present);
  for (let i = 0; i <= MAX_WAITING + 2; i++) show({ title: "T", message: `m${i}` });
  while (p.onScreen().length) p.end();
  assert.equal(p.up.length, 1 + MAX_WAITING);
});
