// A small DOM for node --test: enough for nav/ui.js grouped(), B148's page refresh and the screens/ tests.
// Nodes keep their parts where a test can look: `children`, `attrs`, `dataset`, `style`, `listeners`, `_cls` (the
// class Set) and `_text` (text set on the node itself; textContent adds the children's). Selectors: one or more
// classes (".a.b"), a tag ("li"), ":scope > .a" and comma lists. Strings appended become "#text" children.
// SPDX-License-Identifier: GPL-3.0-or-later
const noop = () => {};

function matches(n, sel) {
  if (!n || n.tagName === "#text") return false;
  const m = /^([\w-]*)((?:\.[\w-]+)*)$/i.exec(sel.trim());
  if (!m) return false;
  // A bare word matches the tag or, as the first copy of this DOM read every selector, a class.
  if (m[1] && n.tagName !== m[1].toUpperCase() && !n._cls.has(m[1])) return false;
  return m[2].split(".").filter(Boolean).every((c) => n._cls.has(c));
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
    isFragment: tag === "#fragment", children: [], parentNode: null, style, dataset: {}, attrs: {}, listeners: {}, _text: "",
    _cls: cls, hidden: false, disabled: false, type: "", value: "",
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
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
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k] ?? null; },
    removeAttribute(k) { delete n.attrs[k]; }, hasAttribute(k) { return k in n.attrs; },
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
    querySelectorAll(sel) {
      const out = [];
      for (const s of sel.split(",").map((x) => x.trim())) {
        if (s.startsWith(":scope > ")) { out.push(...n.children.filter((c) => matches(c, s.slice(9)) && !out.includes(c))); continue; }
        const walk = (x) => { for (const c of x.children) { if (matches(c, s) && !out.includes(c)) out.push(c); walk(c); } };
        walk(n);
      }
      return out;
    },
    querySelector(sel) { return n.querySelectorAll(sel)[0] ?? null; },
    animate: () => ({ finished: Promise.resolve(), cancel: noop }),
    focus: noop, blur: noop, setPointerCapture: noop, releasePointerCapture: noop,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
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
// Swaps `globalThis.document` for `doc` (a fresh fakeDocument() if none) while `fn` runs, sync or async.
export async function withDocument(fn, doc = fakeDocument()) {
  const saved = globalThis.document;
  globalThis.document = doc;
  try { return await fn(doc); } finally { globalThis.document = saved; }
}
