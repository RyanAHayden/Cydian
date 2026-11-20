// F270: pull to refresh's arm/release logic (nav/pullrefresh.js): where it arms, that a release under the trigger or
// while a refresh runs does nothing, the rubber band, the Last Updated line, and that every page with a Refresh /
// Reload nav button wires it. B188: an armed release holds the area open (refreshing), slides back when the refresh
// ends (closing) and resets to the arrow only once hidden (idle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pullState, pullTracker, rubber, lastUpdatedText, titleFor, bounceHold, refreshEnd, TRIGGER, HOLD, TEXT,
  MIN_HOLD_MS, MAX_HOLD_MS } from "./pullrefresh.js";
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

test("release past the trigger runs the refresh once and holds: refreshing, closing when it ends, idle once hidden", () => {
  const r = run({ pulls: [10, 40, 59, 61, 90] });
  assert.equal(r.went, true);
  assert.equal(r.refreshed, 1);
  assert.deepEqual(r.states, ["pull", "armed", "refreshing"]);
  assert.equal(r.t.state, "refreshing");
  assert.equal(r.t.held, true);
  r.t.hidden(); // not before the refresh ended
  assert.equal(r.t.state, "refreshing");
  r.t.done();
  assert.equal(r.t.state, "closing"); // the list slides back up, still "Refreshing..."
  assert.equal(r.t.held, true);
  r.t.hidden();
  assert.deepEqual(r.states, ["pull", "armed", "refreshing", "closing", "idle"]);
  assert.equal(r.t.held, false);
});

test("a pull while the area is held never arms, runs nothing and leaves the state alone", () => {
  let n = 0;
  const states = [];
  const t = pullTracker({ onRefresh: () => n++, onState: (s) => states.push(s) });
  t.start(); t.move(90); assert.equal(t.end(), true);
  for (const s of ["refreshing", "closing"]) {
    t.start(); t.move(120);
    assert.equal(t.blocked, true);
    assert.equal(t.state, s);
    assert.equal(t.end(), false);
    t.start(); t.cancel();
    assert.equal(t.state, s);
    t.done();
  }
  t.hidden();
  assert.equal(n, 1);
  assert.deepEqual(states, ["armed", "refreshing", "closing", "idle"]);
  t.start(); t.move(90); assert.equal(t.end(), true); // and once hidden, the next pull works again
  assert.equal(n, 2);
});

test("titles: pull, armed, Refreshing... while held and while it slides back", () => {
  assert.equal(titleFor("idle"), TEXT.pull);
  assert.equal(titleFor("pull"), TEXT.pull);
  assert.equal(titleFor("armed"), TEXT.armed);
  assert.equal(titleFor("refreshing"), "Refreshing...");
  assert.equal(titleFor("closing"), "Refreshing...");
});

test("native bounce: the list follows the bounce down to HOLD and stops there, never jumping back up", () => {
  assert.equal(HOLD, 60);
  assert.equal(bounceHold(0, -120), 0);   // still bounced farther than HOLD: the bounce itself shows the area
  assert.equal(bounceHold(0, -60), 0);
  assert.equal(bounceHold(0, -40), 20);   // 40 of bounce + 20 of hold: 60 of list below its top
  assert.equal(bounceHold(20, -50), 20);  // never shrinks
  assert.equal(bounceHold(20, -10), 50);
  assert.equal(bounceHold(50, 0), 60);    // the bounce is over: held at HOLD
  assert.equal(bounceHold(50, 200), 60);
  // the list's visible top (bounce + hold) on the way back: the bounce until HOLD, then HOLD
  for (let top = -100; top <= 0; top += 5) assert.equal(-top + bounceHold(0, top), Math.max(-top, HOLD));
});

function fakeTimers() {
  let t = 0, id = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => { jobs.set(++id, { fn, at: t + ms, every }); return id; };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearTimeout: (i) => jobs.delete(i),
    clearInterval: (i) => jobs.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [i, j] = next;
        t = j.at;
        if (j.every) j.at += j.every; else jobs.delete(i);
        j.fn();
      }
      t = end;
    },
    get pending() { return jobs.size; },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test("refreshEnd: waits for the promise, for busy() to clear and for the minimum, then ends once", async () => {
  const timers = fakeTimers();
  const target = new EventTarget();
  let busy = true, ended = 0, settle;
  const result = new Promise((r) => { settle = r; });
  refreshEnd(result, { busy: () => busy, onEnd: () => ended++, timers, now: timers.now, target });
  timers.advance(MIN_HOLD_MS + 1000);
  await tick();
  assert.equal(ended, 0); // promise still out
  settle();
  await tick();
  assert.equal(ended, 0); // settled, but a refresh still runs (the ifizbox:refreshing count, the reload bar)
  busy = false;
  target.dispatchEvent(new Event("ifizbox:refreshing"));
  assert.equal(ended, 1);
  timers.advance(MAX_HOLD_MS);
  assert.equal(ended, 1);
  assert.equal(timers.pending, 0);
});

