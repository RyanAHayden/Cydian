// F216: Your Rating on the Reviews tab (screens/reviews.js reviewsTab), over a small fake DOM and node:test's fake
// timers: quick taps make one post with the last value, the same star again (or Remove) clears it and deletes it on
// the server, a written review asks first (and Cancel puts the stars back), ending where it started sends nothing,
// a finger still down holds the send, leaving the page sends at once, and a failed send falls back to the server's.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";

function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, dataset: {}, parentNode: null, _text: "",
      _cls: new Set(), hidden: false, disabled: false, value: "", type: "", placeholder: "", maxLength: -1,
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) {
        for (const x of c) {
          if (typeof x === "string") { e.children.push({ textContent: x, children: [], _cls: new Set(), isText: true }); continue; }
          x.remove?.();
          x.parentNode = e;
          e.children.push(x);
        }
      },
      replaceChildren(...c) { for (const k of e.children) k.parentNode = null; e.children = []; e._text = ""; e.append(...c); },
      remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); e.parentNode = null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      removeEventListener(t, f) { e.listeners[t] = (e.listeners[t] ?? []).filter((g) => g !== f); },
      fire(t) { return Promise.all((e.listeners[t] ?? []).map((f) => f({ target: e, type: t }))); },
      click() { return e.fire("click"); },
    };
    return e;
  };
  return { createElement: make, body: make("body") };
}
const target = () => {
  const t = { listeners: {}, addEventListener(k, f) { (t.listeners[k] ??= []).push(f); },
    removeEventListener(k, f) { t.listeners[k] = (t.listeners[k] ?? []).filter((g) => g !== f); },
    fire(k) { for (const f of [...(t.listeners[k] ?? [])]) f({ type: k }); } };
  return t;
};
globalThis.document = fakeDom();
const { reviewsTab } = await import("./reviews.js");

const all = (n, out = []) => { for (const c of n.children ?? []) { out.push(c); all(c, out); } return out; };
const one = (n, cls) => all(n).find((x) => x._cls?.has(cls));
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const now = Date.UTC(2026, 10, 18);

// A server holding at most this device's review; post and remove change what the next list returns.
function server(mine) {
  const log = [];
  let me = mine ? { id: "me00000000000000", name: "N", version: "1.0", date: now, updated: now, title: "", text: "", ...mine } : null;
  const page = () => ({ enabled: true, average: me?.stars ?? 0, count: me ? 1 : 0, histogram: [0, 0, 0, 0, 0].map((_, i) => (me && me.stars === 5 - i ? 1 : 0)),
    more: false, reviews: me ? [me] : [], mine: me });
  return {
    log, fail: null,
    async list(id, p) { log.push(["list", p]); return page(); },
    async post(id, d) { log.push(["post", d.stars, d.title]); if (this.fail) throw new Error(this.fail); me = { ...(me ?? { id: "me00000000000000", date: now }), ...d, updated: now }; return { ok: true, review: me }; },
    async remove(id, rid) { log.push(["remove", rid]); me = null; return { ok: true }; },
    async report() { return { ok: true }; },
  };
}
const sends = (api) => api.log.filter((l) => l[0] !== "list");
const stars = (pane) => all(one(pane, "review-tap")).filter((x) => x._cls?.has("review-star"));
const lit = (pane) => stars(pane).filter((b) => b._cls.has("on")).length;

async function open(mine, opts = {}) {
  const api = server(mine);
  const pane = document.createElement("div");
  const win = target(), doc = target();
  await reviewsTab(pane, { id: "com.example.velvet", api, now, win, doc, ...opts });
  return { api, pane, win, doc };
}

test("five quick taps: the stars follow at once, one post 1.5 s after the last, with the last value", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { api, pane } = await open(null);
  assert.equal(one(pane, "review-tap-label").textContent, "Tap to Rate:");
  assert.equal(one(pane, "review-tap-remove").hidden, true, "no Remove without a rating");
  for (const n of [3, 5, 2, 4, 1]) { await stars(pane)[n - 1].click(); t.mock.timers.tick(400); }
  assert.equal(lit(pane), 1);
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  assert.equal(one(pane, "review-tap-remove").hidden, false);
  assert.equal(one(pane, "review-tap-status").textContent, "", "not Sending… before the send");
  assert.deepEqual(sends(api), []);
  t.mock.timers.tick(1099);
  assert.deepEqual(sends(api), [], "the timer restarts on each tap");
  t.mock.timers.tick(1);
  assert.equal(one(pane, "review-tap-status").textContent, "Sending…");
  await settle();
  assert.deepEqual(sends(api), [["post", 1, ""]]);
  assert.equal(lit(pane), 1, "drawn again from the server");
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(sends(api).length, 1);
});

