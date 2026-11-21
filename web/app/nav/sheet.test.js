// nav/sheet.js showSheet, the one modal sheet scaffold (Confirm, Write a Review, the progress page, the Install
// sheet and the plain Done sheets are built on it), over a small fake DOM: the bar's [left, title, right] row, Done by
// default and the caller's buttons in its place, the classes, setTitle, Escape, the slide up and down, and close()'s
// one promise that settles once the sheet is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { showSheet } from "./sheet.js";

function fakeDom({ animate = true } = {}) {
  const anims = [];
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, parentNode: null, _text: "", type: "",
      _cls: new Set(), focused: false,
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      append(...c) { for (const x of c) { x.remove?.(); x.parentNode = e; e.children.push(x); } },
      remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); e.parentNode = null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      click() { for (const f of e.listeners.click ?? []) f({}); },
      focus() { e.focused = true; },
    };
    if (animate) {
      e.animate = (frames, opts) => {
        let done;
        const a = { frames, opts, finished: new Promise((r) => { done = r; }), end: () => done(a) };
        anims.push(a);
        return a;
      };
    }
    return e;
  };
  const doc = { createElement: make, body: make("body"), listeners: {}, anims,
    addEventListener(t, f) { (doc.listeners[t] ??= []).push(f); },
    removeEventListener(t, f) { doc.listeners[t] = (doc.listeners[t] ?? []).filter((g) => g !== f); },
    key(k) { for (const f of doc.listeners.keydown ?? []) f({ key: k }); } };
  return doc;
}

async function withDom(opts, fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom(opts);
  try { await fn(globalThis.document); } finally { globalThis.document = saved; }
}

const cls = (n) => n.className.split(" ");
const button = (text) => Object.assign(globalThis.document.createElement("button"), { textContent: text });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("showSheet: a dialog with the bar row [left, title, right], Done focused on the right, the body in .sheet-body; it slides up", () => withDom({}, (doc) => {
  const body = doc.createElement("div");
  const close = showSheet({ title: "Depiction", body });
  const sheet = doc.body.children[0];
  assert.equal(close.sheet, sheet);
  assert.deepEqual(cls(sheet), ["sheet"]);
  assert.deepEqual([sheet.attrs.role, sheet.attrs["aria-modal"], sheet.attrs["aria-label"]], ["dialog", "true", "Depiction"]);
  const [bar, content] = sheet.children;
  assert.deepEqual(cls(bar), ["navbar", "sheet-bar"]);
  const row = bar.children[0];
  assert.deepEqual(cls(row), ["sheet-bar-row"]);
  assert.deepEqual(row.children.map((c) => c.className), ["sheet-left", "nav-title", "sheet-right"]);
  assert.equal(row.children[0].children.length, 0);
  const done = row.children[2].children[0];
  assert.deepEqual([done.textContent, done.className, done.type, done.focused], ["Done", "bar-button done", "button", true]);
  assert.equal(close.content, content);
  assert.deepEqual(cls(content), ["sheet-body"]);
  assert.equal(content.children[0], body);
  assert.equal(doc.anims.length, 1);
  assert.deepEqual(doc.anims[0].frames, [{ transform: "translateY(100%)" }, { transform: "none" }]);
  assert.deepEqual([doc.anims[0].opts.duration, doc.anims[0].opts.easing], [350, "cubic-bezier(.25,.1,.25,1)"]);
}));

test("showSheet: left, right (in place of Done), cls, bodyCls and an array body; right: null leaves the right side empty", () => withDom({}, (doc) => {
  const cancel = button("Cancel");
  const send = button("Send");
  const a = doc.createElement("div");
  const b = doc.createElement("div");
  const s = showSheet({ title: "Write a Review", body: [a, b], left: cancel, right: send, cls: "review-sheet", bodyCls: "review-sheet-body" });
  assert.deepEqual(cls(s.sheet), ["sheet", "review-sheet"]);
  assert.deepEqual(s.left.children, [cancel]);
  assert.deepEqual(s.right.children, [send]);
  assert.deepEqual(cls(s.content), ["sheet-body", "review-sheet-body"]);
  assert.deepEqual(s.content.children, [a, b]);
  const empty = showSheet({ title: "Running", right: null });
  assert.equal(empty.right.children.length, 0);
  assert.equal(empty.content.children.length, 0);
}));

test("showSheet: setTitle changes the title and the dialog's label", () => withDom({}, () => {
  const s = showSheet({ title: "Confirm" });
  s.setTitle("Cannot Comply");
  assert.equal(s.h1.textContent, "Cannot Comply");
  assert.equal(s.sheet.attrs["aria-label"], "Cannot Comply");
}));

test("showSheet: close slides down, then removes the sheet and runs onClose; one promise for every call", () => withDom({}, async (doc) => {
  let closed = 0;
  const close = showSheet({ title: "QR Code", onClose: () => { closed++; } });
  assert.equal(close.closed(), false);
  const p = close();
  assert.equal(close(), p);
  assert.equal(close.closed(), true);
  const down = doc.anims[1];
  assert.deepEqual(down.frames, [{ transform: "none" }, { transform: "translateY(100%)" }]);
  assert.deepEqual([down.opts.duration, down.opts.fill], [300, "forwards"]);
  await tick();
  assert.equal(doc.body.children.length, 1, "still up while it slides");
  assert.equal(closed, 0);
  down.end();
  await p;
  assert.deepEqual([doc.body.children.length, closed], [0, 1]);
  assert.equal(doc.anims.length, 2, "no second slide");
}));