test("refreshEnd: a quick refresh still holds MIN_HOLD_MS; a rejected one ends too; one that never ends stops at MAX", async () => {
  const timers = fakeTimers();
  const target = new EventTarget();
  let ended = 0;
  refreshEnd(Promise.reject(new Error("x")), { onEnd: () => ended++, timers, now: timers.now, target });
  await tick();
  assert.equal(ended, 0);
  timers.advance(MIN_HOLD_MS - 1);
  assert.equal(ended, 0);
  timers.advance(1);
  assert.equal(ended, 1);
  // busy() that never clears (Home's Reload button stuck): ended at MAX_HOLD_MS anyway
  let stuck = 0;
  refreshEnd(undefined, { busy: () => true, onEnd: () => stuck++, timers, now: timers.now, target });
  await tick();
  timers.advance(MAX_HOLD_MS - 1);
  assert.equal(stuck, 0);
  timers.advance(1);
  assert.equal(stuck, 1);
  // stop() cancels it without ending
  let stopped = 0;
  const stop = refreshEnd(undefined, { onEnd: () => stopped++, timers, now: timers.now, target });
  stop();
  await tick();
  timers.advance(MAX_HOLD_MS);
  assert.equal(stopped, 0);
  assert.equal(timers.pending, 0);
});

test("the DOM side holds and lets go through the tracker: spinner markup, closing slides back, reset on hidden", () => {
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  assert.match(js, /<span class="pull-spinner"><\/span>/);
  assert.match(js, /if \(went\) holdOpen\(was\);/);
  assert.match(js, /if \(s === "closing"\) close\(\);/);
  assert.match(js, /a\.finished\.then\(reset, reset\)/);
  assert.match(js, /refreshEnd\(result, \{ busy, onEnd: \(\) => \{ stopWatch = null; tracker\.done\(\); \} \}\)/);
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  assert.match(css, /\.pull-spinner \{[^}]*background: var\(--spinner-gray\) center \/ 20px no-repeat;/);
  assert.match(css, /\.pull-refresh\.refreshing \.pull-spinner \{ visibility: visible; animation: hud-spin/);
  assert.match(css, /\.pull-refresh\.refreshing \.pull-arrow \{ visibility: hidden;/);
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
  // C25: each copy of the page (its view) has its own list box
  assert.match(src("sources.js"), /pullToRefresh\(view\.box\.parentNode, \{ onRefresh: \(\) => refresh\(state\.ctx\)/);
  assert.match(src("changes.js"), /pullToRefresh\(view\.results, \{ onRefresh: \(\) => refresh\(ctx\)/);
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

test("the pull area is the list's own background in every theme, never a colour of its own", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]*\.pull-(?:clip|refresh|inner)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 3);
  const area = rules.find((r) => r[1].trim() === ".pull-refresh");
  assert.match(area[2], /background: var\(--plain\);/);
  for (const [, sel, body] of rules) {
    if (sel.trim() === ".pull-refresh" || sel.trim() === ".pull-clip.grouped > .pull-refresh") continue;
    assert.doesNotMatch(body, /background/, sel.trim());
  }
});

test("on a grouped page the pull area is the page's pinstripe (and linen's weave), set from the scroller's class", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const bg = (sel) => {
    const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    assert.ok(m, sel);
    return m[1].match(/background:([^;]+);/)[1].trim();
  };
  assert.equal(bg(".pull-clip.grouped > .pull-refresh"), bg(".page-body.grouped"));
  const pal = readFileSync(new URL("../palettes.css", import.meta.url), "utf8");
  assert.match(pal, /html\[data-theme="dark"\]\[data-palette="linen"\] \.pull-clip\.grouped > \.pull-refresh \{ background: var\(--weave\); \}/);
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  assert.match(js, /clip\.classList\.toggle\("grouped", scroller\.classList\.contains\("grouped"\)\)/);
});
