// Version History's version sheet: the sideloader line under the title only when no row installs the version here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { versionSheetTitle } from "./browse.js";
import { installRows } from "./altstore.js";

const V = { version: "0.17.1", downloadURL: "https://s/iFizBox.ipa" };
const sign = async () => {};
const LINE = "\nA sideloader signs it on the iPhone with your Apple ID.";

test("the sideload app signs it itself: Install / Custom Install / Download IPA, no sideloader line", () => {
  const { rows, options } = installRows(V, "https://s/", () => {}, () => {}, null, "iFizBox",
    { custom: true, jailbreak: false, site: false, sign });
  assert.deepEqual(rows.map((r) => r.label), ["Install", "Custom Install", "Download IPA"]);
  assert.equal(versionSheetTitle("iFizBox", "0.17.1", rows, options), "iFizBox 0.17.1");
});

test("the jailbreak's Install and a source's signed link: no sideloader line either", () => {
  const jb = installRows(V, "https://s/", () => {}, () => {}, null, "iFizBox", { custom: false, jailbreak: true, site: false, sign });
  assert.equal(versionSheetTitle("iFizBox", "0.17.1", jb.rows, jb.options), "iFizBox 0.17.1");
  const itms = { version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" };
  const s = installRows(itms, "https://s/", () => {}, () => {}, null, "A", { custom: false, jailbreak: false, site: false, sign });
  assert.equal(versionSheetTitle("A", "1", s.rows, s.options), "A 1");
});

test("only Download IPA (nothing installs it here): the sideloader line stays", () => {
  const rows = [{ label: "Download IPA", subtitle: "iFizBox.ipa" }];
  assert.equal(versionSheetTitle("iFizBox", "0.17.1", rows, {}), `iFizBox 0.17.1${LINE}`);
});
