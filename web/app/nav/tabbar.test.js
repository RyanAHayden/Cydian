import { test } from "node:test";
import assert from "node:assert/strict";
import { tapTab } from "./tabbar.js";
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

test("a tap on another tab switches to it; tabs without reselect just select", () => {
  const s = spy();
  tapTab("search", { tab: "home", path: [] }, s);
  tapTab("home", { tab: "home", path: [] }, { selectTab: s.selectTab });
  tapTab("search", null, s);
  assert.deepEqual(s.calls.selected, ["search", "home", "search"]);
  assert.equal(s.calls.focused, 0);
});

test("Search's reselect is a no-op before its root page exists", () => {
  assert.equal(typeof search.reselect, "function");
  assert.equal(search.reselect(), false);
});