test("back to where it started sends nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { api, pane } = await open({ stars: 3 });
  await stars(pane)[4].click();
  await stars(pane)[2].click();
  t.mock.timers.tick(2000);
  await settle();
  assert.deepEqual(sends(api), []);
  assert.equal(lit(pane), 3);
});

test("the same star again clears a stars-only rating, and it is deleted on the server; Remove does the same", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let asked = 0;
  const { api, pane } = await open({ stars: 4 }, { confirmDelete: async () => { asked++; return true; } });
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  await stars(pane)[3].click();
  assert.equal(lit(pane), 0);
  assert.equal(one(pane, "review-tap-label").textContent, "Tap to Rate:");
  assert.equal(one(pane, "review-tap-remove").hidden, true);
  t.mock.timers.tick(1500);
  await settle();
  assert.deepEqual(sends(api), [["remove", "me00000000000000"]]);
  assert.equal(asked, 0, "no words, no question");
  assert.equal(one(pane, "review-tap-label").textContent, "Tap to Rate:");

  const b = await open({ stars: 2 });
  await one(b.pane, "review-tap-remove").click();
  assert.equal(lit(b.pane), 0);
  t.mock.timers.tick(1500);
  await settle();
  assert.deepEqual(sends(b.api), [["remove", "me00000000000000"]]);
});

test("with a written review, clearing asks first; Cancel puts the stars back, Delete removes it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let answer = false, asked = 0;
  const { api, pane } = await open({ stars: 5, title: "Great", text: "Words" }, { confirmDelete: async () => { asked++; return answer; } });
  await stars(pane)[4].click();
  await settle();
  assert.equal(asked, 1);
  assert.equal(lit(pane), 5, "Cancel: the stars come back");
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  t.mock.timers.tick(3000);
  await settle();
  assert.deepEqual(sends(api), []);

  // a change first, then a cancelled clear: back to the change, which is still sent
  await stars(pane)[2].click();
  await stars(pane)[2].click();
  await settle();
  assert.equal(lit(pane), 3);
  t.mock.timers.tick(1500);
  await settle();
  assert.deepEqual(sends(api), [["post", 3, "Great"]], "the words stay, only the stars change");

  answer = true;
  await stars(pane)[2].click();
  await settle();
  assert.equal(asked, 3);
  t.mock.timers.tick(1500);
  await settle();
  assert.deepEqual(sends(api).at(-1), ["remove", "me00000000000000"]);
});

test("a finger still on the stars holds the send until it lifts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { api, pane } = await open(null);
  const node = one(pane, "review-stars");
  await node.fire("pointerdown");
  await stars(pane)[1].click();
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(sends(api), []);
  await node.fire("pointerup");
  t.mock.timers.tick(1499);
  assert.deepEqual(sends(api), []);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(sends(api), [["post", 2, ""]]);
});

test("leaving the page sends a waiting change at once; a hidden page too; nothing waiting, nothing sent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { api, pane, win, doc } = await open({ stars: 1 });
  win.fire("pagehide");
  await settle();
  assert.deepEqual(sends(api), [], "nothing waiting");
  await stars(pane)[3].click();
  win.fire("pagehide");
  await settle();
  assert.deepEqual(sends(api), [["post", 4, ""]]);
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(sends(api).length, 1, "the timer was cancelled");
  assert.equal((win.listeners.pagehide ?? []).length, 0, "no listener left behind");

  await stars(pane)[1].click();
  doc.visibilityState = "visible";
  doc.fire("visibilitychange");
  await settle();
  assert.equal(sends(api).length, 1);
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  await settle();
  assert.deepEqual(sends(api).at(-1), ["post", 2, ""]);
});

test("Write a Review sends a waiting change first", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sheets = [];
  const { api, pane } = await open(null, { sheet: (o) => sheets.push(o) });
  await stars(pane)[4].click();
  await all(pane).find((x) => x.tagName === "BUTTON" && x.textContent === "Write a Review").click();
  assert.deepEqual(sends(api), [["post", 5, ""]]);
  assert.equal(sheets.at(-1).initial.stars, 5);
});

test("a failed send says why and falls back to the server's value", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { api, pane } = await open({ stars: 2 });
  api.fail = "Too many changes from here.";
  await stars(pane)[4].click();
  t.mock.timers.tick(1500);
  await settle();
  assert.equal(one(pane, "review-tap-status").textContent, "Too many changes from here.");
  assert.equal(lit(pane), 2);
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
});
