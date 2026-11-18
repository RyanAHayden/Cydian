import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionOpacity, selectRow, rowKey, findRow, keepRow, ghostFor } from "./selection.js";
import { setProgress, clear, animate } from "./transition.js";

const el = () => ({ style: {}, animate: () => ({ finished: new Promise(() => {}), cancel() {} }) });
const pairWith = (select) => ({
  top: { page: el(), shade: el(), item: el() },
  below: { page: el(), shade: el(), item: el(), select },
});

test("highlight opacity follows the pop's progress: full at the start, gone when the page below is back", () => {
  assert.equal(selectionOpacity(1), 1);
  assert.equal(selectionOpacity(0.75), 0.75);
  assert.equal(selectionOpacity(0.5), 0.5);
  assert.equal(selectionOpacity(0), 0);
  // out-of-range progress (a finger past the edge) clamps
  assert.equal(selectionOpacity(1.2), 1);
  assert.equal(selectionOpacity(-0.1), 0);
  assert.equal(selectionOpacity(NaN), 0);
});

test("an edge swipe fades the row with the finger; a cancelled swipe brings it back to full", () => {
  const ghost = el();
  const pair = pairWith(ghost);
  const seen = [];
  for (const p of [1, 0.8, 0.5, 0.3]) { setProgress(pair, p); seen.push(Number(ghost.style.opacity)); }
  assert.deepEqual(seen, [1, 0.8, 0.5, 0.3]); // steadily fading as the page below comes in
  // let go before half: the slide runs back to p = 1 and ends there
  const run = animate(pair, 0.3, 1, { duration: 100 });
  run.finish();
  assert.equal(ghost.style.opacity, "1");
  clear(pair); // at rest the stylesheet decides again: the copy's own opacity, 1
  assert.equal(ghost.style.opacity, "");
});

test("a committed swipe or Back ends with the highlight at 0", () => {
  const ghost = el();
  const pair = pairWith(ghost);
  setProgress(pair, 0.6);
  animate(pair, 0.6, 0, { duration: 100 }).finish();
  assert.equal(ghost.style.opacity, "0");
  const back = el();
  animate(pairWith(back), 1, 0).finish(); // Back: the whole pop slide
  assert.equal(back.style.opacity, "0");
});

test("the fade runs in step with the slide: same keyframes' timing, opacity only", () => {
  const calls = [];
  const ghost = { style: {}, animate: (kf, opts) => { calls.push({ kf, opts }); return { finished: new Promise(() => {}), cancel() {} }; } };
  const pair = pairWith(ghost);
  const page = pair.top.page;
  let pageOpts;
  page.animate = (kf, opts) => { pageOpts = opts; return { finished: new Promise(() => {}), cancel() {} }; };
  animate(pair, 1, 0, { duration: 350, easing: "ease" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].kf, [{ opacity: "1" }, { opacity: "0" }]);
  assert.deepEqual(calls[0].opts, pageOpts);
});

test("a push or a pair without a selected row is untouched", () => {
  const pair = pairWith(null);
  setProgress(pair, 0.5);
  clear(pair);
  animate(pair, 0, 1).finish();
  assert.equal(pair.below.select, null);
});

test("selectRow lays a blue, inert copy over the row and takes it away again", () => {
  const made = [];
  const node = (attrs = {}) => {
    const n = {
      attrs: { ...attrs }, classes: new Set(), children: [], style: {}, isConnected: true, inert: false,
      removeAttribute(k) { delete this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; },
      classList: null, querySelectorAll: () => n.children.filter((c) => "id" in c.attrs),
      append(c) { this.children.push(c); c.parent = this; }, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
    };
    n.classList = { add: (...c) => c.forEach((x) => n.classes.add(x)) };
    return n;
  };
  const li = node();
  const row = node({ href: "#/x", id: "r1" });
  row.parentElement = li;
  row.cloneNode = () => { const c = node({ ...row.attrs }); made.push(c); return c; };
  const win = { getComputedStyle: () => ({ position: "static" }) };
  const sel = selectRow(row, win);
  const ghost = made[0];
  assert.equal(sel.el, ghost);
  assert.ok(ghost.classes.has("is-pressed") && ghost.classes.has("sel-ghost"));
  assert.equal(ghost.attrs.href, undefined);
  assert.equal(ghost.attrs.id, undefined);
  assert.equal(ghost.attrs["aria-hidden"], "true");
  assert.equal(ghost.inert, true);
  assert.equal(li.style.position, "relative");
  assert.deepEqual(li.children, [ghost]);
  sel.remove();
  assert.deepEqual(li.children, []);
  assert.equal(li.style.position, "");
  assert.equal(selectRow(null, win), null);
});

