// F105: Sources' Add in the app (screens/sources.js addFromClipboard with a native bridge): Enter APT URL opens at
// once, inside the tap, then takes the copied source URL from UIPasteboard (clipboard.read); no URL, a refused read
// or text already typed leave the field alone. Never the website's navigator.clipboard, never the blue Type state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addFromClipboard } from "./sources.js";

function fakeButton() {
  const parent = { removed: 0, insertBefore() {} };
  const classes = new Set(["is-pressed", "done"]);
  return {
    textContent: "Type", parentNode: parent, nextSibling: null, isConnected: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    remove() { parent.removed++; },
  };
}

// A bridge answering clipboard.read with `answer` (a function, so it can throw), and an `open` that builds the
// alert's field the way showAlert does, synchronously, before its first await.
async function run(answer, { typeFirst = null } = {}) {
  const field = { value: "", isConnected: true, listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); } };
  const saved = { document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  let readText = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => { readText++; return "https://web.test/"; } } } });
  let opened = 0;
  globalThis.document = { querySelectorAll: (sel) => (sel === ".alert-field" && opened ? [field] : []) };
  const calls = [];
  const native = {
    call: async (method) => {
      calls.push(method);
      if (typeFirst != null) { field.value = typeFirst; for (const f of field.listeners.input ?? []) f(); }
      return answer();
    },
  };
  const button = fakeButton();
  let openedBeforeRead = null;
  const open = (ctx, prefill) => { opened++; openedBeforeRead = calls.length === 0; assert.equal(prefill, null); field.value = "https://"; return Promise.resolve("shown"); };
  try {
    const r = await addFromClipboard({}, button, { native, open });
    return { r, field, calls, readText, opened, openedBeforeRead, button };
  } finally {
    globalThis.document = saved.document;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
  }
}

test("F105: a copied source URL: the alert opens first (inside the tap), then its field takes the URL", async () => {
  const { r, field, calls, readText, opened, openedBeforeRead, button } = await run(() => "  https://repo.test/ ");
  assert.equal(r, "shown");
  assert.equal(opened, 1);
  assert.equal(openedBeforeRead, true, "the alert opens before the bridge round trip");
  assert.deepEqual(calls, ["clipboard.read"]);
  assert.equal(field.value, "https://repo.test/");
  assert.equal(readText, 0, "no navigator.clipboard: no WebKit Paste bubble");
  assert.equal(button.textContent, "Add");
  assert.equal(button.classList.contains("done"), false, "no blue Type left over");
  assert.equal(button.classList.contains("is-pressed"), false, "not left pressed");
  assert.equal(button.parentNode.removed, 1, "re-inserted to leave WebKit's :active chain");
});

test("F105: a bare host is made a URL; text with no URL leaves https:// to type after", async () => {
  assert.equal((await run(() => "repo.test")).field.value, "https://repo.test/");
  const none = await run(() => "hello there");
  assert.equal(none.field.value, "https://");
  assert.equal(none.opened, 1);
  assert.equal((await run(() => null)).field.value, "https://", "empty clipboard");
});

test("F105: a refused read (Allow Paste denied, no clipboard.read) opens the empty alert, no bubble", async () => {
  const r = await run(() => { throw new Error("unknown method clipboard.read"); });
  assert.equal(r.opened, 1);
  assert.equal(r.field.value, "https://");
  assert.equal(r.readText, 0);
});

test("F105: what the user started typing before the read answered is kept", async () => {
  const r = await run(() => "https://repo.test/", { typeFirst: "https://mine.test" });
  assert.equal(r.field.value, "https://mine.test");
});
