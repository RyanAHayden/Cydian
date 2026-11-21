// F146: the alert's Paste button (Enter APT URL's) reads UIPasteboard through the bridge in the app (a tap: no
// `auto`, so it always reads), and Safari's navigator.clipboard only on the website or a shell without clipboard.read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { showAlert } from "./alert.js";
import { fakeDocument } from "./fakedom.test-helper.js";

// The shared fake document, keeping every element it makes in `all`.
function fakeDom() {
  const document = fakeDocument();
  const all = [];
  const make = document.createElement;
  document.createElement = (tag) => { const e = make(tag); all.push(e); return e; };
  return { all, document };
}

async function tapPaste({ native, clipboard }) {
  const dom = fakeDom();
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  globalThis.document = dom.document;
  if (native) globalThis.ifizboxNative = native; else delete globalThis.ifizboxNative;
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
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
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

// B168: Sign In With Key passes `paste: true` (no cleaning function). Its Paste button threw "input.paste is not a
// function" and left the field empty, in the app and on the website alike.
async function tapPasteWith(paste, { native, clipboard }) {
  const dom = fakeDom();
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  globalThis.document = dom.document;
  if (native) globalThis.ifizboxNative = native; else delete globalThis.ifizboxNative;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => clipboard } } });
  try {
    showAlert({ title: "Sign In With Key", input: { placeholder: "XXXX-XXXX-XXXX-…", value: "", paste }, buttons: ["Cancel", "Sign In"] });
    const button = dom.all.find((e) => e.className === "alert-paste");
    const field = dom.all.find((e) => e.className === "alert-field");
    await button.listeners.click[0]();
    return field.value;
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator); else delete globalThis.navigator;
  }
}

test("B168: paste: true pastes the copy as it is (trimmed), through the bridge in the app", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return "  ABCD-EFGH-IJKL-MNOP\n"; } };
  assert.equal(await tapPasteWith(true, { native, clipboard: "wrong" }), "ABCD-EFGH-IJKL-MNOP");
  assert.deepEqual(calls, [["clipboard.read", {}]]);
});

test("B168: paste: true on the website reads Safari's clipboard; nothing copied leaves the field alone", async () => {
  assert.equal(await tapPasteWith(true, { clipboard: "ifizbox://account?key=ABCD" }), "ifizbox://account?key=ABCD");
  const native = { call: async () => "" };
  assert.equal(await tapPasteWith(true, { native, clipboard: "x" }), "");
});

test("B168: text fields take back the callout the body turns off, so holding one offers Paste", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /body \{[^}]*-webkit-touch-callout: none/, "the body still turns it off");
  const rule = css.match(/\ninput:not\([^{]*\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /-webkit-touch-callout: default/);
  assert.match(rule, /-webkit-user-select: text/);
  assert.match(rule, /textarea/);
});
