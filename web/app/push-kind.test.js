// Every page a link opens slides in as a push (user 2026-11-20): Home's Install IPAs and What's New tiles too, also
// right after a visit to the page they open in its own tab, which the router used to take for a Back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { format, createRouter, BAR_TABS, rootOn, mounted, prefixes, parent } from "./router.js";
import { createStacks } from "./nav/stack.js";
import { ipasTile, stateTile, CHANGES_HREF } from "./screens/home.js";

// A window-like stub with a browser-like history: location.hash adds an entry (state null), replaceState swaps the
// current one's hash and state, history.back() walks to the one before with its state. hashchange fires synchronously
// (async in a browser).
function fakeWindow(hash) {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const entries = [{ hash, state: null }];
  let at = 0;
  const location = {
    get hash() { return entries[at].hash; },
    set hash(h) {
      const n = h.startsWith("#") ? h : "#" + h;
      if (n === entries[at].hash) return;
      entries.splice(at + 1, Infinity, { hash: n, state: null });
      at++;
      fire();
    },
  };
  return {
    location,
    history: {
      get state() { return entries[at].state; },
      replaceState(state, _t, url) { entries[at] = { hash: url, state: state == null ? null : structuredClone(state) }; },
      back() { if (at > 0) { at--; fire(); } },
      forward() { if (at < entries.length - 1) { at++; fire(); } },
    },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
}

function setup(start = "#/home") {
  const win = fakeWindow(start);
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  // a tapped link: the browser sets the hash to the link's href
  const tap = (href) => { win.location.hash = href; return results.at(-1); };
  return { win, router, stacks, results, tap };
}

test("B169: Home's Install IPAs tile pushes the page onto Home's stack, and Back pops it", () => {
  const { win, tap, results } = setup();
  const r = tap(ipasTile().href);
  assert.equal(r.kind, "push");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B169: Install IPAs from Home still pushes after a visit to Installed > Install IPAs (not taken for a Back)", () => {
  const { win, router, tap, results } = setup();
  router.selectTab("installed");
  router.go({ tab: "installed", path: ["myipas"] });
  router.selectTab("home");
  assert.equal(win.location.hash, "#/home");
  const r = tap(ipasTile().href); // the hash before Home's is #/installed/myipas: same text, but a new link
  assert.equal(r.kind, "push");
  assert.equal(r.tab, "home");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B169: Home's What's New tile pushes Changes onto Home's stack, and Back pops it", () => {
  for (const tile of [stateTile({ sources: [{}], upgrades: 0 }), stateTile({ sources: [{}], upgrades: 2 }), stateTile({ sources: [{}], upgrades: null })]) {
    const { win, tap, results, stacks } = setup();
    assert.equal(tile.href, "#/home/~changes");
    const r = tap(tile.href);
    assert.equal(r.kind, "push", tile.label);
    assert.equal(win.location.hash, "#/home/~changes");
    assert.deepEqual(r.to.page, { tab: "home", path: ["~changes"] });
    assert.deepEqual(mounted({ tab: "home", path: ["~changes"] }), { tab: "changes", path: [] }); // Changes draws it
    assert.deepEqual(stacks.stack("home").map((e) => e.path.join("/")), ["", "~changes"]);
    win.history.back();
    assert.equal(results.at(-1).kind, "pop");
    assert.equal(win.location.hash, "#/home");
  }
});

test("B169: What's New pushes even right after a visit to the Changes tab, and a package from it pushes too", () => {
  const { win, router, tap, results } = setup();
  router.selectTab("changes");
  router.selectTab("home");
  const r = tap(CHANGES_HREF);
  assert.equal(r.kind, "push");
  assert.equal(win.location.hash, "#/home/~changes");
  // a Changes row links in Changes' own terms (#/changes/<pkg>): it stays on Home's stack, above Changes
  assert.equal(tap("#/changes/com.example.tweak").kind, "push");
  assert.equal(win.location.hash, "#/home/~changes/com.example.tweak");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/~changes");
  win.history.forward(); // forward walks to an entry already seen: no new push, the page comes back
  assert.equal(results.at(-1).kind, "push");
  assert.equal(win.location.hash, "#/home/~changes/com.example.tweak");
});

test("B169: Help's Check for Changes pushes Changes above Help", () => {
  const { win, tap } = setup("#/home/help");
  assert.equal(tap(format(rootOn("changes", { tab: "home", path: ["help"] }))).kind, "push");
  assert.equal(win.location.hash, "#/home/help/~changes");
});

test("B169: a route ending in a mount is that tab's root page; one in the middle is no page", () => {
  assert.deepEqual(prefixes(["~changes"]), [[], ["~changes"]]);
  assert.deepEqual(prefixes(["~installed", "myipas"]), [[], ["~installed", "myipas"]]);
  assert.deepEqual(prefixes(["help", "~changes"]), [[], ["help"], ["help", "~changes"]]);
  assert.deepEqual(parent({ tab: "home", path: ["~changes"] }), { tab: "home", path: [] });
  assert.deepEqual(rootOn("changes"), { tab: "home", path: ["~changes"] });
});

test("B169: after a reload the entry's step is kept: Back from a later link is still a pop", () => {
  const { win, tap } = setup();
  tap(ipasTile().href);
  // a reload: a new router on the same history, whose entries already carry steps
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.location.hash = "#/installed/myipas/ipa:x.ipa";
  assert.equal(results.at(-1).kind, "push");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
});

test("B169: replace (Back on a deep link with nothing behind) keeps the entry's step", () => {
  const { win, router, results } = setup("#/home/browse/new");
  router.replace({ tab: "home", path: ["browse"] });
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/browse");
  assert.equal(win.history.state.ifizboxStep, 1);
});

test("B169: the tab bar still switches tabs (no push), and a tab's root stays where it is", () => {
  const { win, router, results } = setup();
  router.selectTab("changes");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(win.location.hash, "#/changes");
  router.selectTab("installed");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(win.location.hash, "#/installed");
  router.selectTab("home");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(format(router.current()), "#/home");
});

test("B169: a real Back (history.back to the entry before) is still a pop, not a new push", () => {
  const { win, router, results } = setup();
  router.go({ tab: "home", path: ["browse"] });
  assert.equal(results.at(-1).kind, "push");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});
