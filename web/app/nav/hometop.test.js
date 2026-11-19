import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHomeTop, homeRootOf, isHomeRoot } from "./hometop.js";
import { createStacks } from "./stack.js";
import { tapTab, scrollToTop } from "./tabbar.js";
import { createRouter, BAR_TABS } from "../router.js";

// F211: Home always starts at the top. The real router, stacks and tapTab, with pages that are plain scrollers, wired
// the way app.js wires them: the tab bar's click runs homeTop.tabTapped, then tapTab; the app coming to the front
// (launch, visibilitychange, pageshow) runs homeTop.opened.

function fakeWindow(hash = "") {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(h) { const n = h.startsWith("#") ? h : "#" + h; if (n !== this._hash) { this._hash = n; fire(); } },
  };
  const win = {
    location,
    history: { replaceState(_s, _t, url) { location._hash = url; } },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
  return win;
}

function app(hash = "#/home") {
  const win = fakeWindow(hash);
  const stacks = createStacks({ tabs: BAR_TABS, create: () => ({ body: { scrollTop: 0, style: {} } }) });
  const router = createRouter({ win, onRoute: (r) => stacks.sync(r) });
  router.start();
  let overlay = false;
  const homeTop = createHomeTop({ homeRoot: homeRootOf(stacks), current: () => router.current(), overlayUp: () => overlay });
  // Reduced motion: tapTab's slide to the top lands at once.
  const still = { matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 0 };
  const tap = (tab) => {
    homeTop.tabTapped(tab);
    return tapTab(tab, router.current(), { selectTab: (t) => router.selectTab(t),
      scrollTop: () => scrollToTop(stacks.top()?.page.body, still) });
  };
  const home = () => stacks.stack("home")[0].page.body;
  return { router, stacks, homeTop, tap, home, setOverlay: (v) => { overlay = v; } };
}

test("isHomeRoot: only Home's own root", () => {
  assert.equal(isHomeRoot({ tab: "home", path: [] }), true);
  assert.equal(isHomeRoot({ tab: "home", path: ["settings"] }), false);
  assert.equal(isHomeRoot({ tab: "sources", path: [] }), false);
  assert.equal(isHomeRoot(null), false);
});

test("launch: the app opening on Home puts Home at its top", () => {
  const a = app("#/home");
  a.home().scrollTop = 300; // e.g. a body restored by the web view, or drawn taller than the screen
  assert.equal(a.homeTop.opened(), true);
  assert.equal(a.home().scrollTop, 0);
});

test("resume: back from the background on Home puts Home at its top, not while a popup is up", () => {
  const a = app("#/home");
  a.home().scrollTop = 420;
  a.setOverlay(true);
  assert.equal(a.homeTop.opened(), false);
  assert.equal(a.home().scrollTop, 420);
  a.setOverlay(false);
  assert.equal(a.homeTop.opened(), true);
  assert.equal(a.home().scrollTop, 0);
});

test("resume on another tab or a page pushed on Home leaves Home's place alone", () => {
  const a = app("#/home");
  a.home().scrollTop = 250;
  a.router.go({ tab: "home", path: ["settings"] });
  assert.equal(a.homeTop.opened(), false);
  a.router.selectTab("sources");
  a.stacks.top().page.body.scrollTop = 90;
  assert.equal(a.homeTop.opened(), false);
  assert.equal(a.home().scrollTop, 250);
  assert.equal(a.stacks.top().page.body.scrollTop, 90);
});

test("tab tap from another tab: Home shows at its top; the other tab keeps its place", () => {
  const a = app("#/home");
  a.home().scrollTop = 500;
  assert.equal(a.tap("sources"), "select");
  const sources = a.stacks.top().page.body;
  sources.scrollTop = 120;
  assert.equal(a.tap("home"), "select");
  assert.equal(a.router.current().tab, "home");
  assert.equal(a.home().scrollTop, 0);
  assert.equal(a.tap("sources"), "select");
  assert.equal(sources.scrollTop, 120); // other tabs: today's behaviour
});

test("tab tap on Home's root slides it to the top (F148)", () => {
  const a = app("#/home");
  a.home().scrollTop = 640;
  assert.equal(a.tap("home"), "reselect");
  assert.equal(a.home().scrollTop, 0);
});

test("tab tap on Home below its root pops to the root, at its top", () => {
  const a = app("#/home");
  a.home().scrollTop = 333;
  a.router.go({ tab: "home", path: ["settings"] });
  assert.equal(a.tap("home"), "select");
  assert.deepEqual(a.router.current(), { tab: "home", path: [] });
  assert.equal(a.home().scrollTop, 0);
});

test("Back to Home from a page pushed on it keeps where Home was scrolled", () => {
  const a = app("#/home");
  const root = a.home();
  root.scrollTop = 777;
  a.router.go({ tab: "home", path: ["settings"] });
  a.router.go({ tab: "home", path: [] }); // the Back button / swipe back land on the parent route
  assert.equal(a.stacks.top().page.body, root); // the same page, never rebuilt
  assert.equal(root.scrollTop, 777);
});

test("app.js wires it: tabTapped before tapTab, opened at launch, on visibilitychange and on pageshow", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /homeTop\.tabTapped\(tab\);[\s\S]{0,200}tapTab\(tab, router\.current\(\)/);
  assert.match(src, /createHomeTop\(\{ homeRoot: homeRootOf\(stacks\)/);
  assert.match(src, /\nhomeTop\.opened\(\);/);
  assert.match(src, /visibilitychange", \(\) => \{ if \(document\.visibilityState === "visible"\) homeTop\.opened\(\)/);
  assert.match(src, /pageshow", \(e\) => \{ if \(e\.persisted\) homeTop\.opened\(\)/);
});
