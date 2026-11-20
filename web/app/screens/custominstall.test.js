// F81: one-tap Install and Custom Install. The app page's Install group (altstore.js installRows) gets a "Custom
// Install" row where the phone signs; the look-first sheet's buttons (signing-sheet.js signSheetButtons): Install at
// the top right of its nav bar, a red Cancel at the bottom; Install itself (signing-client.js signAndInstall) signs
// straight away with no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows } from "./altstore.js";
import { signSheetButtons, customInstall } from "../signing-sheet.js";

const V = { version: "1.2", downloadURL: "https://example.com/Delta.ipa" };
const labels = (rows) => rows.map((r) => r.label);

test("Install group: Custom Install under Install where the phone signs; not on the site or for a source's own link only", async () => {
  const seen = [];
  let installed = 0;
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => { installed++; }, null, "Delta",
    { custom: true, site: false, customize: (o) => { seen.push(o); return true; } });
  assert.deepEqual(labels(rows), ["Install", "Custom Install", "Download IPA"]);
  const row = rows[1];
  assert.match(row.subtitle, /Bundle ID/);
  await row.onClick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, V.downloadURL);
  assert.equal(seen[0].name, "Delta");
  seen[0].onInstalled();
  assert.equal(installed, 1); // the Installed tab's record, as Install's

  assert.deepEqual(labels(installRows(V, null, () => {}, () => {}, null, "Delta", { custom: false, site: false }).rows), ["Install", "Download IPA"]);
  // A source-signed link with no IPA: nothing to re-sign.
  const itms = { version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" };
  assert.deepEqual(labels(installRows(itms, null, () => {}, () => {}, null, "X", { custom: true, customize: () => {} }).rows), ["Install"]);
});

test("Install group: by default Custom Install shows only in the sideload app", () => {
  const saved = globalThis.ifizboxNative;
  try {
    delete globalThis.ifizboxNative;
    assert.ok(!labels(installRows(V, null).rows).includes("Custom Install"));
    globalThis.ifizboxNative = { mode: "sideload", call: async () => ({}) };
    assert.ok(labels(installRows(V, null).rows).includes("Custom Install"));
    globalThis.ifizboxNative = { mode: "jailbreak", call: async () => ({}) };
    assert.ok(!labels(installRows(V, null).rows).includes("Custom Install"));
  } finally {
    if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved;
  }
});

// Just enough DOM for the buttons.
function fakeDoc() {
  const make = (tag) => {
    const e = { tagName: tag.toUpperCase(), className: "", textContent: "", type: "", children: [], listeners: {},
      append(...c) { this.children.push(...c); },
      replaceChildren(...c) { this.children = [...c]; },
      addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
      click() { for (const f of this.listeners.click ?? []) f(); } };
    return e;
  };
  return { createElement: make, make };
}

test("the sheet: Install at the top right (done style, in place of Done), a red Cancel at the bottom", () => {
  const doc = fakeDoc();
  const right = doc.make("div");
  right.append(Object.assign(doc.make("button"), { textContent: "Done" }));
  const box = doc.make("div");
  box.append(doc.make("div")); // the groups above
  const log = [];
  const { install, cancel } = signSheetButtons({ right, box, doc, onInstall: () => log.push("install"), onCancel: () => log.push("cancel") });
  assert.deepEqual(right.children, [install]);
  assert.equal(install.textContent, "Install");
  assert.match(install.className, /\bbar-button\b/);
  assert.match(install.className, /\bdone\b/);
  assert.equal(box.children.at(-1), cancel);
  assert.equal(cancel.textContent, "Cancel");
  assert.equal(cancel.className, "ss-cancel"); // signsheet.css: the Delete buttons' red
  install.click();
  cancel.click();
  assert.deepEqual(log, ["install", "cancel"]);
});

test("the sheet: a plain Cancel at the top left of the nav bar too, closing it as the red one does", () => {
  const doc = fakeDoc();
  const right = doc.make("div");
  const left = doc.make("div"); // nav/sheet.js's empty spacer
  const box = doc.make("div");
  let closed = 0;
  const { cancel, barCancel } = signSheetButtons({ right, left, box, doc, onInstall: () => {}, onCancel: () => { closed++; } });
  assert.deepEqual(left.children, [barCancel]);
  assert.equal(barCancel.textContent, "Cancel");
  assert.match(barCancel.className, /\bbar-button\b/);
  assert.doesNotMatch(barCancel.className, /\bdone\b/); // plain, as other sheets' Cancel
  assert.equal(box.children.at(-1), cancel); // the red one stays
  barCancel.click();
  assert.equal(closed, 1);
  cancel.click();
  assert.equal(closed, 2);
  // Without a left side (an older caller): the bottom Cancel alone, no throw.
  assert.ok(signSheetButtons({ right: doc.make("div"), box: doc.make("div"), doc, onInstall() {}, onCancel() {} }).cancel);
});

test("Custom Install: the Signing walkthrough first when something is missing, else the sheet", async () => {
  const opened = [];
  const inspect = async (o) => { opened.push(o); return true; };
  assert.equal(await customInstall({ url: "u" }, { check: async () => "certificate", inspect }), false);
  assert.equal(opened.length, 0);
  assert.equal(await customInstall({ url: "u" }, { check: async () => null, inspect }), true);
  assert.deepEqual(opened, [{ url: "u" }]);
});
