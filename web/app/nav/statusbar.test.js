import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusBarTarget, makeScrollToTop } from "./statusbar.js";

// A box that scrolls: scrollTop, scrollTo, a style, children found by class or attribute.
function box(cls, { top = 0, shown = true, attrs = {}, kids = [] } = {}) {
  const el = {
    cls, attrs, kids, scrollTop: top, style: {}, offsetHeight: 100, calls: [],
    getClientRects: () => (shown ? [{}] : []),
    scrollTo(o) { el.calls.push(o); },
    matches(sel) { return sel.split(",").map((s) => s.trim()).some((s) => s === `.${cls}` || (s.startsWith("[") && s.slice(1, -1).split("=")[0] in attrs && (s.indexOf("=") < 0 || s.includes(`"${attrs[s.slice(1, -1).split("=")[0]]}"`)))); },
    querySelectorAll(sel) {
      const out = [];
      const walk = (e) => { for (const k of e.kids) { if (k.matches(sel)) out.push(k); walk(k); } };
      walk(el);
      return out;
    },
  };
  return el;
}
const docWith = (...dialogs) => box("doc", { kids: dialogs });
const win = { matchMedia: () => ({ matches: false }) };

test("ifizboxScrollToTop glides the top page's body to the top", () => {
  const body = box("page-body", { top: 787 });
  const scroll = makeScrollToTop(docWith(), () => body, win);
  assert.equal(scroll(), true);
  assert.deepEqual(body.calls, [{ top: 0, behavior: "smooth" }]);
});

test("at the top already, or with no page, nothing happens", () => {
  const body = box("page-body", { top: 0 });
  assert.equal(makeScrollToTop(docWith(), () => body, win)(), false);
  assert.deepEqual(body.calls, []);
  assert.equal(makeScrollToTop(docWith(), () => undefined, win)(), false);
});

test("Search's results, scrolled under its field, are what scrolls", () => {
  const results = box("search-results", { top: 1200, attrs: { "data-scroller": "" } });
  const body = box("page-body", { kids: [box("search-bar"), results] });
  assert.equal(statusBarTarget(docWith(), body), results);
  assert.equal(makeScrollToTop(docWith(), () => body, win)(), true);
  assert.equal(results.calls.length, 1);
});

test("a sheet on top scrolls its own list, not the page under it", () => {
  const list = box("sheet-scroll", { top: 400 });
  const sheet = box("sheet", { attrs: { role: "dialog" }, kids: [box("sheet-bar"), box("sheet-body", { kids: [list] })] });
  const body = box("page-body", { top: 900 });
  assert.equal(statusBarTarget(docWith(sheet), body), list);
  makeScrollToTop(docWith(sheet), () => body, win)();
  assert.equal(list.calls.length, 1);
  assert.deepEqual(body.calls, []);
});

test("a sheet scrolled to its top keeps the tap: the page under it stays", () => {
  const sheet = box("sheet", { attrs: { role: "dialog" }, kids: [box("sheet-body")] });
  const body = box("page-body", { top: 900 });
  assert.equal(statusBarTarget(docWith(sheet), body), null);
});

test("the last open dialog wins; a hidden one is skipped", () => {
  const a = box("sheet-scroll", { top: 10 });
  const b = box("action-list", { top: 20 });
  const first = box("sheet", { attrs: { role: "dialog" }, kids: [a] });
  const second = box("action-sheet", { attrs: { role: "dialog" }, kids: [b] });
  const gone = box("sheet", { attrs: { role: "dialog" }, shown: false, kids: [box("sheet-scroll", { top: 30 })] });
  assert.equal(statusBarTarget(docWith(first, second, gone), null), b);
});

test("app.js hands the native shell ifizboxScrollToTop for the top page", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /globalThis\.ifizboxScrollToTop = makeScrollToTop\(document, \(\) => stacks\.top\(\)\?\.page\.body\)/);
});

test("the native shell sends the status bar tap to ifizboxScrollToTop", () => {
  const swift = readFileSync(new URL("../../../native/Sources/StatusBarTap.swift", import.meta.url), "utf8");
  assert.match(swift, /scrollViewShouldScrollToTop/);
  assert.match(swift, /ifizboxScrollToTop/);
  const app = readFileSync(new URL("../../../native/Sources/App.swift", import.meta.url), "utf8");
  assert.match(app, /StatusBarTap\.attach\(to: w\)/);
});
