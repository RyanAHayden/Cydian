// F165: a page's description in its own group, long ones folded behind a "More" row that becomes "Less". Rendered
// over a small fake DOM (no layout here, so the toggle comes from the length estimate; the browser's layout check is
// skipped: there is no requestAnimationFrame in node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionGroup, estimateLines, needsToggle, LINES } from "./description.js";

function fakeElement(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parent: null, listeners: {}, attrs: {}, style: {}, _text: "",
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(" ").filter(Boolean)); },
    _cls: new Set(),
    classList: {
      add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
      contains: (c) => e._cls.has(c),
      toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
    },
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
    set textContent(v) { e._text = String(v); e.children = []; },
    get firstElementChild() { return e.children.find((c) => c.tagName) ?? null; },
    append(...k) {
      for (const c of k) {
        if (c == null) continue;
        if (typeof c === "string") { e.children.push({ nodeType: 3, textContent: c }); continue; }
        if (c.tagName === "#FRAG") { for (const x of [...c.children]) e.append(x); continue; }
        c.parent?.children.splice(c.parent.children.indexOf(c), 1);
        c.parent = e;
        e.children.push(c);
      }
    },
    replaceChildren(...k) { e.children = []; e._text = ""; e.append(...k); },
    remove() { if (e.parent) { e.parent.children.splice(e.parent.children.indexOf(e), 1); e.parent = null; } },
    replaceWith(n) { const p = e.parent; const i = p.children.indexOf(e); e.remove(); n.parent = p; p.children.splice(i, 0, n); },
    closest() { return null; },
    querySelector(sel) { return all(e).slice(1).find((n) => matches(n, sel)) ?? null; },
    setAttribute(a, v) { e.attrs[a] = String(v); },
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}
const matches = (n, sel) => (sel.startsWith(".") ? n.classList?.contains(sel.slice(1)) : n.tagName === sel.toUpperCase());
const all = (root, out = []) => { out.push(root); for (const c of root.children ?? []) all(c, out); return out; };
const byClass = (root, cls) => all(root).filter((n) => n.classList?.contains(cls));

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: fakeElement, createDocumentFragment: () => fakeElement("#frag") };
  try { return fn(); } finally { globalThis.document = saved; }
}

const tap = (row) => { const b = row.querySelector(".cell-inner"); for (const f of b.listeners.click) f({ currentTarget: b }); };
const toggleRows = (g) => byClass(g, "desc-more");

// YouMod-style: many paragraphs, some long.
const LONG = ["YouMod is a tweaked YouTube with everything you want.", "", "Features:",
  ...Array.from({ length: 20 }, (_, i) => `• Feature number ${i} that does a useful thing for playback and downloads`),
  "Source: https://example.com/youmod."].join("\n");

test("F165: a long description gets its own Description group, collapsed, with a More row", () => withDom(() => {
  assert.ok(needsToggle(LONG));
  const g = descriptionGroup(LONG);
  assert.equal(g.querySelector(".group-header").textContent, "Description");
  const [box] = byClass(g, "desc-text");
  assert.ok(box.classList.contains("pkg-description"));
  assert.ok(box.classList.contains("collapsed"), "folded to its first lines");
  assert.equal(box.textContent, LONG, "the whole text, line breaks kept");
  const rows = toggleRows(g);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".cell-label").textContent, "More");
  assert.ok(rows[0].classList.contains("perm-more"), "drawn like Permissions' toggle");
  assert.ok(!rows[0].classList.contains("up"));
  assert.equal(g.querySelector("ul").children.at(-1), rows[0], "the row sits under the text in the same table");
}));

test("F165: More opens it in place and becomes Less; Less folds it again", () => withDom(() => {
  const g = descriptionGroup(LONG);
  const [box] = byClass(g, "desc-text");
  tap(toggleRows(g)[0]);
  assert.ok(!box.classList.contains("collapsed"), "opened");
  let rows = toggleRows(g);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".cell-label").textContent, "Less");
  assert.ok(rows[0].classList.contains("up"));
  tap(rows[0]);
  assert.ok(box.classList.contains("collapsed"), "folded again");
  rows = toggleRows(g);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".cell-label").textContent, "More");
}));

test("F165: a short description is shown whole, with no toggle", () => withDom(() => {
  for (const short of ["A small app.", "Line one\nLine two\nLine three", "x".repeat(40 * (LINES + 1))]) {
    assert.ok(!needsToggle(short), short.slice(0, 20));
    const g = descriptionGroup(short);
    assert.equal(g.querySelector(".group-header").textContent, "Description");
    assert.equal(toggleRows(g).length, 0);
    assert.ok(!byClass(g, "desc-text")[0].classList.contains("collapsed"));
  }
}));

test("F165: links in the text become links; the line estimate counts paragraphs", () => withDom(() => {
  const [box] = byClass(descriptionGroup(LONG), "desc-text");
  const [a] = byClass(box, "desc-link");
  assert.equal(a.tagName, "A");
  assert.equal(a.href, "https://example.com/youmod", "trailing full stop left out");
  assert.equal(a.target, "_blank");
  assert.match(a.rel, /noopener/);
  assert.equal(byClass(descriptionGroup("see javascript:alert(1) or ftp://x"), "desc-link").length, 0, "only http(s)");
  assert.equal(estimateLines("a\n\nb"), 3);
  assert.equal(estimateLines("x".repeat(81)), 3);
}));
