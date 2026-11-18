// F146: the alert's Paste button (Enter APT URL's) reads UIPasteboard through the bridge in the app (a tap: no
// `auto`, so it always reads), and Safari's navigator.clipboard only on the website or a shell without clipboard.read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { showAlert } from "./alert.js";

function fakeDom() {
  const make = (tag) => {
    const el = {
      tag, children: [], listeners: {}, style: {}, attrs: {}, className: "", value: "",
      classList: { add() {}, remove() {}, contains: () => false },
      append(...kids) { el.children.push(...kids); }, remove() {}, setAttribute(k, v) { el.attrs[k] = v; },
      addEventListener(t, f) { (el.listeners[t] ??= []).push(f); }, removeEventListener() {},
      animate: () => ({ finished: Promise.resolve() }), focus() {}, blur() {},
    };
    return el;
  };
  const all = [];
  return {
    all,
    document: {
      createElement: (tag) => { const e = make(tag); all.push(e); return e; },
      body: { append() {} }, documentElement: { scrollTop: 0 },
      addEventListener() {}, removeEventListener() {},
    },
  };
}

async function tapPaste({ native, clipboard }) {
  const dom = fakeDom();
  const saved = { document: globalThis.document, native: globalThis.cydianNative,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  globalThis.document = dom.document;
  if (native) globalThis.cydianNative = native; else delete globalThis.cydianNative;
  let readText = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { clipboard: { readText: async () => { readText++; return clipboard; } } } });
  try {
    showAlert({ title: "Enter APT URL", input: { value: "https://", type: "url", paste: (t) => t.trim() }, buttons: ["Cancel", "Add Source"] });
    const paste = dom.all.find((e) => e.className === "alert-paste");
    const field = dom.all.find((e) => e.className === "alert-field");
    await paste.listeners.click[0]();
    return { value: field.value, readText };
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.cydianNative; else globalThis.cydianNative = saved.native;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator); else delete globalThis.navigator;
  }
}

test("F146: in the app, Paste reads the bridge (a tap, no auto), never Safari's clipboard", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return "https://ipa.test/apps.json"; } };
  const r = await tapPaste({ native, clipboard: "https://web.test/" });
  assert.equal(r.value, "https://ipa.test/apps.json");
  assert.equal(r.readText, 0);
  assert.deepEqual(calls, [["clipboard.read", {}]]);
});

test("F146: on the website (or a shell without clipboard.read) Paste asks Safari", async () => {
  assert.deepEqual(await tapPaste({ clipboard: " https://web.test/ " }), { value: "https://web.test/", readText: 1 });
  const old = { call: async () => { throw new Error("unknown method clipboard.read"); } };
  assert.deepEqual(await tapPaste({ native: old, clipboard: "https://web.test/" }), { value: "https://web.test/", readText: 1 });
});
