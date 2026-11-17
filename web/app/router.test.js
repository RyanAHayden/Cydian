import { test } from "node:test";
import assert from "node:assert/strict";
import { TABS, parse, format, createRouter, prefixes, parent } from "./router.js";
import { createStacks, swipeCommits } from "./nav/stack.js";

// A window-like stub: location.hash assignment fires hashchange synchronously, like a browser does (async there).
function fakeWindow(hash = "") {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(h) { const n = h.startsWith("#") ? h : "#" + h; if (n !== this._hash) { this._hash = n; fire(); } },
  };
  return {
    location,
    replaces: 0,
    history: { replaceState(_s, _t, url) { location._hash = url; this.owner.replaces++; } },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
    back(h) { location.hash = h; }, // what the back button amounts to
    init() { this.history.owner = this; return this; },
  }.init();
}

test("tabs are the five iOS 6 tabs in order", () => {
  assert.deepEqual(TABS, ["home", "sources", "changes", "installed", "search"]);
});

test("parse and format", () => {
  assert.deepEqual(parse(""), { tab: "home", path: [] });
  assert.deepEqual(parse("#/"), { tab: "home", path: [] });
  assert.deepEqual(parse("#/bogus/x"), { tab: "home", path: [] });
  assert.deepEqual(parse("#/sources"), { tab: "sources", path: [] });
  assert.deepEqual(parse("#/sources/a%20b/c/"), { tab: "sources", path: ["a b", "c"] });
  assert.deepEqual(parse("#/search/%E0%A4%A"), { tab: "search", path: ["%E0%A4%A"] }); // bad escape kept as is
  assert.equal(format({ tab: "sources", path: ["https://repo.example/", "pkg"] }),
    "#/sources/https%3A%2F%2Frepo.example%2F/pkg");
  const r = { tab: "installed", path: ["a/b", "ü"] };
  assert.deepEqual(parse(format(r)), r);
});

test("start normalises the hash without a history entry and routes once", () => {
  const win = fakeWindow("");
  const seen = [];
  const router = createRouter({ win, onRoute: (r, prev) => seen.push([r, prev]) });
  router.start();
  assert.equal(win.location.hash, "#/home");
  assert.equal(win.replaces, 1);
  assert.deepEqual(seen, [[{ tab: "home", path: [] }, null]]);
});

test("go, back and repeated routes", () => {
  const win = fakeWindow("#/changes");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  router.go({ tab: "sources", path: ["repo"] });
  router.go({ tab: "sources", path: ["repo"] }); // same route: nothing
  win.back("#/changes");
  assert.deepEqual(seen, ["#/changes", "#/sources/repo", "#/changes"]);
  assert.deepEqual(router.current(), { tab: "changes", path: [] });
  router.stop();
  win.location.hash = "#/search";
  assert.equal(seen.length, 3);
});

test("selectTab restores each tab's place and pops the current tab to its root", () => {
  const win = fakeWindow("#/sources/repo/pkg");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  router.selectTab("search");
  router.selectTab("sources");  // back where we left it
  router.selectTab("sources");  // tap again: root
  router.selectTab("nope");     // ignored
  assert.deepEqual(seen, ["#/sources/repo/pkg", "#/search", "#/sources/repo/pkg", "#/sources"]);
});

test("prefixes and parent", () => {
  assert.deepEqual(prefixes([]), [[]]);
  assert.deepEqual(prefixes(["a", "b"]), [[], ["a"], ["a", "b"]]);
  assert.deepEqual(parent({ tab: "sources", path: ["a", "b"] }), { tab: "sources", path: ["a"] });
  assert.equal(parent({ tab: "sources", path: [] }), null);
});

test("replace routes without a history entry", () => {
  const win = fakeWindow("#/sources/repo/pkg");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  const before = win.replaces;
  router.replace({ tab: "sources", path: ["repo"] });
  router.replace({ tab: "sources", path: ["repo"] }); // same: nothing
  assert.equal(win.replaces, before + 1);
  assert.deepEqual(seen, ["#/sources/repo/pkg", "#/sources/repo"]);
});

// The navigation stack, driven by the router the way app.js drives it.
function stackHarness(hash) {
  const win = fakeWindow(hash);
  let made = 0;
  const stacks = createStacks({ tabs: TABS, create: (tab, path) => ({ id: ++made, tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  const paths = (tab) => stacks.stack(tab).map((e) => e.path.join("/"));
  return { win, router, stacks, results, last: () => results[results.length - 1], paths };
}

test("a deep link builds the whole stack", () => {
  const h = stackHarness("#/sources/repo/pkg");
  assert.equal(h.last().kind, "tab");
  assert.equal(h.last().from, null);
  assert.deepEqual(h.paths("sources"), ["", "repo", "repo/pkg"]);
  assert.equal(h.stacks.top().pushed, false); // nothing behind it in history: back must replace, not go back
});

test("push keeps the screen below; pop removes only the top", () => {
  const h = stackHarness("#/sources");
  const root = h.stacks.top();
  h.router.go({ tab: "sources", path: ["repo"] });
  let r = h.last();
  assert.equal(r.kind, "push");
  assert.equal(r.from, root);
  assert.deepEqual(r.to.path, ["repo"]);
  assert.equal(r.to.pushed, true);
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
  h.router.go({ tab: "sources", path: ["repo", "pkg"] });
  const repo = h.stacks.stack("sources")[1];
  h.win.back("#/sources/repo");
  r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(r.removed.map((e) => e.path), [["repo", "pkg"]]);
  assert.equal(r.to, repo); // the same page object: its DOM (and scroll position) survives the pop
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
});

test("popping several levels at once, and replacing a sibling", () => {
  const h = stackHarness("#/sources/a/b/c");
  const root = h.stacks.stack("sources")[0];
  h.router.go({ tab: "sources", path: [] });
  let r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(r.removed.map((e) => e.path.join("/")), ["a/b/c", "a/b", "a"]); // top first
  assert.equal(r.to, root);
  h.router.go({ tab: "sources", path: ["x", "y"] }); // two levels: not a single push
  assert.equal(h.last().kind, "replace");
  h.router.go({ tab: "sources", path: ["x", "z"] });
  r = h.last();
  assert.equal(r.kind, "replace");
  assert.deepEqual(r.removed.map((e) => e.path), [["x", "y"]]);
  assert.deepEqual(r.added.map((e) => e.path), [["x", "z"]]);
});

test("switching tabs keeps both stacks and their pages", () => {
  const h = stackHarness("#/sources/repo");
  const sourcesPages = h.stacks.stack("sources").map((e) => e.page);
  h.router.selectTab("search");
  assert.equal(h.last().kind, "tab");
  h.router.go({ tab: "search", path: ["q"] });
  assert.equal(h.last().kind, "push");
  h.router.selectTab("sources");
  let r = h.last();
  assert.equal(r.kind, "tab");
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(h.stacks.stack("sources").map((e) => e.page), sourcesPages); // nothing rebuilt
  assert.deepEqual(h.paths("search"), ["", "q"]);
  h.router.selectTab("search"); // back to search where we left it
  assert.deepEqual(h.stacks.top().path, ["q"]);
  h.router.selectTab("search"); // tap again: pops to root
  r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(h.paths("search"), [""]);
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
});

test("edge swipe commits past half or on a rightward flick", () => {
  assert.equal(swipeCommits(100, 0, 390), false);
  assert.equal(swipeCommits(200, 0, 390), true);
  assert.equal(swipeCommits(40, 0.5, 390), true);   // flick
  assert.equal(swipeCommits(300, -0.5, 390), false); // flicked back
});
