// F182: the Write a Review sheet and the Reviews tab with reviews written here (screens/reviews.js), over a small
// fake DOM: Send checks the draft and closes once sent, Cancel sends nothing, Tap to Rate keeps a written review's
// words, Report asks first and only shows on other people's reviews, More Reviews pages ours in before the
// depiction's, and a server without reviews leaves the depiction's and the App Store's as they were.
import { test } from "node:test";
import assert from "node:assert/strict";

function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, parentNode: null, _text: "",
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
      replaceWith(x) { const p = e.parentNode; const i = p.children.indexOf(e); x.remove?.(); x.parentNode = p; p.children[i] = x; e.parentNode = null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      removeEventListener(t, f) { e.listeners[t] = (e.listeners[t] ?? []).filter((g) => g !== f); },
      click() { return Promise.all((e.listeners.click ?? []).map((f) => f({ target: e }))); },
      focus() {},
    };
    return e;
  };
  const body = make("body");
  const doc = { createElement: make, body, listeners: {}, addEventListener(t, f) { (doc.listeners[t] ??= []).push(f); },
    removeEventListener(t, f) { doc.listeners[t] = (doc.listeners[t] ?? []).filter((g) => g !== f); } };
  return doc;
}
globalThis.document = fakeDom();
const { writeReviewSheet, reviewsTab, starPicker } = await import("./reviews.js");

const all = (n, out = []) => { for (const c of n.children ?? []) { out.push(c); all(c, out); } return out; };
const find = (n, cls) => all(n).filter((x) => x._cls?.has(cls));
const one = (n, cls) => find(n, cls)[0];
const byText = (n, text) => all(n).find((x) => x.tagName === "BUTTON" && x.textContent === text);
const tick = () => new Promise((r) => setTimeout(r, 0));

test("the star picker: tap sets it, aria says which", async () => {
  let picked = null;
  const p = starPicker(2, (n) => { picked = n; });
  assert.equal(p.buttons.filter((b) => b._cls.has("on")).length, 2);
  await p.buttons[3].click();
  assert.deepEqual([picked, p.value(), p.buttons[3].attrs["aria-checked"]], [4, 4, "true"]);
  assert.equal(p.buttons.filter((b) => b._cls.has("on")).length, 4);
});

test("Write a Review: Cancel / Send, the stars, Title, Name, Review; Send checks first and closes once sent", async () => {
  document.body.replaceChildren();
  const sent = [];
  let fail = null;
  const s = writeReviewSheet({ version: "2.1.3", onSend: async (d) => { if (fail) throw new Error(fail); sent.push(d); } });
  assert.equal(document.body.children.includes(s.sheet), true);
  assert.equal(one(s.sheet, "nav-title").textContent, "Write a Review");
  assert.ok(byText(s.sheet, "Cancel") && byText(s.sheet, "Send"));
  assert.match(one(s.sheet, "review-note").textContent, /Reviewing version 2\.1\.3\. One review per package per device/);
  assert.deepEqual([s.fields.title.input.maxLength, s.fields.name.input.maxLength, s.fields.text.input.maxLength], [80, 30, 2000]);
  assert.equal(s.fields.text.input.tagName, "TEXTAREA");

  await byText(s.sheet, "Send").click();
  assert.equal(sent.length, 0);
  assert.equal(s.error.hidden, false);
  assert.equal(s.error.textContent, "Tap a star to rate.");
  await s.stars.buttons[3].click();
  assert.equal(s.error.hidden, true, "tapping a star clears it");
  s.fields.text.input.value = "Feels like a new phone";
  await byText(s.sheet, "Send").click();
  assert.equal(s.error.textContent, "Give your review a title.");
  s.fields.title.input.value = "Great";
  s.fields.name.input.value = "Ann";
  fail = "Too many reviews from here. Try again in a minute.";
  await byText(s.sheet, "Send").click();
  assert.equal(s.error.textContent, fail, "the server's reason, and the sheet stays");
  assert.equal(s.closed(), false);
  fail = null;
  await byText(s.sheet, "Send").click();
  assert.deepEqual(sent, [{ stars: 4, title: "Great", name: "Ann", text: "Feels like a new phone", version: "2.1.3" }]);
  assert.equal(s.closed(), true);
  assert.equal(document.body.children.includes(s.sheet), false);

  const e = writeReviewSheet({ initial: { stars: 2, title: "Old", name: "Bo", text: "Was fine" }, onSend: async (d) => sent.push(d) });
  assert.deepEqual([e.stars.value(), e.fields.title.input.value, e.fields.name.input.value, e.fields.text.input.value], [2, "Old", "Bo", "Was fine"]);
  await byText(e.sheet, "Cancel").click();
  assert.equal(e.closed(), true);
  assert.equal(sent.length, 1, "Cancel sends nothing");
});

