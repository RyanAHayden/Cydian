import { test } from "node:test";
import assert from "node:assert/strict";
import { tapTab, scrollToTop } from "./tabbar.js";
import * as search from "../screens/search.js";

function spy() {
  const calls = { selected: [], focused: 0 };
  return { calls, selectTab: (t) => calls.selected.push(t), reselect: () => { calls.focused++; } };
}

test("a second tap on Search at its root focuses the field, synchronously, without changing route", () => {
  const s = spy();
  assert.equal(tapTab("search", { tab: "search", path: [] }, s), "reselect");
  assert.equal(s.calls.focused, 1); // already done when tapTab returns: no await or timer in between
  assert.deepEqual(s.calls.selected, []);
});

test("below the root, the tap pops to root first and does not focus", () => {
  const s = spy();
  assert.equal(tapTab("search", { tab: "search", path: ["package:com.x"] }, s), "select");
  assert.deepEqual(s.calls.selected, ["search"]);
  assert.equal(s.calls.focused, 0);
  // then the next tap, now at the root, focuses
  tapTab("search", { tab: "search", path: [] }, s);
  assert.equal(s.calls.focused, 1);
});

test("a tap on another tab switches to it; at the root of a tab without reselect nothing is selected (F148 scrolls)", () => {
  const s = spy();
  tapTab("search", { tab: "home", path: [] }, s);
  assert.equal(tapTab("home", { tab: "home", path: [] }, { selectTab: s.selectTab }), "reselect");
  tapTab("search", null, s);
  assert.deepEqual(s.calls.selected, ["search", "search"]);
  assert.equal(s.calls.focused, 0);
});

test("Search's reselect is a no-op before its root page exists", () => {
  assert.equal(typeof search.reselect, "function");
  assert.equal(search.reselect(), false);
});

// F148: a second tap on the tab you are on, at its root, scrolls its page to the top; deeper, it pops to the root.
function scrollSpy() {
  const calls = { selected: [], tops: 0, order: [] };
  return {
    calls,
    selectTab: (t) => { calls.selected.push(t); calls.order.push("select"); },
    scrollTop: () => { calls.tops++; calls.order.push("top"); },
  };
}

test("every tab: a tap at its root scrolls to the top, synchronously, without changing route", () => {
  for (const tab of ["home", "sources", "changes", "installed", "search"]) {
    const s = scrollSpy();
    assert.equal(tapTab(tab, { tab, path: [] }, s), "reselect");
    assert.equal(s.calls.tops, 1, tab);
    assert.deepEqual(s.calls.selected, [], tab);
  }
});

test("below the root, a tap pops to the root and does not scroll", () => {
  const s = scrollSpy();
  assert.equal(tapTab("home", { tab: "home", path: ["package:com.x"] }, s), "select");
  assert.equal(s.calls.tops, 0);
  assert.deepEqual(s.calls.selected, ["home"]);
});

test("a tap on another tab switches without scrolling", () => {
  const s = scrollSpy();
  tapTab("sources", { tab: "home", path: [] }, s);
  assert.equal(s.calls.tops, 0);
  assert.deepEqual(s.calls.selected, ["sources"]);
});

test("Search at its root scrolls up and still focuses its field, both inside the tap", () => {
  const order = [];
  tapTab("search", { tab: "search", path: [] }, {
    selectTab: () => order.push("select"),
    scrollTop: () => order.push("top"),
    reselect: () => order.push("focus"),
  });
  assert.deepEqual(order, ["top", "focus"]);
});

function fakeBody(scrollTop) {
  const calls = [];
  const overflow = [];
  const body = {
    scrollTop,
    style: {
      set overflowY(v) { overflow.push(v); },
      get overflowY() { return overflow.at(-1) ?? ""; },
    },
    get offsetHeight() { calls.push("layout"); return 100; },
    scrollTo(o) { calls.push(o); },
  };
  return { body, calls, overflow };
}

test("scrollToTop stops a fling, then scrolls smoothly to 0 (instantly with reduced motion)", () => {
  const f = fakeBody(1200);
  assert.equal(scrollToTop(f.body, { matchMedia: () => ({ matches: false }) }), true);
  assert.deepEqual(f.overflow, ["hidden", ""]);
  assert.deepEqual(f.calls, ["layout", { top: 0, behavior: "smooth" }]);

  const r = fakeBody(50);
  scrollToTop(r.body, { matchMedia: () => ({ matches: true }) });
  assert.deepEqual(r.calls.at(-1), { top: 0, behavior: "auto" });
});

test("scrollToTop does nothing already at the top or without a page", () => {
  const f = fakeBody(0);
  assert.equal(scrollToTop(f.body, {}), false);
  assert.deepEqual(f.calls, []);
  assert.equal(scrollToTop(null), false);
});
