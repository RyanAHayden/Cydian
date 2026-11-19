// B67: the finished progress page (nav/progress.js) shows no status line over its bottom button (it only repeated
// the log's last line), and the plain finish button reads "Return to <NAME>" (Cydia's "Return to Cydia"), not Close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openProgress, progressHUD, RETURN_LABEL } from "./nav/progress.js";
import { FINISH_LABEL } from "./core/queue.js";
import { chooseFinish } from "./core/progress.js";
import { NAME } from "./brand.js";

// ---- a fake DOM, enough for nav/progress.js ----------------------------------------------------------------------
function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, parentNode: null,
      textContent: "", hidden: false, disabled: false, type: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => (on ?? !e._cls.has(c) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      append(...c) {
        for (const x of c) {
          if (x?.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          if (typeof x !== "object") continue;
          x.parentNode = e;
          e.children.push(x);
        }
      },
      remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      get childElementCount() { return e.children.length; },
      get firstElementChild() { return e.children[0] ?? null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      animate: () => ({ finished: Promise.resolve() }),
      click() { if (e.onclick) e.onclick(); for (const f of e.listeners.click ?? []) f({}); },
    };
    return e;
  };
  const body = make("body");
  return { body, createElement: make, createDocumentFragment: () => Object.assign(make("#fragment"), { isFragment: true }) };
}

function withDom(fn) {
  return async () => {
    const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.document = fakeDom();
    globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    try { await fn(globalThis.document); } finally {
      globalThis.document = saved.document;
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
    }
  };
}

const find = (n, cls) => {
  if (n._cls?.has(cls)) return n;
  for (const k of n.children) { const f = find(k, cls); if (f) return f; }
  return null;
};
const status = (page) => find(page.sheet, "progress-status");
const button = (page) => find(page.sheet, "progress-finish");

test("finish labels: the plain one is Return to <NAME>; the others stay", () => {
  assert.equal(FINISH_LABEL.return, `Return to ${NAME}`);
  assert.equal(RETURN_LABEL, FINISH_LABEL.return);
  assert.equal(FINISH_LABEL.reopen, `Close ${NAME}`);
  assert.equal(FINISH_LABEL.restart, "Restart SpringBoard");
  assert.equal(FINISH_LABEL.uicache, "Reload Data");
  assert.equal(chooseFinish({}).label, `Return to ${NAME}`);
  assert.equal(chooseFinish({ build: "sideload" }).label, `Return to ${NAME}`);
});

test("openProgress: the status line shows while it runs, is gone once finished, and back for the next job", withDom(async () => {
  const page = openProgress();
  page.status("Installing 40%");
  assert.equal(status(page).hidden, false);
  assert.equal(button(page).hidden, true);
  page.finish({ status: "Done" });
  assert.equal(status(page).hidden, true, "no status line above the finish button");
  assert.equal(button(page).hidden, false);
  assert.equal(button(page).textContent, `Return to ${NAME}`, "finish()'s default label");
  page.reopen();
  assert.equal(status(page).hidden, false, "the next job of a run shows its status again");
  page.finish({ label: "Restart SpringBoard", status: "Done" });
  assert.equal(status(page).hidden, true);
  assert.equal(button(page).textContent, "Restart SpringBoard");
  await page.close();
}));

test("progressHUD: done ends on Return to <NAME>, with no status line", withDom(async () => {
  const h = progressHUD("Downloading 10%");
  assert.equal(status(h.page).hidden, false);
  h.done("Done");
  assert.equal(button(h.page).textContent, `Return to ${NAME}`);
  assert.equal(status(h.page).hidden, true);
  await h.page.close();
}));

// B90: an install cancelled in iOS's prompt ends "Not Installed" with Try Again (finish's `also`) above Return
test("finish({ also }): a second button above the finish one, gone again for the next job", withDom(async () => {
  const also = (page) => find(page.sheet, "progress-also");
  const h = progressHUD("Uploading 33%");
  assert.equal(also(h.page).hidden, true);
  let tries = 0;
  h.finish({ title: "Not Installed", status: "Cancelled in iOS.", also: { label: "Try Again", action: () => { tries++; return true; } } });
  const page = h.page;
  assert.equal(also(page).hidden, false);
  assert.equal(also(page).textContent, "Try Again");
  assert.equal(button(page).textContent, `Return to ${NAME}`);
  assert.ok(Number(also(page).style.order) < Number(button(page).style.order), "drawn above Return");
  assert.equal(page.sheet.attrs["aria-label"], "Not Installed");
  await also(page).onclick();
  assert.equal(tries, 1);
  assert.equal(page.closed, false, "a truthy return keeps the page (the next run opens on it)");
  progressHUD("Downloading");
  assert.equal(also(page).hidden, true, "reopened: no Try Again");
  page.finish({ status: "Done" });
  assert.equal(also(page).hidden, true, "a plain finish has none");
  await button(page).onclick();
  assert.equal(page.closed, true);
}));
