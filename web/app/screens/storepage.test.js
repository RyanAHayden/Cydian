// F181: the package page as the iOS 6 App Store's (screens/storepage.js), over a small fake DOM: the header with and
// without a rating, the Details / Reviews / Related tabs, the info tiles (Works On above all), the ratings card, and
// that Install / Modify stays the nav bar's right button (no install button in the header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// browse.js first, with no document (some screens style themselves at load when there is one).
const browseMod = await import("./browse.js");

function fakeDom() {
  const make = (tag, frag = false) => {
    const e = {
      tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
      parentNode: null, _text: "", _cls: new Set(), hidden: false,
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      get firstElementChild() { return e.children[0] ?? null; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) {
        for (const x of c) {
          if (typeof x === "string") { e.children.push({ textContent: x, children: [], _cls: new Set(), isText: true }); continue; }
          if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          x.parentNode?.children && (x.parentNode.children = x.parentNode.children.filter((y) => y !== x));
          x.parentNode = e;
          e.children.push(x);
        }
      },
      prepend(x) { e.append(x); e.children.unshift(e.children.pop()); },
      replaceChildren(...c) { e.children = []; e._text = ""; e.append(...c); },
      remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); e.parentNode = null; },
      insertAt(x, i) { x.remove?.(); x.parentNode = e; e.children.splice(i, 0, x); },
      before(x) { const p = e.parentNode; p.insertAt(x, p.children.indexOf(e)); },
      after(x) { const p = e.parentNode; p.insertAt(x, p.children.indexOf(e) + 1); },
      replaceWith(x) { const p = e.parentNode; const i = p.children.indexOf(e); e.remove(); p.insertAt(x, i); },
      querySelector(sel) { const c = sel.replace(/^\w*\./, ""); return all(e).slice(1).find((n) => n._cls?.has(c) || n.tagName === sel.toUpperCase()) ?? null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      click() { return Promise.all((e.listeners.click ?? []).map((f) => f({ currentTarget: e }))); },
    };
    return e;
  };
  globalThis.document = { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true) };
}
fakeDom();

const all = (n, out = []) => { out.push(n); (n.children ?? []).forEach((c) => all(c, out)); return out; };
const byClass = (n, c) => all(n).filter((x) => x._cls?.has(c));
const one = (n, c) => byClass(n, c)[0];

const sp = await import("./storepage.js");

test("F181: the header without a rating: name, author, Version · size · price, and no stars row", () => {
  const art = document.createElement("span");
  const h = sp.storeHeader({ art, name: "Velvet", author: "Sample Dev", authorHref: "#/sources/x/author%3ASample%20Dev",
    line: sp.headerLine({ version: "2.1.3", size: "412 kB", price: "Free" }) });
  assert.equal(one(h.head, "store-head-name").textContent, "Velvet");
  const author = one(h.head, "store-head-author");
  assert.equal(author.textContent, "Sample Dev");
  assert.equal(author.tagName, "A");
  assert.equal(one(h.head, "store-head-line").textContent, "Version 2.1.3 · 412 kB · Free");
  assert.equal(one(h.head, "store-head-rating").hidden, true, "no rating, no stars row");
  assert.equal(byClass(h.head, "store-stars").length, 0);
  assert.ok(one(h.head, "store-icon").children.includes(art), "the icon in the glossy frame");
  assert.ok(one(h.head, "store-icon-gloss"), "with its gloss");
  // A count alone is not a rating.
  h.setRating({ average: null, count: 12 });
  assert.equal(one(h.head, "store-head-rating").hidden, true);
});

test("F181: the header with a rating: stars filled to it and the count; a lookup without a count shows no (0)", () => {
  const h = sp.storeHeader({ name: "Delta", line: sp.headerLine({ version: "1.6" }) });
  assert.equal(one(h.head, "store-head-line").textContent, "Version 1.6", "missing size and price are left out");
  assert.equal(byClass(h.head, "store-head-author").length, 0, "no author, no line for one");
  h.setRating({ average: 4.3, count: 212, noun: "Ratings" });
  const row = one(h.head, "store-head-rating");
  assert.equal(row.hidden, false);
  assert.equal(one(row, "store-stars").attrs["aria-label"], "4.3 out of 5 stars");
  assert.equal(one(row, "store-stars-fill").style.width, "86%");
  assert.equal(one(row, "store-head-count").textContent, "(212)");
  h.setRating({ average: 5, count: null });
  assert.equal(byClass(h.head, "store-head-count").length, 0);
  h.setAuthor("Riley");
  assert.equal(one(h.head, "store-head-author").textContent, "Riley", "the App Store's developer, filled in later");
  assert.equal(one(h.head, "store-head-author").tagName, "SPAN");
});

test("F181: headerLine", () => {
  assert.equal(sp.headerLine({ version: "1.0", size: "4.7 MB", price: "Paid" }), "Version 1.0 · 4.7 MB · Paid");
  assert.equal(sp.headerLine({}), "");
});

