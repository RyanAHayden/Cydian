// F208: managing My IPAs: the footer's total size, deleting several (records and stored files gone), the list's
// edit, swipe and selection states, and a held row's sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../test-fakes.js";
import { totalSize, libraryFooter, deleteLabel, deleteButtonText, deleteSheetTitle, listState, listStep, tapOpens,
  allSelected, holdActions, HOLD, deleteEntries, addSiteUrl, siteEntries, memoryIpaStore, formatBytes } from "./myipas.js";

const MB = 1048576;

test("the footer: how many IPAs and their total size; links count nothing", () => {
  assert.equal(libraryFooter([]), "");
  assert.equal(libraryFooter(null), "");
  assert.equal(totalSize([{ file: "a", size: 10 * MB }, { file: "b", size: 5 * MB }, { file: "c" }, { file: "d", size: "x" }]), 15 * MB);
  assert.equal(libraryFooter([{ file: "a", size: 10 * MB }]), "1 IPA · 10.0 MB");
  assert.equal(libraryFooter([{ file: "a", size: 10 * MB }, { file: "b", size: 5 * MB }]), "2 IPAs · 15.0 MB");
  assert.equal(libraryFooter([{ file: "a", url: "https://x/a.ipa" }]), "1 IPA"); // a link keeps nothing
});

test("labels: the toolbar's Delete (n), the sheet's red button and its line", () => {
  assert.equal(deleteLabel(0), "Delete");
  assert.equal(deleteLabel(3), "Delete (3)");
  assert.equal(deleteButtonText(1), "Delete IPA");
  assert.equal(deleteButtonText(4), "Delete 4 IPAs");
  assert.match(deleteSheetTitle(1), /The IPA and its signed copy/);
  assert.match(deleteSheetTitle(2), /2 IPAs and their signed copies/);
  assert.equal(deleteSheetTitle(2, { site: true }), "2 IPAs are deleted from this browser.");
  assert.equal(deleteSheetTitle(2, { site: true, stored: false }), "");
});

test("swipe: left shows one row's Delete, right or a tap puts it away; the tap doesn't open the row then", () => {
  let s = listState();
  assert.ok(tapOpens(s));
  s = listStep(s, { type: "swipe", file: "a", dir: "left" });
  assert.equal(s.armed, "a");
  assert.ok(!tapOpens(s));
  s = listStep(s, { type: "swipe", file: "b", dir: "left" });
  assert.equal(s.armed, "b", "one Delete at a time");
  s = listStep(s, { type: "swipe", file: "b", dir: "right" });
  assert.equal(s.armed, null);
  s = listStep(listStep(s, { type: "swipe", file: "a", dir: "left" }), { type: "tap", file: "c" });
  assert.equal(s.armed, null);
  assert.deepEqual(s.selected, [], "outside edit mode a tap ticks nothing");
  const same = listStep(s, { type: "tap", file: "c" });
  assert.equal(same, s, "a plain tap is the row's link: no change");
  assert.equal(listStep(s, { type: "minus", file: "a" }), s, "no minus outside edit mode");
});

test("edit mode: the minus arms a row, taps tick rows, Select All, Done clears", () => {
  let s = listStep(listStep(listState(), { type: "swipe", file: "a", dir: "left" }), { type: "edit" });
  assert.deepEqual(s, { editing: true, armed: null, selected: [] });
  assert.equal(listStep(s, { type: "swipe", file: "a", dir: "left" }), s, "no swipe while editing");
  s = listStep(s, { type: "minus", file: "a" });
  assert.equal(s.armed, "a");
  s = listStep(s, { type: "minus", file: "a" });
  assert.equal(s.armed, null, "the minus again turns back");
  s = listStep(s, { type: "minus", file: "b" });
  s = listStep(s, { type: "tap", file: "c" });
  assert.equal(s.armed, null, "a tap first puts the Delete away");
  assert.deepEqual(s.selected, []);
  s = listStep(listStep(s, { type: "tap", file: "c" }), { type: "tap", file: "a" });
  assert.deepEqual(s.selected, ["c", "a"]);
  s = listStep(s, { type: "tap", file: "c" });
  assert.deepEqual(s.selected, ["a"]);
  const files = ["a", "b", "c"];
  assert.ok(!allSelected(s, files));
  s = listStep(s, { type: "selectAll", files });
  assert.ok(allSelected(s, files));
  assert.deepEqual(listStep(s, { type: "deselectAll" }).selected, []);
  s = listStep(s, { type: "deleted", files: ["a", "c"] });
  assert.deepEqual(s.selected, ["b"]);
  s = listStep(s, { type: "list", files: ["x"] });
  assert.deepEqual(s.selected, []);
  assert.deepEqual(listStep(s, { type: "done" }), listState());
});

