// B81: without a jailbreak the IPA queue (app-queue.js) drives Installed's Q'd badge and a Queue button on the left of
// its root (in the Wish List button's place), which reopens Confirm; Manage on hides it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appChromeState, initAppQueueChrome, updateAppChrome, setAppChromeManaging } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";

// ---- a small fake DOM: barButton's element, the left slot, the Wish List button ----------------------------------
function make(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, dataset: {}, parentNode: null,
    textContent: "", _cls: new Set(),
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
      toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return e.attrs[k] ?? null; },
    append(...c) { for (const x of c) if (x && typeof x === "object") { x.parentNode = e; e.children.push(x); } },
    prepend(...c) { for (const x of c.reverse()) if (x && typeof x === "object") { x.parentNode = e; e.children.unshift(x); } },
    replaceChildren(...c) { e.children = []; e.append(...c); },
    remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      const walk = (n) => { for (const k of n.children) { if (k._cls?.has(cls)) return k; const f = walk(k); if (f) return f; } return null; };
      return walk(e);
    },
    querySelectorAll: () => [],
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
    click() { for (const f of e.listeners.click ?? []) f({ preventDefault() {}, stopPropagation() {} }); },
  };
  return e;
}

const job = (id) => ({ id, name: id, version: "1.0", installed: "1.0", url: `https://example.invalid/${id}.ipa` });

test("the state: Q'd and Queue while apps are queued; no badge with Confirm open or a run going; Manage hides Queue", () => {
  assert.deepEqual(appChromeState({ size: 0 }), { badge: null, button: false });
  assert.deepEqual(appChromeState({ size: 2 }), { badge: "Q'd", button: true });
  assert.deepEqual(appChromeState({ size: 2, confirmOpen: true }), { badge: null, button: true });
  assert.deepEqual(appChromeState({ size: 2, running: true }), { badge: null, button: false });
  assert.deepEqual(appChromeState({ size: 2, managing: true }), { badge: "Q'd", button: false });
});

test("appQueue add / clear toggles the badge and the Queue button; the button opens Confirm", () => {
  const saved = globalThis.document;
  globalThis.document = { createElement: make, createTextNode: (t) => Object.assign(make("#text"), { textContent: String(t) }), querySelector: () => null };
  try {
    const badges = [];
    const queue = createAppQueue();
    initAppQueueChrome({ setBadge: (tab, v) => badges.push([tab, v]) }, { queue });
    const left = make("div");
    const wish = make("button");
    wish.className = "bar-button wish-button";
    left.append(wish);
    let opened = 0;
    const draw = () => updateAppChrome({ left, open: () => { opened++; } });

    draw();
    assert.equal(left.querySelector(".queue-button"), null);
    assert.equal(wish.style.display, "");
    assert.deepEqual(badges.at(-1), ["installed", null]);

    queue.add(job("com.example.a"));
    draw();
    const b = left.querySelector(".queue-button");
    assert.ok(b, "Queue button drawn");
    assert.equal(left.children[0], b, "Queue is first in the left slot");
    assert.equal(wish.style.display, "none", "Queue takes the Wish List button's place");
    assert.deepEqual(badges.at(-1), ["installed", "Q'd"]);
    b.click();
    assert.equal(opened, 1, "the button opens Confirm");

    setAppChromeManaging(true);
    draw();
    assert.equal(left.querySelector(".queue-button"), null, "Manage on hides Queue");
    assert.equal(wish.style.display, "", "the left button is back (Select… while managing)");
    setAppChromeManaging(false);
    draw();
    assert.ok(left.querySelector(".queue-button"));

    queue.clearAll();
    draw();
    assert.equal(left.querySelector(".queue-button"), null);
    assert.equal(wish.style.display, "");
    assert.deepEqual(badges.at(-1), ["installed", null]);
  } finally {
    globalThis.document = saved;
  }
});

test("Installed starts the chrome without a jailbreak, and Manage tells it when it turns", () => {
  const src = readFileSync(new URL("./installed.js", import.meta.url), "utf8");
  assert.match(src, /recordsApps\(\)[^\n]*initAppQueueChrome\(ctx\)/);
  assert.match(src, /setAppChromeManaging\(on\)/);
});
