// B54: the screenshots gallery loads without a jump (screens/altstore.js previewSlot): a 44px loading strip first,
// only pictures that loaded go in, the slot changes height once, and when none load it collapses to nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewSlot, galleryImage } from "./altstore.js";

// A small fake DOM: heights come from the class (strip 44, picture 360; a sideways .alt-shots is as tall as its
// tallest picture, anything else the sum of its children).
const HEIGHT = { "shots-loading": 44, "alt-shot": 360, "group-header": 30, "shot-dots": 15 };
function fakeElement(tag) {
  const cls = new Set();
  const e = {
    tagName: tag.toUpperCase(), children: [], parentNode: null, style: {}, attrs: {}, listeners: {}, hidden: false,
    get className() { return [...cls].join(" "); },
    set className(v) { cls.clear(); for (const c of String(v).split(" ").filter(Boolean)) cls.add(c); },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    get childElementCount() { return e.children.length; },
    get firstElementChild() { return e.children[0] ?? null; },
    get offsetHeight() {
      for (const c of cls) if (c in HEIGHT) return HEIGHT[c];
      const hs = e.children.map((c) => c.offsetHeight ?? 0);
      if (cls.has("alt-shots")) return Math.max(0, ...hs);
      return hs.reduce((a, b) => a + b, 0);
    },
    setAttribute(k, v) { e.attrs[k] = v; },
    addEventListener(k, f) { (e.listeners[k] ??= []).push(f); },
    removeEventListener() {},
    append(...ns) { for (const n of ns) { n.parentNode?.children && n.remove?.(); n.parentNode = e; e.children.push(n); } },
    insertBefore(n, ref) { n.parentNode = e; const at = ref ? e.children.indexOf(ref) : -1; if (at < 0) e.children.push(n); else e.children.splice(at, 0, n); },
    replaceChildren(...ns) { for (const c of e.children) c.parentNode = null; e.children = []; e.append(...ns); },
    remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((c) => c !== e); e.parentNode = null; },
    closest(sel) { let n = e; while (n) { if (n.classList?.contains(sel.slice(1))) return n; n = n.parentNode; } return null; },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.classList?.contains(sel.slice(1))) out.push(c); walk(c); } }; walk(e); return out; },
    querySelector(sel) { return e.querySelectorAll(sel)[0] ?? null; },
  };
  return e;
}

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: fakeElement };
  return Promise.resolve().then(fn).finally(() => { globalThis.document = saved; });
}

// Pictures whose loading the test settles by hand.
function fakePictures() {
  const made = [];
  const image = (s) => {
    const i = fakeElement("img");
    i.className = "alt-shot";
    i.url = s.url;
    i.ready = new Promise((r) => { i.settle = r; });
    made.push(i);
    return i;
  };
  return { made, image };
}

const shots = (n) => Array.from({ length: n }, (_, k) => ({ url: `https://x.dev/${k}.png` }));
const tick = () => new Promise((r) => setTimeout(r, 0));

test("previewSlot: starts as the 44px loading strip, no picture frames", () => withDom(async () => {
  const { image } = fakePictures();
  const slot = previewSlot("k", { shots: shots(2) }, { image });
  assert.equal(slot.classList.contains("shots-pending"), true);
  assert.equal(slot.children.length, 1);
  assert.equal(slot.children[0].className, "shots-loading");
  assert.equal(slot.offsetHeight, 44);
  assert.equal(slot.querySelectorAll(".alt-shot").length, 0);
}));

test("previewSlot: none loaded: the strip collapses to nothing", () => withDom(async () => {
  const { made, image } = fakePictures();
  const slot = previewSlot("k", { shots: shots(3) }, { image });
  await tick();
  for (const p of made) p.settle(false);
  const r = await slot.gallery;
  assert.deepEqual(r, { shown: 0, grows: 1 });
  assert.equal(slot.children.length, 0);
  assert.equal(slot.offsetHeight, 0);
  assert.equal(slot.classList.contains("shots-pending"), false);
}));

