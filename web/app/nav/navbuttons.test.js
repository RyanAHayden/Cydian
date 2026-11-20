// B176: Sources and Changes pushed on Home keep their Refresh, on the right of the bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navButtons, MOVED_CLASS } from "./navbuttons.js";

const refresh = { label: "Refresh", pushed: "right" };

test("a root on its own tab keeps its left button and right buttons as given", () => {
  const add = { label: "Add", pushed: false }, manage = { label: "Manage" };
  const bar = navButtons({ left: refresh, right: [add, manage] }, false);
  assert.equal(bar.back, false);
  assert.equal(bar.left, refresh);
  assert.deepEqual(bar.right.map((b) => b.label), ["Add", "Manage"]);
  assert.deepEqual(navButtons({ right: manage }, false).right, [manage]);
});

test("a pushed root shows Back, moves Refresh to the right end and drops pushed:false buttons", () => {
  const bar = navButtons({ left: refresh, right: [{ label: "Add", pushed: false }, { label: "Manage" }] }, true);
  assert.equal(bar.back, true);
  assert.equal(bar.left, null);
  assert.deepEqual(bar.right.map((b) => b.label), ["Manage", "Refresh"]);
  assert.equal(bar.right[1].moved, true);
  assert.equal(bar.right[0].moved, undefined);
});

test("a pushed Changes keeps Upgrade first, Refresh after it; with no Upgrade, Refresh alone", () => {
  assert.deepEqual(navButtons({ left: refresh, right: { label: "Upgrade" } }, true).right.map((b) => b.label), ["Upgrade", "Refresh"]);
  assert.deepEqual(navButtons({ left: refresh }, true).right.map((b) => b.label), ["Refresh"]);
});

test("a left button without pushed:'right' still gives way to Back (Home's About)", () => {
  const bar = navButtons({ left: { label: "About" } }, true);
  assert.equal(bar.left, null);
  assert.deepEqual(bar.right, []);
});

test("Sources, Changes and app.js are wired to it", () => {
  const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const app = src("../app.js");
  assert.match(app, /navButtons\(info, !!below\)/);
  assert.match(app, /MOVED_CLASS/);
  for (const f of ["../screens/sources.js", "../screens/changes.js"]) {
    assert.match(src(f), /label: "Refresh", onClick: \(\) => refresh\(ctx\), pushed: "right"/, f);
  }
  assert.match(src("../screens/sources.js"), /label: "Add", [^\n]*pushed: false/);
  // Changes' Upgrade label lookup must not find the moved Refresh (the website has no Upgrade button).
  // C23: it asks its page handle (nav/go.js), whose rightButton skips the moved copy.
  assert.ok(src("../screens/changes.js").includes("state.page?.rightButton()"));
  assert.ok(src("./go.js").includes(`classList.contains("${MOVED_CLASS}")`));
});
