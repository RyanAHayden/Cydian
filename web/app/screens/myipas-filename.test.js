// B92: an IPA's page shows its file name whole (the File row wraps) and a hold on that row offers iOS 6's Copy
// callout, which copies the full name (screens/myipas.js markFileRow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { markFileRow } from "./myipas.js";

// Just enough of a page: .cell rows, each with a .cell-label.
function page(labels) {
  const cells = labels.map((text) => {
    const cls = new Set(["cell"]);
    const label = { textContent: text };
    return { cls, classList: { add: (c) => cls.add(c) }, querySelector: (s) => (s === ".cell-label" ? label : null) };
  });
  return { cells, querySelectorAll: (s) => (s === ".cell" ? cells : []) };
}

test("the File row is marked to wrap, and its hold copies the full name", async () => {
  const body = page(["Version", "Bundle ID", "File", "Delete"]);
  const name = "opentennis-beta-p146-with-a-very-long-tail.ipa";
  let held = null, shown = null, copied = null;
  const li = markFileRow(body, name, {
    hold: (el, sel, onHold) => { held = { el, sel, onHold }; },
    menu: (anchor, items) => { shown = { anchor, items }; },
    copy: (t) => { copied = t; },
  });
  assert.equal(li, body.cells[2]);
  assert.ok(li.cls.has("myipa-file"));
  assert.equal(held.el, li);
  assert.equal(held.sel, ".cell-inner");
  held.onHold("inner");
  assert.equal(shown.anchor, "inner");
  assert.deepEqual(shown.items.map((i) => i.label), ["Copy"]);
  shown.items[0].onClick();
  assert.equal(copied, name);
});

test("no File row, or no file: nothing is marked", () => {
  const hold = () => assert.fail("no hold without a File row");
  assert.equal(markFileRow(page(["Version", "Delete"]), "a.ipa", { hold }), null);
  assert.equal(markFileRow(page(["File"]), "", { hold }), null);
});
