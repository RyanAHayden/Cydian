// A small DOM for node --test: enough for nav/ui.js grouped(), B148's page refresh and the screens/ tests.
// Nodes keep their parts where a test can look: `children`, `attrs`, `dataset`, `style`, `listeners`, `_cls` (the
// class Set) and `_text` (text set on the node itself; textContent adds the children's). Selectors: a tag, classes
// and [attr] / [attr="v"] in one compound ("li.a.b[data-id]"), chained by descendant spaces or ">", ":scope" first,
// and comma lists. Strings appended become "#text" children. withDocument() runs a test with one as `document`.
// SPDX-License-Identifier: GPL-3.0-or-later
const noop = () => {};

// One compound selector: a tag, classes and [attr] / [attr="value"] (data-* read from dataset).
function matches(n, sel) {
  if (!n || n.tagName === "#text" || !n._cls) return false;
  const m = /^([\w-]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(sel.trim());
  if (!m) return false;
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  if (!m[2].split(".").filter(Boolean).every((c) => n._cls.has(c))) return false;
  for (const [, k, v] of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const got = k.startsWith("data-") ? n.dataset[k.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] : n.getAttribute(k);
    if (got == null || (v !== undefined && String(got) !== v)) return false;
  }
  return true;
}

// A selector list under `root`: each part a chain of compound selectors joined by descendant spaces or " > ", which
// may start with ":scope". `root` itself is never in the answer.
function select(root, sel) {
  const out = [];
  for (const part of sel.split(",")) {
    const chain = part.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
    let set = [root];
    for (let i = 0; i < chain.length; i++) {
      if (chain[i] === ":scope") continue;
      const child = chain[i] === ">";
      if (child) i++;
      const next = [];
      const walk = (x, deep) => { for (const c of x.children) { if (matches(c, chain[i]) && !next.includes(c)) next.push(c); if (deep) walk(c, true); } };
      for (const r of set) walk(r, !child);
      set = next;
    }
    for (const x of set) if (x !== root && !out.includes(x)) out.push(x);
  }
  return out;
}

function fakeNode(tag) {
  const cls = new Set();
  const style = {};
  for (const k of ["setProperty", "removeProperty"]) Object.defineProperty(style, k, { value: noop, writable: true, configurable: true });
  const event = (type, more) => ({
    type, target: n, currentTarget: n, preventDefault: noop, stopPropagation: noop, stopImmediatePropagation: noop, ...more,
  });
  const n = {
    tagName: String(tag).startsWith("#") ? String(tag) : String(tag).toUpperCase(),
    nodeType: tag === "#text" ? 3 : tag === "#fragment" ? 11 : 1,
    isFragment: tag === "#fragment", children: [], parentNode: null, style, dataset: {}, attrs: {}, listeners: {}, _text: "",
    _cls: cls, hidden: false, disabled: false, type: "", value: "",
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
      replace: (a, b) => { if (!cls.has(a)) return false; cls.delete(a); cls.add(b); return true; },
    },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    get className() { return [...cls].join(" "); },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(""); },
    set textContent(v) { n._text = String(v); for (const c of n.children) c.parentNode = null; n.children = []; },
    set innerHTML(v) { n._html = v; for (const c of n.children) c.parentNode = null; n.children = []; n._text = ""; },
    get innerHTML() { return n._html ?? ""; },
    get isConnected() { let p = n; while (p.parentNode) p = p.parentNode; return Boolean(p.connected); },
    get firstChild() { return n.children[0] ?? null; },
    get lastChild() { return n.children.at(-1) ?? null; },
    get firstElementChild() { return n.children.find((c) => c.tagName !== "#text") ?? null; },
    get lastElementChild() { return n.children.findLast((c) => c.tagName !== "#text") ?? null; },
    get nextSibling() { const s = n.parentNode?.children; return s ? s[s.indexOf(n) + 1] ?? null : null; },
    get nextElementSibling() { const s = n.parentNode?.children; return s ? s.slice(s.indexOf(n) + 1).find((c) => c.tagName !== "#text") ?? null : null; },
    get previousElementSibling() { const s = n.parentNode?.children; return s ? s.slice(0, s.indexOf(n)).findLast((c) => c.tagName !== "#text") ?? null : null; },
    get parentElement() { const p = n.parentNode; return p && !p.isFragment ? p : null; },
    get childElementCount() { return n.children.filter((c) => c.tagName !== "#text").length; },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k] ?? null; },
    removeAttribute(k) { delete n.attrs[k]; }, hasAttribute: (k) => k in n.attrs,
    // Runs the listeners for e.type now, with `e` as it is (a real dispatchEvent is synchronous too).
    dispatchEvent(e) { for (const f of n.listeners[e.type] ?? []) f(e); return true; },
    addEventListener(t, f) { (n.listeners[t] ??= []).push(f); },
    removeEventListener(t, f) { n.listeners[t] = (n.listeners[t] ?? []).filter((g) => g !== f); },
    // Runs the listeners for `t` with a stand-in event (fields in `more` added); resolves when async ones end.
    fire(t, more) { const ev = event(t, more); return Promise.all((n.listeners[t] ?? []).map((f) => f(ev))); },
    dispatch(t, more) { return n.fire(t, more); },
    click() { return n.fire("click"); },
    // Puts each kid (a node, a fragment's children, or a string as a "#text" node) before `ref` (null: at the end),
    // taking it out of the parent it had.
    insertBefore(k, ref) {
      if (k == null || typeof k === "boolean") return k;
      if (typeof k !== "object") k = Object.assign(fakeNode("#text"), { _text: String(k) });
      const list = k.isFragment ? k.children.splice(0) : [k];
      for (const c of list) {
        c.remove?.();
        c.parentNode = n;
        const i = ref ? n.children.indexOf(ref) : -1;
        if (i < 0) n.children.push(c); else n.children.splice(i, 0, c);
      }
      return k;
    },
    append(...kids) { for (const k of kids) n.insertBefore(k, null); },
    appendChild(k) { return n.insertBefore(k, null); },
    prepend(...kids) { const first = n.children[0] ?? null; for (const k of kids) n.insertBefore(k, first); },
    removeChild(k) { k.remove(); return k; },
    replaceChildren(...kids) { for (const c of n.children) c.parentNode = null; n.children = []; n._text = ""; n.append(...kids); },
    remove() {
      const p = n.parentNode;
      if (p) { const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); }
      n.parentNode = null;
    },
    before(...kids) { for (const k of kids) n.parentNode.insertBefore(k, n); },
    after(...kids) { const p = n.parentNode; const next = p.children[p.children.indexOf(n) + 1] ?? null; for (const k of kids) p.insertBefore(k, next); },
    replaceWith(...kids) { const p = n.parentNode; n.before(...kids); if (p) n.remove(); },
    contains(o) { for (let p = o; p; p = p.parentNode) if (p === n) return true; return false; },
    closest(sel) {
      for (let p = n; p; p = p.parentNode) if (sel.split(",").some((s) => matches(p, s))) return p;
      return null;
    },
    querySelectorAll(sel) { return select(n, sel); },
    querySelector(sel) { return n.querySelectorAll(sel)[0] ?? null; },
    animate: () => ({ finished: Promise.resolve(), cancel: noop }),
    focus: noop, blur: noop, setPointerCapture: noop,
  };
  return n;
}

