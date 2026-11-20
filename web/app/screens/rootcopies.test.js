// C25: a root page that is on screen twice (its own tab, and pushed on Home: router.js rootOn) keeps its state per copy
// (nav/pageviews.js): both copies are mounted, a reload draws both, and one copy's search leaves the other alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, memStorage, fakeIndexedDB, tick } from "../fakes.test-helper.js";
import { pageViews } from "../nav/pageviews.js";

// ---- a DOM just big enough for the Sources list (nav/ui.js plain, nav/searchbar.js, nav/pullrefresh.js) ----------

// The shared fake DOM's elements, with a phone's layout numbers and plain-markup innerHTML.
const plainElement = fakeDocument().createElement;
function node(tag) {
  const n = Object.assign(plainElement(tag), {
    scrollTop: 0, clientHeight: 480, offsetHeight: 44, scrollTo() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 320, height: 44, bottom: 44, right: 320 }),
  });
  // Plain markup only (nav/pullrefresh.js's): tags with a class, text between them.
  Object.defineProperty(n, "innerHTML", { configurable: true, get: () => "", set(html) {
    n.replaceChildren();
    const stack = [n];
    for (const [, close, tagName, attrs, text] of String(html).matchAll(/<(\/)?([a-z]+)([^>]*)>|([^<]+)/gi)) {
      if (text) { stack.at(-1).append(text); continue; }
      if (close) { stack.pop(); continue; }
      const c = node(tagName);
      const cl = /class="([^"]*)"/.exec(attrs);
      if (cl) c.className = cl[1];
      stack.at(-1).append(c);
      stack.push(c);
    }
  } });
  return n;
}

function installDom() {
  const doc = fakeDocument();
  const root = node("html");
  root.connected = true;
  const body = node("body");
  root.append(body);
  globalThis.document = Object.assign(doc, {
    documentElement: root, body,
    createElement: (t) => node(t),
    createElementNS: (_, t) => node(t),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
  });
  globalThis.CSS ??= { escape: (s) => String(s).replace(/["\\]/g, "\\$&") };
  globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
  globalThis.Image ??= function Image() { return node("img"); };
  return body;
}

// A root page's body as app.js makePage builds one: a section in the document.
function page(docBody) {
  const section = node("section");
  const b = node("div");
  b.className = "page-body plain";
  section.append(b);
  docBody.append(section);
  return b;
}

// Waits (up to 3 s) for `ok()`: the fake IndexedDB answers a step per timer.
async function until(ok, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await tick();
}

const labelsIn = (b) => b.querySelectorAll(".source-row").map((li) => li.querySelector(".cell-label")?.textContent);

// ---- the views themselves -------------------------------------------------------------------------------------

test("pageViews: one view per body, a body drawn again keeps it, a dropped page's view goes", () => {
  const views = pageViews(() => ({ query: "" }));
  const root = node("div");
  root.connected = true;
  const a = node("div"), b = node("div");
  root.append(a, b);
  const va = views.open(a), vb = views.open(b);
  assert.notEqual(va, vb);
  va.query = "x";
  assert.equal(vb.query, "");
  assert.equal(views.open(a), va, "the same body: the same view");
  assert.deepEqual(views.all(), [va, vb]);
  b.remove(); // its page was popped
  assert.deepEqual(views.all(), [va]);
  assert.equal(views.of(b), null);
  const made = { query: "y" };
  assert.equal(views.adopt(a, made), made, "nav()'s view for a page drawn again");
  assert.equal(views.of(a), made);
  const loose = node("div"); // never attached (a test's stub): still live
  views.open(loose);
  assert.equal(views.all().length, 2);
});

// ---- Sources: mounted twice, both updated ---------------------------------------------------------------------

test("Sources' root mounted twice: a reload draws both copies; each keeps its own search", async () => {
  const docBody = installDom();
  globalThis.localStorage = memStorage({ "ifizbox.device": "rootless" });
  globalThis.indexedDB = fakeIndexedDB();
  globalThis.fetch = async () => { throw new Error("offline"); }; // first loads fail quietly; the rows stay
  delete globalThis.ifizboxNative; // the website's backend (backend-http.js) over the fake IndexedDB
  const sources = await import("./sources.js");
  const manage = await import("./manage.js");
  const ctx = { setBadge() {}, go() {} };
  const route = { tab: "sources", path: [] };

  const tab = page(docBody), home = page(docBody);
  sources.render(tab, route, ctx);
  sources.render(home, route, ctx);
  await until(() => labelsIn(tab).length > 1 && labelsIn(home).length > 1);
  const first = labelsIn(tab);
  assert.ok(first.length > 1, "the tab's copy lists the sources");
  assert.deepEqual(labelsIn(home), first, "and so does Home's");

  // One copy's search narrows only that copy (B172 kept one search box for both).
  const input = home.querySelector("input");
  assert.ok(input && tab.querySelector("input") !== input, "each copy has its own search box");
  const type = (field, text) => { field.value = text; field.dispatchEvent({ type: "input" }); };
  type(input, "zzzz no such source");
  assert.deepEqual(labelsIn(home), []);
  assert.ok(home.textContent.includes("No sources match."));
  assert.deepEqual(labelsIn(tab), first, "the tab's copy is not searched");

  // A source removed elsewhere (Manage, onSourcesChanged) reloads the list once: both copies follow it, and Home's
  // copy keeps its search.
  const { getBackend } = await import("../backend.js");
  const { displayName } = await import("../core/sources.js");
  const { isBuiltin } = await import("../core/essential.js");
  const gone = (await getBackend().sources()).find((s) => !isBuiltin(s) && first.includes(displayName(s)));
  assert.ok(gone, "a removable source to take out");
  await getBackend().removeSource(gone.key);
  manage.sourcesChanged(ctx);
  await until(() => labelsIn(tab).length === first.length - 1);
  assert.deepEqual(labelsIn(tab), first.filter((l) => l !== displayName(gone)), "the tab's copy lost the row");
  assert.deepEqual(labelsIn(home), [], "Home's copy still searching");
  assert.equal(input.value, "zzzz no such source");
  type(input, "");
  assert.deepEqual(labelsIn(home), labelsIn(tab), "cleared, Home's copy shows the same list");
});
