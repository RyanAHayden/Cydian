// F270: pull to refresh's arm/release logic (nav/pullrefresh.js): where it arms, that a release under the trigger or
// while a refresh runs does nothing, the rubber band, the Last Updated line, and that every page with a Refresh /
// Reload nav button wires it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pullState, pullTracker, rubber, lastUpdatedText, TRIGGER, TEXT } from "./pullrefresh.js";
import { createSettings } from "../core/settings.js";

test("pullState: idle at rest, pull under the trigger, armed from it on; idle while busy", () => {
  assert.equal(pullState(0), "idle");
  assert.equal(pullState(-12), "idle");
  assert.equal(pullState(1), "pull");
  assert.equal(pullState(TRIGGER - 0.5), "pull");
  assert.equal(pullState(TRIGGER), "armed");
  assert.equal(pullState(300), "armed");
  assert.equal(pullState(300, { busy: true }), "idle");
  assert.equal(TRIGGER, 60);
});

function run({ busyAtStart = false, busyAtEnd = false, pulls }) {
  let busy = busyAtStart;
  const states = [];
  let refreshed = 0;
  const t = pullTracker({ busy: () => busy, onRefresh: () => refreshed++, onState: (s) => states.push(s) });
  t.start();
  busy = busyAtEnd;
  for (const p of pulls) t.move(p);
  const went = t.end();
  return { went, refreshed, states, t };
}

test("release past the trigger runs the refresh once; the arrow flips on the way and back after", () => {
  const r = run({ pulls: [10, 40, 59, 61, 90] });
  assert.equal(r.went, true);
  assert.equal(r.refreshed, 1);
  assert.deepEqual(r.states, ["pull", "armed", "idle"]);
  assert.equal(r.t.state, "idle");
});

test("pulled past the trigger, then back under it before letting go: springs back, nothing runs", () => {
  const r = run({ pulls: [30, 80, 50] });
  assert.equal(r.went, false);
  assert.equal(r.refreshed, 0);
  assert.deepEqual(r.states, ["pull", "armed", "pull", "idle"]);
});

test("release under the trigger runs nothing", () => {
  assert.equal(run({ pulls: [20, 59] }).refreshed, 0);
});

test("a pull while a refresh runs does nothing: never arms, never runs", () => {
  const r = run({ busyAtStart: true, busyAtEnd: true, pulls: [30, 120] });
  assert.equal(r.refreshed, 0);
  assert.deepEqual(r.states, []);
  // a refresh that ended mid-pull still doesn't make that pull count
  assert.equal(run({ busyAtStart: true, pulls: [30, 120] }).refreshed, 0);
  // one that started mid-pull (the nav button, launch) stops the release too
  assert.equal(run({ busyAtEnd: true, pulls: [30, 120] }).refreshed, 0);
});

test("a cancelled touch, or an end without a start, runs nothing", () => {
  let n = 0;
  const t = pullTracker({ onRefresh: () => n++ });
  assert.equal(t.end(), false);
  t.start(); t.move(100); t.cancel();
  assert.equal(t.end(), false);
  assert.equal(n, 0);
  assert.equal(t.state, "idle");
});

test("rubber band: follows less the farther it goes, never past its box, 0 for a push", () => {
  assert.equal(rubber(0), 0);
  assert.equal(rubber(-40), 0);
  const a = rubber(50, 600), b = rubber(100, 600), c = rubber(150, 600);
  assert.ok(a > 0 && a < 50);
  assert.ok(b - a > c - b); // damped: each 50px of finger moves it less
  assert.ok(rubber(100000, 600) < 600);
  // a pull that arms takes a real drag: well past the trigger's 60pt of finger travel
  let dy = 0;
  while (rubber(dy, 700) < TRIGGER) dy++;
  assert.ok(dy > 60 && dy < 140, `arms at ${dy}px of finger travel`);
});

test("Last Updated: today, yesterday, this year, another year, never", () => {
  const now = new Date(2026, 10, 19, 17, 30);
  assert.equal(lastUpdatedText(new Date(2026, 10, 19, 15, 14).getTime(), now), "Last Updated: Today 3:14 PM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 19, 0, 5).getTime(), now), "Last Updated: Today 12:05 AM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 18, 9, 5).getTime(), now), "Last Updated: Yesterday 9:05 AM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 3, 12, 0).getTime(), now), "Last Updated: Nov 3 12:00 PM");
  assert.equal(lastUpdatedText(new Date(2025, 0, 2, 12, 0).getTime(), now), "Last Updated: Jan 2, 2025");
  assert.equal(lastUpdatedText(null, now), "Last Updated: Never");
  assert.equal(TEXT.pull, "Pull down to refresh...");
  assert.equal(TEXT.armed, "Release to refresh...");
});

test("settings.lastRefresh keeps the time on the device", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const s = createSettings({ storage });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  assert.equal(s.lastRefresh.get(), null);
  s.lastRefresh.set(1763565240000);
  assert.equal(s.lastRefresh.get(), 1763565240000);
  assert.equal(createSettings({ storage }).lastRefresh.get(), 1763565240000);
  assert.deepEqual(heard, [["lastRefresh", 1763565240000]]);
});

test("Sources, Changes and Home pull to refresh into their nav button's own refresh", () => {
  const src = (f) => readFileSync(new URL(`../screens/${f}`, import.meta.url), "utf8");
  assert.match(src("sources.js"), /pullToRefresh\(state\.box\.parentNode, \{ onRefresh: \(\) => refresh\(state\.ctx\)/);
  assert.match(src("changes.js"), /pullToRefresh\(state\.results, \{ onRefresh: \(\) => refresh\(ctx\)/);
  assert.match(src("home.js"), /pullToRefresh\(body, \{ onRefresh: \(\) => state\.reloadButton\?\.click\(\)/);
  assert.match(src("home.js"), /label: "Reload", onClick: .*ref: \(b\) => \{ state\.reloadButton = b; \}/);
});

test("the pull is drawn with transform and opacity only, its listeners passive", () => {
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  for (const m of js.matchAll(/addEventListener\("(touch\w+|scroll)", [^)]*?\{ passive: (\w+) \}/g)) assert.equal(m[2], "true", m[1]);
  assert.doesNotMatch(js, /\.style\.(top|height|marginTop|paddingTop) = [^;]*pull/);
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(".pull-refresh {"), css.indexOf("@media (prefers-reduced-motion: reduce) { .pull-arrow"));
  for (const t of block.matchAll(/transition: ([^;]+);/g)) assert.match(t[1], /^(transform|opacity) /);
});
