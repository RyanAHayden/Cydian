// F212: My IPAs' rules for the jailbreak app (core/myipas.js): the shell's library, never signed there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryMode, nativeLibrary, stateOf, libraryRows, deleteSheetTitle, holdActions, HOLD } from "./myipas.js";

test("F212: libraryMode: the shell keeps the library in both app builds, the website its own", () => {
  assert.equal(libraryMode("jailbreak"), "jailbreak");
  assert.equal(libraryMode("sideload"), "sideload");
  assert.equal(libraryMode("site"), "site");
  assert.equal(libraryMode(undefined), "site");
  assert.equal(nativeLibrary("jailbreak"), true);
  assert.equal(nativeLibrary("sideload"), true);
  assert.equal(nativeLibrary("site"), false);
});

test("F212: a jailbreak app row is ready to install (not 'Not signed yet'); a broken one still says so", () => {
  assert.deepEqual(stateOf({ file: "A.ipa" }, { jailbreak: true }), { kind: "ready", label: "Ready to install" });
  assert.equal(stateOf({ file: "A.ipa", error: "x" }, { jailbreak: true }).kind, "broken");
  assert.equal(libraryRows([{ file: "A.ipa", name: "A", version: "1", size: 1024 }], { jailbreak: true })[0].subtitle, "1 · 1.0 KB · Ready to install");
});

test("F212: the jailbreak app's hold sheet and delete wording: no signing, no signed copies", () => {
  assert.deepEqual(holdActions({ file: "A.ipa" }, { jailbreak: true }), [HOLD.INSTALL, HOLD.DELETE]);
  assert.deepEqual(holdActions({ file: "A.ipa", error: "x" }, { jailbreak: true }), [HOLD.DELETE]);
  assert.equal(deleteSheetTitle(1, { jailbreak: true }), "The IPA is deleted from this iPhone.");
  assert.equal(deleteSheetTitle(3, { jailbreak: true }), "3 IPAs are deleted from this iPhone.");
  assert.match(deleteSheetTitle(1), /signed copy/); // the sideload app's as before
});
