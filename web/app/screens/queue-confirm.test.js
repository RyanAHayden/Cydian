// F218: the Confirm sheets' Cancel (it clears the queue) is the red bar button, ios6.css's .bar-button.red, with its
// pressed, dark and palette variants; nothing else uses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { confirmCancel, openAppConfirm } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";

const here = new URL(".", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), "utf8");

// ---- a fake DOM, enough for modal() and the app Confirm's body ---------------------------------------------------
function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: { setProperty() {} }, attrs: {}, dataset: {},
      parentNode: null, textContent: "", hidden: false, disabled: false, type: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) { return e.attrs[k] ?? null; },
      removeAttribute(k) { delete e.attrs[k]; },
      append(...c) {
        for (const x of c) {
          if (x?.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          if (typeof x !== "object" || x === null) continue;
          x.parentNode = e;
          e.children.push(x);
        }
      },
      appendChild(x) { e.append(x); return x; },
      prepend(...c) { e.append(...c); },
      replaceChildren(...c) { e.children = []; e.append(...c); },
      remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      removeEventListener() {},
      animate: () => ({ finished: Promise.resolve(), cancel() {} }),
      click() { for (const f of e.listeners.click ?? []) f({ preventDefault() {}, stopPropagation() {} }); },
    };
    return e;
  };
  const body = make("body");
  return { body, createElement: make, createElementNS: (_ns, t) => make(t),
    createTextNode: (t) => Object.assign(make("#text"), { textContent: String(t) }),
    createDocumentFragment: () => Object.assign(make("#fragment"), { isFragment: true }) };
}

function withDom(fn) {
  return async () => {
    const saved = globalThis.document;
    globalThis.document = fakeDom();
    try { await fn(globalThis.document); } finally { globalThis.document = saved; }
  };
}

const find = (e, pred) => (pred(e) ? e : e.children.map((c) => find(c, pred)).find(Boolean) ?? null);

test("confirmCancel is a red bar button reading Cancel", withDom(() => {
  const b = confirmCancel();
  assert.equal(b.tagName, "BUTTON");
  assert.equal(b.textContent, "Cancel");
  assert.ok(b.classList.contains("bar-button") && b.classList.contains("red"), b.className);
  assert.ok(!b.classList.contains("done"));
}));

test("the app Confirm sheet's left button is the red Cancel and Confirm stays blue Done", withDom((doc) => {
  const q = createAppQueue();
  q.add({ id: "com.x.a", name: "A", url: "https://s/a.ipa", size: 2048 });
  openAppConfirm(q);
  const sheet = find(doc.body, (e) => e._cls.has("confirm-sheet"));
  assert.ok(sheet, "Confirm opened");
  const left = find(sheet, (e) => e._cls.has("sheet-left"));
  const right = find(sheet, (e) => e._cls.has("sheet-right"));
  assert.equal(left.children.length, 1);
  assert.equal(left.children[0].textContent, "Cancel");
  assert.ok(left.children[0].classList.contains("red"), left.children[0].className);
  assert.ok(right.children[0].classList.contains("done") && !right.children[0].classList.contains("red"));
  left.children[0].click(); // Cancel clears the queue and closes the sheet
  assert.equal(q.size, 0);
}));

test("the package Confirm sheet (openConfirm) uses the red Cancel too", () => {
  const src = read("queue.js");
  const body = (name) => {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, name);
    return src.slice(i, src.indexOf("\n}\n", i));
  };
  for (const fn of ["openConfirm", "openAppConfirm"]) {
    const b = body(fn);
    assert.match(b, /const cancel = confirmCancel\(\);/, fn);
    assert.match(b, /modal\(\{ title: "Confirm", left: cancel,/, fn);
  }
});

test("only Confirm's Cancel uses the red bar button", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  const navDir = new URL("../nav/", here);
  const hits = [];
  for (const f of files) if (/barButton\([^)]*["']red["']/.test(read(f))) hits.push(f);
  for (const f of readdirSync(navDir).filter((x) => x.endsWith(".js") && !x.endsWith(".test.js"))) {
    if (/barButton\([^)]*["']red["']/.test(readFileSync(new URL(f, navDir), "utf8"))) hits.push(`nav/${f}`);
  }
  assert.deepEqual(hits, ["queue.js"]);
  assert.equal(read("queue.js").match(/barButton\([^)]*["']red["']/g).length, 1);
});

test("ios6.css: .bar-button.red has a pressed state, dark variants, and a border-box gradient everywhere", () => {
  const css = read("../ios6.css");
  const rules = [
    ".bar-button.red:not(.back):not(.done) {",
    ".bar-button.red:not(.back):not(.done):is(:active, .is-pressed) {",
    'html[data-theme="dark"] .bar-button.red:not(.back):not(.done) {',
    'html[data-theme="dark"] .bar-button.red:not(.back):not(.done):is(:active, .is-pressed) {',
  ];
  for (const r of rules) {
    const i = css.indexOf(r);
    assert.ok(i >= 0, r);
    const block = css.slice(i, css.indexOf("}", i));
    assert.match(block, /background: var\(--(lt|dk)-red(-pressed)?\); background-origin: border-box;/, r);
    assert.match(block, /border-color: var\(--(lt|dk)-red(-pressed)?-edge\)/, r);
  }
  // UINavigationBarRemoveButton's colours (light) and ...Dark's split gloss
  assert.match(css, /--lt-red: linear-gradient\(#d4848b, #b01a27\);/);
  assert.match(css, /--dk-red: linear-gradient\(#d07079, #b82e3a 51\.7%, #b01825 51\.7%\);/);
  const pal = read("../palettes.css");
  assert.match(pal, /\[data-palette="solarized"\]\) \.bar-button\.red:not\(\.back\):not\(\.done\) \{/);
});
