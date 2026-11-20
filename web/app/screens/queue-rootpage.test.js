// The Queue button finds Installed's root nav bar through the page handle installed.js hands screens/queue.js
// (setInstalledRoot), never by a selector into the nav stack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initAppQueueChrome, setInstalledRoot, updateAppChrome } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { pageHandle } from "../nav/go.js";

function make(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, dataset: {}, parentNode: null,
    textContent: "", _cls: new Set(),
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
      toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return e.attrs[k] ?? null; },
    append(...c) { for (const x of c) if (x && typeof x === "object") { x.parentNode = e; e.children.push(x); } },
    prepend(...c) { for (const x of c.reverse()) if (x && typeof x === "object") { x.parentNode = e; e.children.unshift(x); } },
    remove() { const p = e.parentNode; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      const walk = (n) => { for (const k of n.children) { if (k._cls?.has(cls)) return k; const f = walk(k); if (f) return f; } return null; };
      return walk(e);
    },
    querySelectorAll: () => [],
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}

test("setInstalledRoot: the IPA queue's Queue button goes in the handed root page's left slot", () => {
  const saved = globalThis.document;
  globalThis.document = {
    createElement: make, createTextNode: (t) => Object.assign(make("#text"), { textContent: String(t) }),
    querySelector: () => { throw new Error("queue.js looks the root nav bar up by handle, not by selector"); },
  };
  try {
    const queue = createAppQueue();
    initAppQueueChrome({ setBadge() {} }, { queue });
    queue.add({ id: "com.example.a", name: "a", version: "1.0", installed: "1.0", url: "https://example.invalid/a.ipa" });
    assert.equal(updateAppChrome()?.button, true, "no root page yet: nothing to draw on, no throw");

    const item = make("div");
    const left = make("div");
    left.className = "nav-left";
    item.append(left);
    setInstalledRoot(pageHandle(item));
    assert.ok(left.querySelector(".queue-button"), "drawn as soon as the root is handed in");

    queue.clearAll();
    updateAppChrome();
    assert.equal(left.querySelector(".queue-button"), null);
  } finally {
    setInstalledRoot(null);
    globalThis.document = saved;
  }
});

test("installed.js hands its root page to queue.js; neither navbar.js nor queue.js queries the nav stack", () => {
  const installed = readFileSync(new URL("./installed.js", import.meta.url), "utf8");
  assert.match(installed, /isRoot\(route\)\) handRootPage\(page\)/);
  assert.match(installed, /setInstalledRoot\(page\)/);
  for (const f of ["./queue.js", "../nav/navbar.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /\.nav-stack\[/, f);
  }
});
