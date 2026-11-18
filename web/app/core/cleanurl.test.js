import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSourceUrl as c } from "./sources.js";

test("a typed or pasted source becomes one clean URL", () => {
  assert.equal(c("https://https://repo.chariz.com/"), "https://repo.chariz.com/"); // pasted into the field's https://
  assert.equal(c("https://http://apt.thebigboss.org/x"), "http://apt.thebigboss.org/x"); // the last scheme wins
  assert.equal(c("https:/https://a.dev"), "https://a.dev/");
  assert.equal(c("repo.havoc.app"), "https://repo.havoc.app/");
  assert.equal(c("  https://repo.twickd.com/  "), "https://repo.twickd.com/");
  assert.equal(c("Add https://fizl0.github.io/apps/source.json now"), "https://fizl0.github.io/apps/source.json");
  assert.equal(c("sileo://https://x.org/"), "https://x.org/");
});

test("text that isn't a source is nothing", () => {
  for (const t of ["", "https://", "hello world", null]) assert.equal(c(t), "");
});
