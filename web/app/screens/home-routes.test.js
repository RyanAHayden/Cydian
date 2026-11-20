// Home's route table: each route's bar comes from its one entry, and anything unknown falls back to Home's root.
import test from "node:test";
import assert from "node:assert/strict";
import { nav } from "./home.js";
import { NAME } from "../brand.js";

const at = (...path) => ({ tab: "home", path });

test("each of Home's plain routes has its own title", () => {
  assert.deepEqual(nav(at("credits")), { title: "Credits" });
  assert.deepEqual(nav(at("help")), { title: "Help" });
  assert.deepEqual(nav(at("featured")), { title: "Featured" });
  assert.deepEqual(nav(at("sources")), { title: "More Sources" });
  assert.deepEqual(nav(at("wishlist")), { title: "Wish List", style: "plain" });
  assert.deepEqual(nav(at("browse", "categories")), { title: "All Categories" });
});

test("the root and unknown routes get Home's bar: About and Reload", () => {
  for (const route of [at(), at("no-such-page")]) {
    const n = nav(route, {});
    assert.equal(n.title, NAME);
    assert.equal(n.back, "Home");
    assert.equal(n.left.label, "About");
    assert.equal(n.right.label, "Reload");
  }
});