test("F181: Details / Reviews / Related: Details shows first; the others fill once, when first chosen", async () => {
  const calls = { reviews: 0, related: 0 };
  const tabs = sp.storeTabs({
    reviews: (pane) => { calls.reviews++; pane.append(document.createElement("p")); },
    related: async (pane) => { calls.related++; pane.append(document.createElement("p")); },
  });
  assert.deepEqual(tabs.buttons.map((b) => b.textContent), ["Details", "Reviews", "Related"]);
  assert.equal(tabs.control.attrs.role, "tablist");
  assert.equal(tabs.nodes.length, 4, "the control and three panes");
  assert.equal(tabs.selected(), "details");
  assert.equal(tabs.panes.details.hidden, false);
  assert.equal(tabs.panes.reviews.hidden, true);
  assert.equal(tabs.panes.related.hidden, true);
  assert.ok(tabs.buttons[0].classList.contains("selected"));
  assert.equal(calls.reviews + calls.related, 0, "nothing loads for a tab not opened");
  await tabs.buttons[1].click();
  assert.equal(tabs.selected(), "reviews");
  assert.equal(tabs.panes.details.hidden, true);
  assert.equal(tabs.panes.reviews.hidden, false);
  assert.ok(tabs.buttons[1].classList.contains("selected") && !tabs.buttons[0].classList.contains("selected"));
  assert.equal(tabs.buttons[1].attrs["aria-selected"], "true");
  await tabs.buttons[2].click();
  await tabs.buttons[1].click();
  await tabs.buttons[2].click();
  assert.deepEqual(calls, { reviews: 1, related: 1 }, "each fills once");
  tabs.select(7);
  assert.equal(tabs.selected(), "related", "an unknown tab changes nothing");
});

test("F181: Works On: the stated range, and a check or cross for this iPhone", () => {
  assert.deepEqual(sp.worksOnTile({ status: "works", range: "iOS 15.0 or later", need: "rootless" }),
    { label: "Works On", value: "iOS 15+", sub: "Your iPhone ✓", ok: true });
  assert.deepEqual(sp.worksOnTile({ status: "no", reason: "ios", range: "iOS 14.0 – 16.2", need: "rootless" }),
    { label: "Works On", value: "iOS 14–16.2", sub: "Not Your iPhone ✗", ok: false });
  // No iOS range: the jailbreak it's built for, else any iOS; not judged, a question rather than a tick.
  assert.deepEqual(sp.worksOnTile({ status: "no", reason: "rootful", range: null, need: "rootful" }),
    { label: "Works On", value: "Rootful", sub: "Not Your iPhone ✗", ok: false });
  assert.deepEqual(sp.worksOnTile({ status: "unknown", range: null, need: "any" }),
    { label: "Works On", value: "Any iOS", sub: "Unknown", ok: null });
  assert.equal(sp.worksOnTile({ status: "unchecked", range: null, need: "any" }).sub, "Not Checked");
  assert.equal(sp.shortRange("iOS 15.0 to below 17.0"), "iOS 15–16");
  assert.equal(sp.shortRange("iOS 15.0 to below 16.4"), "iOS 15–<16.4");
  assert.equal(sp.shortRange("iOS below 14"), "iOS <14");
  assert.equal(sp.shortRange("iOS 16.5"), "iOS 16.5");
  assert.equal(sp.shortRange("some iOS versions"), null);
});

test("F181: the tile row keeps Rating, Works On, Size, Section, Updated in order, whenever each arrives", () => {
  const t = sp.tileRow();
  t.set("works", sp.worksOnTile({ status: "works", range: "iOS 15.0 or later" }));
  t.set("size", sp.sizeTile("412 kB"));
  t.set("updated", sp.updatedTile(new Date(2026, 10, 12, 9).toISOString(), new Date(2026, 10, 18, 12).getTime()));
  t.set("section", sp.sectionTile("Tweaks", "Rootless"));
  t.set("rating", sp.ratingTile({ average: 4.25, count: 3 })); // the depiction loads last
  const keys = t.row.children.map((c) => c.dataset.key);
  assert.deepEqual(keys, ["rating", "works", "size", "section", "updated"]);
  const label = (k) => t.row.children.find((c) => c.dataset.key === k);
  assert.equal(one(label("rating"), "store-tile-value").textContent, "4.3");
  assert.ok(one(label("rating"), "store-stars"));
  assert.equal(one(label("works"), "store-tile-sub").dataset.ok, "true");
  assert.equal(one(label("works"), "store-tile-sub").textContent, "Your iPhone ✓");
  assert.equal(one(label("size"), "store-tile-value").textContent, "412");
  assert.equal(one(label("size"), "store-tile-sub").textContent, "kB");
  assert.equal(one(label("updated"), "store-tile-value").textContent, "Nov 12");
  assert.equal(one(label("updated"), "store-tile-sub").textContent, "6 days ago");
  // Works On judged again (an IPA read): the tile is replaced in place; no rating takes the tile away.
  t.set("works", sp.worksOnTile({ status: "no", reason: "ios", range: "iOS 17.0 or later" }));
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["rating", "works", "size", "section", "updated"]);
  assert.equal(one(label("works"), "store-tile-sub").dataset.ok, "false");
  t.set("rating", sp.ratingTile(null));
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["works", "size", "section", "updated"]);
  assert.equal(sp.sizeTile(null), null);
  assert.equal(sp.updatedTile(null), null);
  assert.equal(sp.sectionTile(null), null);
});