test("previewSlot: some failed: only the loaded ones go in, in order, and the slot grows once", () => withDom(async () => {
  const { made, image } = fakePictures();
  const slot = previewSlot("k", { shots: shots(4) }, { image, settleMs: 1000 });
  await tick();
  made[2].settle(true);
  made[0].settle(true);
  made[1].settle(false);
  made[3].settle(false);
  const r = await slot.gallery;
  assert.deepEqual(r, { shown: 2, grows: 1 });
  assert.deepEqual(slot.querySelectorAll(".alt-shot").map((p) => p.url), ["https://x.dev/0.png", "https://x.dev/2.png"]);
  assert.equal(slot.offsetHeight, 30 + 360 + 15);
}));

test("previewSlot: a picture that loads after the gallery shows joins the strip without another growth", () => withDom(async () => {
  const { made, image } = fakePictures();
  const slot = previewSlot("k", { shots: shots(3) }, { image, settleMs: 5 });
  await tick();
  made[1].settle(true);
  await new Promise((r) => setTimeout(r, 20)); // past settleMs: the gallery shows with the one it has
  assert.deepEqual(slot.querySelectorAll(".alt-shot").map((p) => p.url), ["https://x.dev/1.png"]);
  const h = slot.offsetHeight;
  made[0].settle(true);
  made[2].settle(false);
  const r = await slot.gallery;
  assert.deepEqual(slot.querySelectorAll(".alt-shot").map((p) => p.url), ["https://x.dev/0.png", "https://x.dev/1.png"]);
  assert.equal(slot.offsetHeight, h, "the page below doesn't move");
  assert.deepEqual(r, { shown: 2, grows: 1 });
}));

test("previewSlot: nothing to look in: an empty slot, no strip; a promise of sources shows the strip meanwhile", () => withDom(async () => {
  const empty = previewSlot("k", { shots: [] });
  assert.equal(empty.children.length, 0);
  let give;
  const { made, image } = fakePictures();
  const load = async (key, s) => s.shots;
  const later = previewSlot("k", new Promise((r) => { give = r; }), { image, load });
  assert.equal(later.children[0].className, "shots-loading");
  give({ shots: shots(1) });
  await tick(); await tick();
  made[0].settle(true);
  assert.deepEqual(await later.gallery, { shown: 1, grows: 1 });
}));

test("galleryImage: ready only once loaded and decoded; a failed decode or load is never ready", () => withDom(async () => {
  const http = { kind: "http", assetUrl: (u) => `/api/fetch?url=${encodeURIComponent(u)}` };
  const ok = galleryImage({ url: "https://x.dev/a.png" }, { backend: () => http });
  ok.naturalWidth = 1179; ok.naturalHeight = 2556; ok.decode = () => Promise.resolve();
  ok.onload();
  assert.equal(await ok.ready, true);
  const bad = galleryImage({ url: "https://x.dev/b.png" }, { backend: () => http });
  bad.naturalWidth = 1179; bad.naturalHeight = 2556; bad.decode = () => Promise.reject(new Error("EncodingError"));
  bad.onload();
  assert.equal(await bad.ready, false);
  const dead = galleryImage({ url: "https://x.dev/c.png" }, { backend: () => http });
  dead.onerror(); dead.onerror(); // straight, then through the proxy
  assert.equal(await dead.ready, false);
}));

// B107: the gallery is built before it is in the page, where every layout number is 0. The 'at the end' check
// (scrollLeft + clientWidth >= scrollWidth - 2) must not light the last dot then: the strip shows the first picture.
test("previewSlot: built detached (all widths 0), the first dot is the dark one", async () => {
  const saved = globalThis.document;
  const detached = (tag) => Object.assign(fakeElement(tag), { scrollLeft: 0, clientWidth: 0, scrollWidth: 0, offsetLeft: 0 });
  globalThis.document = { createElement: detached };
  try {
    const { made, image } = fakePictures();
    const slot = previewSlot("k", { shots: shots(3) }, { image: (s) => Object.assign(image(s), { offsetLeft: 0 }) });
    await tick();
    for (const p of made) p.settle(true);
    assert.deepEqual(await slot.gallery, { shown: 3, grows: 1 });
    const dots = slot.querySelector(".shot-dots");
    assert.equal(dots.children.length, 3);
    assert.deepEqual(dots.children.map((d) => d.classList.contains("on")), [true, false, false]);
  } finally {
    globalThis.document = saved;
  }
});
