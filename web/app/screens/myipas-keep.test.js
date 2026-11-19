// F243: My IPAs' Keep Bundle ID: the Sign Options page's switch (keepStart, keepFooter) and a library job carrying
// the IPA's saved choice, or none so the global setting decides (core/appqueue.js libraryJob).
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepStart, keepFooter } from "./myipas.js";
import { libraryJob } from "../core/appqueue.js";
import { prepareParams } from "../signing-client.js";

const ENTRY = { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5" };

test("keepStart: the saved choice, else the global setting", () => {
  assert.equal(keepStart({ keepBundleId: false }, true), false);
  assert.equal(keepStart({ keepBundleId: true }, false), true);
  assert.equal(keepStart({ keepBundleId: null }, false), false);
  assert.equal(keepStart({}, true), true);
  assert.equal(keepStart(undefined, false), false);
});

test("keepFooter: the old way, the original on the phone, or what keeping does", () => {
  assert.match(keepFooter(ENTRY, { keepBundleId: false, name: "" }), /Delta becomes a separate copy/);
  assert.match(keepFooter(ENTRY, { keepBundleId: true, name: "My Delta" }, { installed: true, ours: false }), /My Delta is already on this iPhone/);
  assert.match(keepFooter(ENTRY, { keepBundleId: true }, { installed: true, ours: true }), /keeps its own ID/, "ours: an update");
  assert.match(keepFooter(ENTRY, { keepBundleId: true }, { installed: false }), /keeps its own ID/);
  assert.match(keepFooter(ENTRY, { keepBundleId: true, bundleId: "com.me.other" }, { installed: true }), /keeps its own ID/,
    "another bundle ID typed: the original stays");
});

test("libraryJob: a saved switch goes as it is; none leaves it to the setting", () => {
  assert.equal(libraryJob({ ...ENTRY, options: { keepBundleId: true } }).options.edits.keepBundleId, true);
  assert.equal(libraryJob({ ...ENTRY, options: { keepBundleId: false } }).options.edits.keepBundleId, false);
  const none = libraryJob({ ...ENTRY, options: { keepBundleId: null } });
  assert.equal("keepBundleId" in (none.options?.edits ?? {}), false);
  const job = libraryJob({ ...ENTRY, options: { keepBundleId: true } });
  assert.equal(prepareParams(job).keepBundleId, true, "the run's signing.prepare gets it");
});