test("F181: the ratings card: the average, the count, and the 5-to-1 bars only when per-star counts exist", () => {
  const plain = sp.ratingsCard({ average: 4.5, count: 1200, noun: "Ratings", from: "App Store" });
  assert.equal(one(plain, "store-ratings-big").textContent, "4.5");
  assert.equal(one(plain, "store-ratings-count").textContent, "1,200 Ratings");
  assert.equal(byClass(plain, "store-bars").length, 0, "Apple's lookup gives no per-star counts");
  const bars = sp.ratingsCard({ average: 4.3, count: 212, histogram: [131, 42, 17, 9, 13] });
  const rows = byClass(bars, "store-bar");
  assert.equal(rows.length, 5);
  assert.equal(one(rows[0], "store-bar-stars").textContent, "★★★★★");
  assert.equal(one(rows[0], "store-bar-fill").style.transform, "scaleX(1)", "scaled, not resized (120 Hz)");
  assert.equal(one(rows[4], "store-bar-n").textContent, "13");
  assert.equal(one(sp.ratingsCard(null), "store-ratings-none").textContent, "No Ratings");
  assert.equal(one(sp.ratingsCard({ average: 3, count: 1, noun: "Reviews" }), "store-ratings-count").textContent, "1 Review");
});

test("F181: review cells: numbered title, stars, by-line, text, a developer response", () => {
  const g = sp.reviewsGroup([
    { title: "Feels like a new phone", author: "mobileuser", rating: 5, text: "Perfect." },
    { title: "Breaks the camera swipe", author: "jbfan", rating: 2, version: "2.1.2", date: "Nov 9", text: "Lags.", response: "Fixed in 2.1.3" },
  ]);
  const cells = byClass(g, "store-review");
  assert.equal(cells.length, 2);
  assert.equal(one(cells[0], "store-review-title").textContent, "1. Feels like a new phone");
  assert.equal(one(cells[0], "store-review-by").textContent, "by mobileuser");
  assert.equal(one(cells[1], "store-review-by").textContent, "by jbfan – Version 2.1.2 – Nov 9");
  assert.equal(one(cells[1], "store-stars-fill").style.width, "40%");
  assert.match(one(cells[1], "store-review-response").textContent, /Developer Response – Fixed in 2\.1\.3/);
});

// ---- Install stays in the nav bar ------------------------------------------------------------------------------

test("F181: Install / Modify stays the nav bar's right button; the header has no install button", async () => {
  const h = sp.storeHeader({ name: "Velvet", author: "Sample Dev", line: "Version 1 · Free" });
  h.setRating({ average: 4, count: 3 });
  assert.equal(all(h.head).filter((n) => n.tagName === "BUTTON").length, 0, "nothing to press in the header");
  assert.doesNotMatch(h.head.textContent, /Install|Modify|Get|Buy/);
  const { nav, token } = browseMod;
  const right = nav({ tab: "search", path: [token("package", "com.example.velvet")] }).right;
  assert.equal(right.label, "Install");
  assert.equal(typeof right.onClick, "function");
  // Neither page builds an install button into its header: renderPackage and renderApp hand the header no button.
  for (const file of ["./browse.js", "./altstore.js", "./storepage.js"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const call of src.match(/storeHeader\(\{[^)]*\}\)/gs) ?? []) assert.doesNotMatch(call, /Install|bar-button|button/i, file);
  }
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const page = browse.slice(browse.indexOf("async function renderPackage("), browse.indexOf("// ---- Install / Modify and Version History"));
  assert.match(page, /storeHeader\(/);
  assert.match(page, /rememberPackage\(body, route/, "the nav bar button still follows what is installed");
  assert.match(page, /storeTabs\(/);
  const alt = readFileSync(new URL("./altstore.js", import.meta.url), "utf8");
  const app = alt.slice(alt.indexOf("export function renderApp("), alt.indexOf("export function storeLookup("));
  assert.match(app, /storeHeader\(/);
  assert.match(app, /storeTabs\(/);
});

test("F181: the CSS is there: the segmented control in ios6.css, the page in packages.css, both themes", () => {
  const ios6 = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const pkgs = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(ios6, /\.store-segment\.selected \{[^}]*background-origin: border-box/s, "a gradient in a border needs border-box");
  assert.match(ios6, /html\[data-theme="dark"\] \.store-segment/);
  for (const cls of [".store-head {", ".store-icon {", "-webkit-box-reflect", ".store-icon-gloss", ".store-tiles {", ".store-tile {",
    ".shot-dots", ".shot-zoom", ".store-bar-fill", ".store-review {", 'html[data-theme="dark"] .store-head']) assert.ok(pkgs.includes(cls), cls);
  // 120 Hz: no transition or animation of anything but transform/opacity in the new rules.
  const part = pkgs.slice(pkgs.indexOf("F181: the package page"));
  assert.doesNotMatch(part, /transition\s*:\s*(?!transform|opacity)[a-z]/);
});
