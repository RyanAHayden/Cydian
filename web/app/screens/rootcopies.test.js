// C25: a root page that is on screen twice (its own tab, and pushed on Home: router.js rootOn) keeps its state per copy
// (nav/pageviews.js): both copies are mounted, a reload draws both, and one copy's search leaves the other alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage, fakeIndexedDB, tick } from "../fakes.test-helper.js";
import { pageViews } from "../nav/pageviews.js";

// ---- a DOM just big enough for the Sources list (nav/ui.js plain, nav/searchbar.js, nav/pullrefresh.js) ----------

function matches(n, sel) {
  if (!n?.classList) return false;
  const m = /^([a-z]+)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(sel.trim());
  if (!m) return false;
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const c of m[2].split(".").filter(Boolean)) if (!n.classList.contains(c)) return false;
  for (const [, k, v] of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const got = k.startsWith("data-") ? n.dataset[k.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] : n.getAttribute(k);
    if (got == null || (v !== undefined && String(got) !== v)) return false;
  }
  return true;
}
// One selector (a comma list of descendant chains, `:scope >` for children) under `root`.
function select(root, sel) {
  const out = [];
  for (const part of sel.split(",")) {
    const chain = part.trim().split(/\s+/);
    let set = [root];
    for (let i = 0; i < chain.length; i++) {
      if (chain[i] === ":scope") continue;
      const child = chain[i] === ">";
      if (child) i++;
      const next = [];
      for (const r of set) {
        const walk = (x, deep) => { for (const c of x.children) { if (matches(c, chain[i])) next.push(c); if (deep) walk(c, true); } };
        walk(r, !child);
      }
      set = [...new Set(next)];
    }
    out.push(...set.filter((x) => x !== root));
  }
  return [...new Set(out)];
}

function node(tag) {
  const cls = new Set();
  const listeners = {};
  const n = {
    tagName: tag.toUpperCase(), nodeType: 1, children: [], parentNode: null, style: {}, dataset: {}, attrs: {}, _text: "",
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
      replace: (a, b) => { if (!cls.has(a)) return false; cls.delete(a); cls.add(b); return true; },
    },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    get className() { return [...cls].join(" "); },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(""); },
    set textContent(v) { n._text = String(v); for (const c of n.children) c.parentNode = null; n.children = []; },
    get isConnected() { let p = n; while (p.parentNode) p = p.parentNode; return Boolean(p.connected); },
    get firstElementChild() { return n.children[0] ?? null; },
    get firstChild() { return n.children[0] ?? null; },
    get lastElementChild() { return n.children.at(-1) ?? null; },
    get nextSibling() { const s = n.parentNode?.children; return s ? s[s.indexOf(n) + 1] ?? null : null; },
    get nextElementSibling() { return n.nextSibling; },
    get previousElementSibling() { const s = n.parentNode?.children; return s ? s[s.indexOf(n) - 1] ?? null : null; },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k] ?? null; },
    removeAttribute(k) { delete n.attrs[k]; }, hasAttribute: (k) => k in n.attrs,
    addEventListener(t, f) { (listeners[t] ??= []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] ?? []).filter((g) => g !== f); },
    dispatchEvent(e) { for (const f of listeners[e.type] ?? []) f(e); return true; },
    insertBefore(k, ref) {
      const list = k.tagName === "#FRAGMENT" ? k.children.splice(0) : [k];
      for (const c of list) {
        c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1);
        c.parentNode = n;
        const i = ref ? n.children.indexOf(ref) : -1;
        if (i < 0) n.children.push(c); else n.children.splice(i, 0, c);
      }
      return k;
    },
    append(...kids) { for (const k of kids) n.insertBefore(typeof k === "string" ? Object.assign(node("#text"), { _text: k }) : k, null); },
    appendChild(k) { n.append(k); return k; },
    prepend(...kids) { const first = n.children[0] ?? null; for (const k of kids) n.insertBefore(typeof k === "string" ? Object.assign(node("#text"), { _text: k }) : k, first); },
    before(...kids) { for (const k of kids) n.parentNode?.insertBefore(k, n); },
    after(...kids) { const p = n.parentNode, next = n.nextSibling; for (const k of kids) p?.insertBefore(k, next); },
    remove() { if (n.parentNode) { n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = null; } },
    replaceWith(k) { n.before(k); n.remove(); },
    replaceChildren(...kids) { for (const c of n.children) c.parentNode = null; n.children = []; n._text = ""; n.append(...kids); },
    contains(o) { for (let p = o; p; p = p.parentNode) if (p === n) return true; return false; },
    closest(sel) { for (let p = n; p; p = p.parentNode) if (sel.split(",").some((s) => matches(p, s))) return p; return null; },
    querySelectorAll: (sel) => select(n, sel),
    querySelector: (sel) => select(n, sel)[0] ?? null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 320, height: 44, bottom: 44, right: 320 }),
    // Plain markup only (nav/pullrefresh.js's): tags with a class, text between them.
    set innerHTML(html) {
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
    },
    focus() {}, blur() {}, scrollTo() {},
    scrollTop: 0, clientHeight: 480, offsetHeight: 44, value: "",
  };
  return n;
}

function installDom() {
  const root = node("html");
  root.connected = true;
  const body = node("body");
  root.append(body);
  globalThis.document = {
    documentElement: root, body,
    createElement: (t) => node(t),
    createElementNS: (_, t) => node(t),
    createDocumentFragment: () => node("#fragment"),
    createTextNode: (t) => Object.assign(node("#text"), { _text: t }),
    querySelectorAll: (sel) => select(root, sel),
    querySelector: (sel) => select(root, sel)[0] ?? null,
    addEventListener() {}, removeEventListener() {},
  };
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
