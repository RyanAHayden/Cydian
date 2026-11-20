// iFizBox's own row in the sideload app's Installed list draws its bundled icon (selfRecord's icons/ path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selfIconUrl } from "./installed.js";

test("own row: the bundled icon file; other rows and paths: none", () => {
  assert.equal(selfIconUrl({ id: "com.ryha.ifizbox", self: true, icon: "icons/icon-lite-glossy-76.png" }), "icons/icon-lite-glossy-76.png");
  assert.equal(selfIconUrl({ id: "x", icon: "icons/icon-lite-glossy-76.png" }), null);
  assert.equal(selfIconUrl({ self: true, icon: "../secret.png" }), null);
  assert.equal(selfIconUrl({ self: true, icon: "javascript:alert(1)" }), null);
  assert.equal(selfIconUrl({ self: true }), null);
  assert.equal(selfIconUrl(null), null);
});