// A document: elements, text nodes and fragments, a `body` that counts as on screen, and listeners it records.
export const fakeDocument = () => {
  const body = fakeNode("body");
  body.connected = true;
  const doc = {
    body, listeners: {}, activeElement: null,
    createElement: (t) => fakeNode(t),
    createElementNS: (_ns, t) => fakeNode(t),
    createTextNode: (t) => Object.assign(fakeNode("#text"), { _text: String(t) }),
    createDocumentFragment: () => fakeNode("#fragment"),
    addEventListener(t, f) { (doc.listeners[t] ??= []).push(f); },
    removeEventListener(t, f) { doc.listeners[t] = (doc.listeners[t] ?? []).filter((g) => g !== f); },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    documentElement: Object.assign(fakeNode("html"), { connected: true }),
  };
  return doc;
};
// A page body that counts as on screen: nodes appended under it are isConnected.
export function fakePage() {
  const p = fakeNode("div");
  p.connected = true;
  return p;
}
export const tick = () => new Promise((r) => setTimeout(r, 0));
// Runs fn(doc) with `doc` (a fresh fakeDocument() when not given) as globalThis.document, then puts the old one
// back (none: deleted). Returns what fn returns; when that is a promise, the old document comes back once it settles.
export function withDocument(fn, doc = fakeDocument()) {
  const had = "document" in globalThis;
  const saved = globalThis.document;
  const restore = () => { if (had) globalThis.document = saved; else delete globalThis.document; };
  globalThis.document = doc;
  let out;
  try { out = fn(doc); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === "function") return Promise.resolve(out).finally(restore);
  restore();
  return out;
}
