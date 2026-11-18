// F86: the Essential Upgrade alert waits for F80's Confirm sheet (screens/queue.js whenConfirmEnds): Cancel answers
// "cancel" (the alert comes back when forced), Confirm "confirm". The sheet is built over a small fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAppConfirm, whenConfirmEnds } from "./queue.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";

function fakeElement(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, hidden: false, textContent: "",
    className: "", dataset: {}, parentElement: null,
    classList: { add: (...c) => { e.className = [e.className, ...c].filter(Boolean).join(" "); }, remove() {}, contains: (c) => e.className.split(" ").includes(c), toggle() {} },
    append(...k) { for (const c of k) if (c && typeof c === "object") { c.parentElement = e; e.children.push(c); } },
    prepend(...k) { e.append(...k); },
    replaceChildren(...k) { e.children = []; e.append(...k); },
    setAttribute(a, v) { e.attrs[a] = v; }, getAttribute: (a) => e.attrs[a] ?? null, removeAttribute(a) { delete e.attrs[a]; },
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); }, removeEventListener() {},
    animate: () => ({ finished: Promise.resolve(), cancel() {} }),
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    remove() {}, focus() {}, click() { for (const f of e.listeners.click ?? []) f({ preventDefault() {}, stopPropagation() {} }); },
  };
  return e;
}

function withDom(fn) {
  const saved = globalThis.document;
  const body = fakeElement("body");
  globalThis.document = { createElement: fakeElement, createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => fakeElement("#frag"),
    body, documentElement: fakeElement("html"), querySelector: () => null, querySelectorAll: () => [] };
  return Promise.resolve().then(() => fn(body)).finally(() => { globalThis.document = saved; });
}

const buttons = (root, out = []) => { if (root.tagName === "BUTTON") out.push(root); for (const c of root.children ?? []) buttons(c, out); return out; };
const job = (id) => ({ id, name: id, version: "2", url: `https://x/${id}.ipa` });

test("F86: Confirm's Cancel answers \"cancel\" and clears the queue", () => withDom(async (body) => {
  const q = createAppQueue();
  q.add(job(SELF_ID));
  const ended = whenConfirmEnds();
  openAppConfirm(q);
  const cancel = buttons(body).find((b) => b.textContent === "Cancel");
  assert.ok(cancel, "Confirm has Cancel");
  cancel.click();
  assert.equal(await ended, "cancel");
  assert.equal(q.size, 0);
}));

test("F86: Confirm answers \"confirm\"; a queue emptied under the sheet answers \"cancel\"", () => withDom(async (body) => {
  const q = createAppQueue();
  q.add(job("a"));
  const ended = whenConfirmEnds();
  openAppConfirm(q);
  const ok = buttons(body).find((b) => b.textContent === "Confirm");
  assert.ok(ok, "Confirm has Confirm");
  globalThis.cydianNative = undefined;
  q.clear("a"); // the run itself isn't under test: an empty queue closes the sheet, which counts as Cancel
  assert.equal(await ended, "cancel");
  const q2 = createAppQueue();
  q2.add(job("b"));
  const ended2 = whenConfirmEnds();
  openAppConfirm(q2);
  buttons(body).filter((b) => b.textContent === "Confirm").at(-1).click();
  assert.equal(await ended2, "confirm");
}));
