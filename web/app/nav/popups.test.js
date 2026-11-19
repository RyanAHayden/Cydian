// B56: nav/popups.js tells whether an alert or sheet is up, and waits for the last one to close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { popupOpen, whenNoPopup, POPUPS } from "./popups.js";

// A page holding some dialogs: querySelectorAll(POPUPS) gives the ones in it, and a fake MutationObserver lets a
// test say "the page changed".
function page() {
  const nodes = new Set();
  const observers = [];
  const doc = {
    body: {},
    querySelectorAll: (sel) => { assert.equal(sel, POPUPS); return [...nodes]; },
    add(n = { getClientRects: () => [{}] }) { nodes.add(n); return n; },
    remove(n) { nodes.delete(n); observers.forEach((o) => o.cb()); },
  };
  class Observer { constructor(cb) { this.cb = cb; } observe() { observers.push(this); } disconnect() { observers.splice(observers.indexOf(this), 1); } }
  return { doc, Observer, observers };
}

test("B56: popupOpen sees an alert in the page, not one that is hidden or gone", () => {
  const { doc } = page();
  assert.equal(popupOpen(doc), false);
  const hidden = doc.add({ getClientRects: () => [] });
  assert.equal(popupOpen(doc), false, "a dialog laid out as nothing doesn't count");
  doc.remove(hidden);
  const a = doc.add();
  assert.equal(popupOpen(doc), true);
  doc.remove(a);
  assert.equal(popupOpen(doc), false);
  assert.equal(popupOpen(undefined), false, "no document (node): nothing up");
});

test("B56: whenNoPopup waits for the last popup to close, then stops watching", async () => {
  const { doc, Observer, observers } = page();
  await whenNoPopup(doc, { Observer }); // none up: at once
  const alert = doc.add();
  const sheet = doc.add();
  let done = false;
  const p = whenNoPopup(doc, { Observer, poll: 60000 }).then(() => { done = true; });
  doc.remove(alert);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false, "a sheet is still up");
  doc.remove(sheet);
  await p;
  assert.equal(done, true);
  assert.equal(observers.length, 0, "the observer is disconnected");
});