test("a held row's sheet: Install, Sign Now, Save Signed IPA, Delete; the website Install and Delete", () => {
  assert.deepEqual(holdActions({ file: "a.ipa" }), [HOLD.INSTALL, HOLD.SIGN, HOLD.SAVE, HOLD.DELETE]);
  assert.deepEqual(holdActions({ file: "a.ipa", error: "bad zip" }), [HOLD.DELETE]);
  assert.deepEqual(holdActions({ file: "a.ipa", stored: true }, { site: true }), [HOLD.INSTALL, HOLD.DELETE]);
  assert.deepEqual(holdActions(null), []);
});

test("multi-delete on the website: records and stored bytes gone, the rest kept, the footer's total follows", async () => {
  const storage = memStorage(), store = memoryIpaStore();
  const link = addSiteUrl(storage, "https://example.com/Link.ipa");
  const list = JSON.parse(storage.getItem("ifizbox.myIpas"));
  const kept = [{ file: "A.ipa", stored: true, name: "A", size: 10 * MB }, { file: "B.ipa", stored: true, name: "B", size: 20 * MB },
    { file: "C.ipa", stored: true, name: "C", size: 30 * MB }];
  storage.setItem("ifizbox.myIpas", JSON.stringify([...list, ...kept]));
  for (const e of kept) await store.put(e.file, new Blob([e.file]));
  assert.equal(libraryFooter(siteEntries(storage)), `4 IPAs · ${formatBytes(60 * MB)}`);
  const r = await deleteEntries([kept[0], kept[2], link], { site: true, storage, store });
  assert.deepEqual(r.deleted, ["A.ipa", "C.ipa", link.file]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(siteEntries(storage).map((e) => e.file), ["B.ipa"]);
  assert.deepEqual(r.ipas.map((e) => e.file), ["B.ipa"]);
  assert.deepEqual([...store.files.keys()], ["B.ipa"], "the stored bytes are freed");
  assert.equal(libraryFooter(r.ipas), "1 IPA · 20.0 MB");
});

test("multi-delete in the app: one library.delete per IPA; one failing doesn't stop the rest", async () => {
  let ipas = [{ file: "A.ipa", size: MB }, { file: "B.ipa", size: 2 * MB }, { file: "C.ipa", size: 3 * MB }];
  const calls = [];
  const call = async (method, params) => {
    calls.push([method, params.file]);
    if (params.file === "B.ipa") throw Object.assign(new Error("busy"), { code: "busy" });
    ipas = ipas.filter((e) => e.file !== params.file);
    return { ipas };
  };
  const r = await deleteEntries(ipas.slice(), { call });
  assert.deepEqual(calls, [["delete", "A.ipa"], ["delete", "B.ipa"], ["delete", "C.ipa"]]);
  assert.deepEqual(r.deleted, ["A.ipa", "C.ipa"]);
  assert.equal(r.failed[0].file, "B.ipa");
  assert.equal(r.failed[0].message, "busy");
  assert.equal(r.failed[0].error.code, "busy");
  assert.deepEqual(r.ipas.map((e) => e.file), ["B.ipa"]);
  assert.equal(libraryFooter(r.ipas), "1 IPA · 2.0 MB");
});