// A tiny DOM stand-in: rows with an href or a label, in a list that can be re-rendered.
function fakeList(specs) {
  const root = { rows: [], querySelectorAll: (sel) => (sel.startsWith(".cell-inner") ? root.rows.filter((r) => !r.ghost) : []) };
  const render = () => {
    root.rows = specs.map((sp) => {
      const li = { style: {}, kids: [], append(c) { this.kids.push(c); c.li = this; c.isConnected = true; root.rows.push(c); } };
      const row = {
        ...sp, li, isConnected: true, parentElement: li, classList: { add: (...c) => { if (c.includes("sel-ghost")) row.ghost = true; } },
        getAttribute: (k) => (k === "href" ? sp.href ?? null : null),
        querySelector: () => (sp.label ? { textContent: sp.label } : null), textContent: sp.label ?? "",
        cloneNode() {
          const g = { ...this, ghost: false, querySelectorAll: () => [], removeAttribute() {}, setAttribute() {},
            remove() { g.isConnected = false; root.rows = root.rows.filter((r) => r !== g); } };
          g.classList = { add: (...c) => { if (c.includes("sel-ghost")) g.ghost = true; } };
          return g;
        },
      };
      return row;
    });
    for (const r of root.rows) r.isConnected = true;
  };
  render();
  return { root, render, detachAll: () => { for (const r of root.rows) r.isConnected = false; render(); } };
}
const win = { getComputedStyle: () => ({ position: "relative" }) };

test("a row is known again by its link, or by its label when it is a button", () => {
  assert.deepEqual(rowKey({ getAttribute: () => "#/sources/x" }), { href: "#/sources/x" });
  assert.deepEqual(rowKey({ getAttribute: () => null, querySelector: () => ({ textContent: " Export " }) }), { label: "Export" });
  assert.equal(rowKey({ getAttribute: () => null, querySelector: () => null, textContent: "  " }), null);
  const list = fakeList([{ href: "#/a" }, { href: "#/b" }, { label: "Go" }]);
  assert.equal(findRow(list.root, { href: "#/b" }), list.root.rows[1]);
  assert.equal(findRow(list.root, { label: "Go" }), list.root.rows[2]);
  assert.equal(findRow(list.root, { href: "#/gone" }), null);
});

test("when the list re-rendered under the page above, the pop lays a new copy over the new row", () => {
  const list = fakeList([{ href: "#/a" }, { href: "#/b" }]);
  const sel = keepRow(list.root.rows[1], win);
  const first = ghostFor(sel, list.root, win);
  assert.ok(first.ghost && first.isConnected);
  assert.equal(ghostFor(sel, list.root, win), first); // still there: the same copy
  first.isConnected = false; // Sources redrew its rows while hidden: the copy went with the old ones
  list.render();
  const again = ghostFor(sel, list.root, win);
  assert.notEqual(again, first);
  assert.ok(again.ghost && again.isConnected);
  assert.equal(again.li, list.root.rows.find((r) => r.href === "#/b" && !r.ghost).li);
  assert.equal(ghostFor(null, list.root, win), null);
  // the row is gone altogether: nothing to fade
  const sel2 = keepRow(list.root.rows[0], win);
  sel2.mark.el.isConnected = false;
  assert.equal(ghostFor(sel2, fakeList([{ href: "#/z" }]).root, win), null);
});
