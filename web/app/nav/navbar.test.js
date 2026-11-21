import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collapseOf, collapseStyle, attachLargeTitle, setLargeTitles, largeTitlesOn, LARGE_TITLE_H } from "./navbar.js";
import { pageHandle } from "./go.js";
import { fakeDocument, fakePage } from "./fakedom.test-helper.js";

// C54: the large-title nav hook. Off (iOS 6) nothing is drawn; on, a root page's title sits big at the top of its
// body and collapses into the bar as the body scrolls, by opacity only.

function page(doc, title = "Sources") {
  const body = fakePage();
  body.className = "page-body grouped";
  body.scrollTop = 0;
  const item = doc.createElement("div");
  item.className = "nav-item";
  const h1 = doc.createElement("h1");
  h1.className = "nav-title";
  h1.textContent = title;
  item.append(doc.createElement("div"), h1, doc.createElement("div"));
  pageHandle(item, body);
  return { body, item, h1 };
}

test("collapse runs 0 to 1 over the large title's height", () => {
  assert.equal(collapseOf(0, 52), 0);
  assert.equal(collapseOf(-30, 52), 0);
  assert.equal(collapseOf(26, 52), 0.5);
  assert.equal(collapseOf(52, 52), 1);
  assert.equal(collapseOf(400, 52), 1);
  assert.equal(collapseOf(10, 0), 1);
});

test("the large title fades as it goes under the bar, and the bar title fades in only past half way", () => {
  const top = collapseStyle(0, 52);
  assert.deepEqual(top, { large: { opacity: "1" }, bar: { opacity: "0" } });
  const half = collapseStyle(26, 52);
  assert.equal(half.large.opacity, "0.5");
  assert.equal(half.bar.opacity, "0");
  const three = collapseStyle(39, 52);
  assert.equal(three.bar.opacity, "0.5");
  const gone = collapseStyle(80, 52);
  assert.deepEqual(gone, { large: { opacity: "0" }, bar: { opacity: "1" } });
});

test("pulled past the top the large title stays in full and the bar title hidden", () => {
  assert.deepEqual(collapseStyle(-40, 52), { large: { opacity: "1" }, bar: { opacity: "0" } });
});

test("only opacity is written, on the large title and the bar title", () => {
  const doc = fakeDocument();
  const { body, item, h1 } = page(doc);
  const lt = attachLargeTitle(body, item, doc);
  assert.equal(body.firstElementChild, lt.el);
  assert.equal(lt.el.textContent, "Sources");
  assert.equal(lt.el.getAttribute("aria-hidden"), "true");
  for (const y of [0, 13, 30, 45, 52, 200, -20]) {
    body.scrollTop = y;
    lt.update();
    const s = collapseStyle(y, LARGE_TITLE_H);
    assert.equal(lt.el.style.opacity, s.large.opacity);
    assert.equal(h1.style.opacity, s.bar.opacity);
  }
  for (const k of Object.keys(lt.el.style)) assert.equal(k, "opacity");
  for (const k of Object.keys(h1.style)) assert.equal(k, "opacity");
  lt.destroy();
  assert.equal(body.children.length, 0);
  assert.equal(h1.style.opacity, "");
});

test("a scroll event collapses the title on the next frame", () => {
  const doc = fakeDocument();
  const { body, item, h1 } = page(doc);
  const frames = [];
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  try {
    const lt = attachLargeTitle(body, item, doc);
    body.scrollTop = 52;
    body.fire("scroll");
    body.fire("scroll"); // one frame for any number of scroll events
    assert.equal(frames.length, 1);
    assert.equal(h1.style.opacity, "0");
    frames.shift()();
    assert.equal(lt.el.style.opacity, "0");
    assert.equal(h1.style.opacity, "1");
    lt.destroy();
  } finally {
    if (raf) globalThis.requestAnimationFrame = raf; else delete globalThis.requestAnimationFrame;
  }
});

test("redrawn body and retitled bar keep the large title first and in step", () => {
  const doc = fakeDocument();
  const { body, item, h1 } = page(doc);
  const lt = attachLargeTitle(body, item, doc);
  body.replaceChildren(doc.createElement("ul"));
  h1.textContent = "Other";
  lt.keep(); // what the MutationObservers run in a browser
  assert.equal(body.firstElementChild, lt.el);
  assert.equal(lt.el.textContent, "Other");
  lt.destroy();
});

test("no large title for a page whose title is a control", () => {
  const doc = fakeDocument();
  const { body, item, h1 } = page(doc);
  h1.classList.add("nav-title-view");
  assert.equal(attachLargeTitle(body, item, doc), null);
  assert.equal(body.children.length, 0);
});

test("off by default; on draws root pages only; off again takes them away", () => {
  const doc = fakeDocument();
  const stack = doc.createElement("div");
  stack.className = "tab-stack";
  doc.body.append(stack);
  const root = page(doc, "Home"), pushed = page(doc, "Settings");
  for (const p of [root, pushed]) {
    const section = doc.createElement("section");
    section.className = "page";
    section.append(p.body);
    stack.append(section);
  }
  assert.equal(largeTitlesOn(doc), false);
  assert.equal(root.body.children.length, 0);
  setLargeTitles(true, doc);
  assert.equal(largeTitlesOn(doc), true);
  assert.equal(root.body.firstElementChild?.className, "large-title");
  assert.equal(root.body.firstElementChild.textContent, "Home");
  assert.equal(root.h1.style.opacity, "0");
  assert.equal(pushed.body.children.length, 0);
  assert.deepEqual(Object.keys(pushed.h1.style), []); // the pushed page's bar title is never written
  setLargeTitles(false, doc);
  assert.equal(largeTitlesOn(doc), false);
  assert.equal(root.body.children.length, 0);
  assert.equal(root.h1.style.opacity, "");
});

test("Home's root page gets no large title", () => {
  const doc = fakeDocument();
  const stack = doc.createElement("div");
  stack.className = "tab-stack";
  stack.dataset.tab = "home";
  doc.body.append(stack);
  const root = page(doc, "Home");
  const section = doc.createElement("section");
  section.className = "page";
  section.append(root.body);
  stack.append(section);
  setLargeTitles(true, doc);
  assert.equal(root.body.children.length, 0);
  assert.deepEqual(Object.keys(root.h1.style), []);
  setLargeTitles(false, doc);
});

test("style.css draws the large title only behind the hook, 34px bold on the left", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.large-title \{ display: none; \}/);
  const rule = /html\[data-nav="large"\] \.large-title \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /font-size: 34px/);
  assert.match(rule, /font-weight: 700/);
  assert.match(rule, /text-align: left/);
  assert.match(rule, /height: var\(--large-title-h\)/);
});
