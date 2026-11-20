// A small DOM for node --test: enough for nav/ui.js grouped() and the queries B148's page refresh makes
// (querySelector/querySelectorAll by one class, contains, isConnected through a root marked connected).
function fakeNode(tag) {
  const cls = new Set();
  const n = {
    tagName: tag, children: [], parentNode: null, style: {}, dataset: {}, attrs: {}, _text: "",
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
    },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    get className() { return [...cls].join(" "); },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(""); },
    set textContent(v) { n._text = String(v); n.children = []; },
    get isConnected() { let p = n; while (p.parentNode) p = p.parentNode; return Boolean(p.connected); },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k] ?? null; },
    addEventListener() {},
    append(...kids) {
      for (const k of kids) {
        if (typeof k === "string") { n.children.push(Object.assign(fakeNode("#text"), { _text: k })); continue; }
        const list = k.tagName === "#fragment" ? k.children.splice(0) : [k];
        for (const c of list) { c.parentNode = n; n.children.push(c); }
      }
    },
    prepend(...kids) { const rest = n.children.splice(0); n.append(...kids); n.children.push(...rest); },
    replaceChildren(...kids) { n.children = []; n._text = ""; n.append(...kids); },
    contains(o) { for (let p = o; p; p = p.parentNode) if (p === n) return true; return false; },
    querySelectorAll(sel) {
      const want = sel.replace(/^\./, "");
      const out = [];
      const walk = (x) => { for (const c of x.children) { if (c.classList.contains(want)) out.push(c); walk(c); } };
      walk(n);
      return out;
    },
    querySelector(sel) { return n.querySelectorAll(sel)[0] ?? null; },
  };
  return n;
}

export const fakeDocument = () => ({
  createElement: (t) => fakeNode(t),
  createDocumentFragment: () => fakeNode("#fragment"),
});
// A page body that counts as on screen: nodes appended under it are isConnected.
export function fakePage() {
  const p = fakeNode("div");
  p.connected = true;
  return p;
}
export const tick = () => new Promise((r) => setTimeout(r, 0));