test("showSheet: Done and Escape close it; escape: false leaves Escape alone", () => withDom({ animate: false }, async (doc) => {
  let n = 0;
  const a = showSheet({ title: "A", onClose: () => { n++; } });
  a.right.children[0].click();
  await a();
  assert.equal(n, 1);
  const b = showSheet({ title: "B", onClose: () => { n++; } });
  doc.key("Escape");
  await b();
  assert.equal(n, 2);
  assert.equal((doc.listeners.keydown ?? []).length, 0, "the key listener goes with the sheet");
  const c = showSheet({ title: "C", right: button("Confirm"), escape: false });
  doc.key("Escape");
  assert.equal(c.closed(), false);
  assert.equal(doc.body.children.length, 1);
}));

test("showSheet: without Web Animations (an old WebView, a fake DOM) it opens and closes at once", () => withDom({ animate: false }, async (doc) => {
  let gone = false;
  const close = showSheet({ title: "X", onClose: () => { gone = true; } });
  assert.equal(doc.body.children.length, 1);
  await close();
  assert.deepEqual([doc.body.children.length, gone], [0, true]);
}));

// The card hook (docs/eras.md): <html data-sheet="card"> scales the page behind back; off, nothing behind moves.
async function withCardDom({ card, vars = {} }, fn) {
  const saved = { document: globalThis.document, gcs: globalThis.getComputedStyle, w: globalThis.innerWidth, h: globalThis.innerHeight };
  const doc = fakeDom();
  doc.documentElement = { getAttribute: (k) => (k === "data-sheet" && card ? "card" : null) };
  const rects = { navbar: [0, 0, 390, 91], screens: [0, 0, 390, 844], tabbar: [0, 761, 390, 83] };
  const page = {};
  for (const [id, [left, top, width, height]] of Object.entries(rects)) {
    page[id] = doc.createElement("div");
    page[id].getBoundingClientRect = () => ({ left, top, width, height });
  }
  doc.getElementById = (id) => page[id] ?? null;
  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => vars[k] ?? "" });
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  try { await fn(doc, page); } finally {
    globalThis.document = saved.document; globalThis.getComputedStyle = saved.gcs;
    globalThis.innerWidth = saved.w; globalThis.innerHeight = saved.h;
  }
}
const pageAnims = (doc) => doc.anims.filter((a) => a.frames.some((f) => "opacity" in f));

test("showSheet card hook off (iOS 6): only the sheet animates, nothing behind it", () => withCardDom({ card: false }, async (doc) => {
  const close = showSheet({ title: "Off" });
  assert.equal(doc.anims.length, 1);
  assert.equal(pageAnims(doc).length, 0);
  const p = close();
  doc.anims[1].end();
  await p;
  assert.equal(doc.anims.length, 2);
}));

test("showSheet card hook: the nav bar, screens and tab bar scale back about the screen's centre and dim, then come back", () => withCardDom({ card: true, vars: { "--sheet-behind-scale": " 0.9", "--sheet-behind-shift": "4", "--sheet-behind-opacity": "0.5" } }, async (doc, page) => {
  const close = showSheet({ title: "Card" });
  const back = pageAnims(doc);
  assert.equal(back.length, 3);
  // the tab bar's centre (195, 802.5) moves toward the screen's (195, 422) by 10%, plus the 4px shift
  const tab = back[2];
  assert.deepEqual(tab.frames, [{ transform: "none", opacity: 1 }, { transform: "translate(0px, -34.05px) scale(0.9)", opacity: 0.5 }]);
  assert.deepEqual([tab.opts.duration, tab.opts.fill], [350, "forwards"]);
  assert.equal(back[1].frames[1].transform, "translate(0px, 4px) scale(0.9)", "the full-screen page only scales (and shifts)");
  for (const a of doc.anims) for (const f of a.frames) assert.deepEqual(Object.keys(f).filter((k) => k !== "transform" && k !== "opacity"), [], "transform and opacity only");

  // a second card sheet over it leaves the page where it is; closing it does too
  const second = showSheet({ title: "Over" });
  assert.equal(pageAnims(doc).length, 3);
  const p2 = second();
  doc.anims.at(-1).end();
  await p2;
  assert.equal(pageAnims(doc).length, 3);

  let cancelled = 0;
  for (const a of back) a.cancel = () => { cancelled++; };
  const p = close();
  const forward = pageAnims(doc).slice(3);
  assert.equal(forward.length, 3);
  assert.deepEqual(forward[2].frames, [tab.frames[1], { transform: "none", opacity: 1 }]);
  assert.deepEqual([forward[2].opts.duration, forward[2].opts.fill], [300, "forwards"]);
  for (const a of forward) a.cancel = () => { cancelled++; };
  for (const a of doc.anims) a.end();
  await p;
  await tick();
  assert.equal(cancelled, 6, "the page's animations are dropped, leaving it as it was");
}));

test("showSheet card hook: defaults when the page sets no numbers", () => withCardDom({ card: true }, async (doc) => {
  const close = showSheet({ title: "Card" });
  assert.equal(pageAnims(doc)[1].frames[1].transform, "translate(0px, 0px) scale(0.92)");
  assert.equal(pageAnims(doc)[1].frames[1].opacity, 0.75);
  const p = close();
  for (const a of doc.anims) a.end();
  await p;
}));
