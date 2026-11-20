import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as fakeStorage } from "../fakes.test-helper.js";
import { createWishlist, wishLabel, wishRows, WISHLIST_KEY, WISH_ADD, WISH_REMOVE } from "./wishlist.js";

test("add and remove, kept on the device in the order added", () => {
  const s = fakeStorage();
  const w = createWishlist({ storage: s });
  assert.deepEqual(w.list(), []);
  w.set("com.b", true);
  w.set("com.a", true);
  w.set("com.b", true); // twice is once
  assert.deepEqual(w.list(), ["com.b", "com.a"]);
  assert.equal(s.m.get(WISHLIST_KEY), '["com.b","com.a"]');
  assert.ok(w.has("com.a"));
  w.set("com.b", false);
  assert.deepEqual(createWishlist({ storage: s }).list(), ["com.a"]);
});

test("a hand-edited or broken value reads as what it can", () => {
  assert.deepEqual(createWishlist({ storage: fakeStorage({ [WISHLIST_KEY]: "nope" }) }).list(), []);
  assert.deepEqual(createWishlist({ storage: fakeStorage({ [WISHLIST_KEY]: '{"a":1}' }) }).list(), []);
  assert.deepEqual(createWishlist({ storage: fakeStorage({ [WISHLIST_KEY]: '["x",3,"",null,"x","y"]' }) }).list(), ["x", "y"]);
});

test("storage that throws: the list lives for the session", () => {
  const bad = { getItem() { throw new Error("private"); }, setItem() { throw new Error("quota"); } };
  const w = createWishlist({ storage: bad });
  w.set("com.a", true);
  assert.deepEqual(w.list(), ["com.a"]);
  assert.deepEqual(createWishlist({ storage: undefined }).list(), []);
});

test("installed packages drop off", () => {
  const w = createWishlist({ storage: fakeStorage() });
  for (const id of ["a", "b", "c"]) w.set(id, true);
  const heard = [];
  w.onChange((l) => heard.push(l));
  assert.deepEqual(w.prune(["b", "z"]), ["b"]);
  assert.deepEqual(w.list(), ["a", "c"]);
  assert.deepEqual(w.prune(["z"]), []);
  assert.equal(heard.length, 1); // nothing dropped, nothing written
});

test("the sheet's label", () => {
  assert.equal(wishLabel(false), WISH_ADD);
  assert.equal(wishLabel(true), WISH_REMOVE);
  assert.equal(WISH_ADD, "Add to Wish List");
});

test("the page's rows: by name, installed and gone ones left out", () => {
  const rows = [{ id: "c", name: "charlie" }, null, { id: "a", name: "Alpha" }, { id: "b", name: "Bravo" }, { id: "x", name: "Extra" }];
  assert.deepEqual(wishRows(["a", "b", "c", "gone"], rows, ["b"]).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(wishRows([], rows), []);
});
