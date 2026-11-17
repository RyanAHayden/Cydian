import { test } from "node:test";
import assert from "node:assert/strict";
import { TABS, parse, format, createRouter } from "./router.js";

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
