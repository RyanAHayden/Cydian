// F165: a page's description in its own group, long ones folded behind a "More" row that becomes "Less". Rendered
// over a small fake DOM (no layout here, so the toggle comes from the length estimate; the browser's layout check is
// skipped: there is no requestAnimationFrame in node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionGroup, estimateLines, needsToggle, LINES, growOpen, endGrow } from "./description.js";
import { withDocument as withDom, fakeDocument } from "../fakes.test-helper.js";

const all = (root, out = []) => { out.push(root); for (const c of root.children ?? []) all(c, out); return out; };
const byClass = (root, cls) => all(root).filter((n) => n.classList?.contains(cls));

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

// B271: More grows the text in place: the page keeps its scroll position and the text is uncovered downward by a
// clip whose bottom edge starts at the folded height (the rows below slide with it: nav/slide.js).
test("B271: growOpen keeps the scroll position and uncovers the text downward from the folded height", () => {
  const scroller = { scrollTop: 300 };
  const anims = [];
  const box = { offsetHeight: 140, closest: (sel) => (sel.includes(".page-body") ? scroller : null),
    animate: (frames, timing) => { const a = { frames, timing, cancel() { a.cancelled = true; } }; anims.push(a); return a; } };
  const a = growOpen(box, () => {
    box.offsetHeight = 600;
    scroller.scrollTop = 760; // what the old code (or the browser) did: follow the row down
  });
  assert.equal(scroller.scrollTop, 300, "no jump, no scroll into view");
  assert.equal(anims.length, 1);
  assert.deepEqual(a.frames, [{ clipPath: "inset(0 0 460px 0)" }, { clipPath: "inset(0 0 0 0)" }]);
  assert.equal(a.timing.duration, 300, "the rows' .3s");
  assert.ok(a.frames.every((f) => Object.keys(f).every((k) => k === "clipPath")), "nothing but the clip animates");
  endGrow(box);
  assert.ok(a.cancelled, "Less while it opens stops it");
});

test("B271: growOpen with no layout (not on screen) just opens, still without moving the page", () => {
  const box = { offsetHeight: 0, animate() { throw new Error("nothing to slide"); } };
  let opened = false;
  assert.equal(growOpen(box, () => { opened = true; }), null);
  assert.ok(opened);
});

test("B271: More leaves the scroll alone; Less still scrolls back to the description", () => {
  // Every node says it is 150px from the top (where the folded row lands); the tapped row says 400 (tapIn).
  const doc = fakeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (t) => Object.assign(make(t), { getBoundingClientRect: () => ({ top: 150 }) });
  return withDom(() => runLessTest(), doc);
});

function runLessTest() {
  const g = descriptionGroup(LONG);
  const scroller = { scrollTop: 500 };
  const tapIn = (row) => {
    const b = row.querySelector(".cell-inner");
    b.closest = () => scroller;
    b.getBoundingClientRect = () => ({ top: 400 });
    for (const f of b.listeners.click) f({ currentTarget: b });
  };
  tapIn(toggleRows(g)[0]);
  assert.equal(scroller.scrollTop, 500, "More: not scrolled");
  tapIn(toggleRows(g)[0]);
  assert.equal(scroller.scrollTop, 250, "Less: the page follows the row back up");
}
