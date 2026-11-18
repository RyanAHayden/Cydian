// nativePaste: the app's UIPasteboard (Bridge.swift clipboard.read), null where the website or an older shell
// must use navigator.clipboard instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativePaste } from "./menu.js";

test("nativePaste: the shell's text, '' for an empty clipboard, null without clipboard.read", async () => {
  assert.equal(await nativePaste({ call: async (m) => (m === "clipboard.read" ? "https://repo.test/" : null) }), "https://repo.test/");
  assert.equal(await nativePaste({ call: async () => null }), "");
  assert.equal(await nativePaste({ call: async () => { throw new Error("unknown method clipboard.read"); } }), null);
  assert.equal(await nativePaste(undefined), null);
});