function fakeApi(pages, { enabled = true } = {}) {
  const log = [];
  return {
    log,
    async list(id, page = 0) { log.push(["list", id, page]); return enabled ? pages[page] : { enabled: false, count: 0, reviews: [], histogram: [0, 0, 0, 0, 0] }; },
    async post(id, d) { log.push(["post", id, d]); return { ok: true, review: { id: "me00000000000000", ...d } }; },
    async report(id, rid) { log.push(["report", id, rid]); return { ok: true, hidden: false }; },
  };
}
const now = Date.UTC(2026, 10, 18);
const rv = (id, title, extra = {}) => ({ id, stars: 4, title, name: "N", text: `${title} text`, version: "1.0", date: now - 86400000, updated: now - 86400000, ...extra });

test("the Reviews tab: ours and the depiction's in one list, Tap to Rate keeps your words, Report on others' only", async () => {
  const mine = rv("me00000000000000", "Mine", { text: "My words" });
  const api = fakeApi([{ enabled: true, average: 4.5, count: 2, histogram: [1, 1, 0, 0, 0], more: true,
    reviews: [rv("aa00000000000000", "Theirs <img src=x onerror=alert(1)>"), mine], mine: { ...mine, hidden: false } },
  { enabled: true, average: 4.5, count: 2, histogram: [1, 1, 0, 0, 0], more: false, reviews: [rv("bb00000000000000", "Older")], mine: null }]);
  const depiction = { average: 3, count: 1, noun: "Reviews", reviews: [{ title: "From the depiction", author: "dev", rating: 3, text: "**md**" }] };
  const pane = document.createElement("div");
  let confirmed = 0, sheets = [];
  const rated = [];
  await reviewsTab(pane, { id: "com.example.velvet", version: "2.0", depiction, api, now, renderText: (x) => Object.assign(document.createElement("div"), { _text: `md:${x.text}` }),
    confirm: async () => { confirmed++; return true; }, sheet: (o) => sheets.push(o), onRating: (r) => rated.push(r) });
  const titles = () => find(pane, "store-review-title").map((t) => t.textContent);
  assert.deepEqual(titles(), ["1. Theirs <img src=x onerror=alert(1)>", "2. Mine", "3. From the depiction"]);
  assert.ok(all(pane).every((x) => x.tagName !== "IMG"), "a review's text is text, never markup");
  assert.equal(find(pane, "store-review-text")[0].textContent, "Theirs <img src=x onerror=alert(1)> text");
  assert.equal(all(pane).some((x) => x.textContent === "md:**md**"), true, "the depiction's go through renderText");
  assert.equal(find(pane, "review-report").length, 1, "Report on someone else's review written here, not yours or the depiction's");
  assert.match(find(pane, "store-review-by")[0].textContent, /^by N – Version 1\.0 – Nov 1[67]$/);
  assert.equal(one(pane, "store-ratings-from").textContent, "2 from users here, 1 in the depiction.");
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  assert.equal(byText(pane, "Edit Your Review").textContent, "Edit Your Review");
  assert.equal(api.log.filter((l) => l[0] === "list").length, 1);

  // Report: asks, then sends, then says so
  await one(pane, "review-report").click();
  assert.equal(confirmed, 1);
  assert.deepEqual(api.log.at(-1), ["report", "com.example.velvet", "aa00000000000000"]);
  assert.equal(one(pane, "review-reported").textContent, "Reported. Thank you.");

  // More Reviews: page 1 goes after ours, before the depiction's
  await byText(pane, "More Reviews…").click();
  assert.deepEqual(titles(), ["1. Theirs <img src=x onerror=alert(1)>", "2. Mine", "3. Older", "4. From the depiction"]);
  assert.equal(byText(pane, "More Reviews…"), undefined, "no more pages");

  // Write a Review opens the sheet with your review in it
  await byText(pane, "Edit Your Review").click();
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].initial.text, "My words");
  assert.equal(sheets[0].version, "2.0");

  // Tap to Rate: only the stars change; the tab draws again and the header follows
  const picker = one(pane, "review-stars");
  await picker.children[1].click();
  await tick();
  const post = api.log.find((l) => l[0] === "post");
  assert.deepEqual(post[2], { stars: 2, title: "Mine", name: "N", text: "My words", version: "2.0" });
  assert.equal(api.log.filter((l) => l[0] === "list").length, 3, "listed again after the post");
  assert.equal(rated.length >= 1, true);
});

test("a server without reviews: no Tap to Rate or Write a Review, the others' ratings as before", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([], { enabled: false });
  await reviewsTab(pane, { id: "com.example.app", api, appStore: Promise.resolve({ average: 4.2, count: 1200, noun: "Ratings" }), now });
  assert.equal(one(pane, "review-tap"), undefined);
  assert.equal(byText(pane, "Write a Review"), undefined);
  assert.equal(one(pane, "store-ratings-big").textContent, "4.2");
  assert.equal(one(pane, "store-reviews-footer").textContent, "Ratings and reviews from the App Store.");

  const fresh = document.createElement("div");
  const api2 = fakeApi([{ enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], more: false, mine: null }]);
  const sheets = [];
  await reviewsTab(fresh, { id: "com.example.new", api: api2, now, sheet: (o) => sheets.push(o) });
  assert.equal(one(fresh, "store-ratings-none").textContent, "No Ratings");
  assert.equal(one(fresh, "review-tap-label").textContent, "Tap to Rate:");
  await byText(fresh, "Write a Review").click();
  assert.equal(sheets[0].initial, null);
});
