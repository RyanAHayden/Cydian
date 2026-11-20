// nav/go.js: screens' one go()/back(), and a page's handle on its own nav bar item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { go, back, setNavigator, pageHandle, handleOf } from "./go.js";

test("go: before app.js hands in the router it writes the hash; a route, a hash and one without # all work", () => {
  const saved = globalThis.location;
  globalThis.location = { hash: "" };
  try {
    setNavigator(null);
    go({ tab: "sources", path: ["a b"] });
    assert.equal(globalThis.location.hash, "/sources/a%20b");
    go("#/changes");
    assert.equal(globalThis.location.hash, "/changes");
    go("/home/settings/signing");
    assert.equal(globalThis.location.hash, "/home/settings/signing");
  } finally {
    globalThis.location = saved;
  }
});

test("go/back: once set, the navigator gets every call, go as a hash", () => {
  const calls = [];
  setNavigator({ go: (h) => calls.push(["go", h]), back: () => calls.push(["back"]) });
  try {
    go({ tab: "installed", path: ["myipas"] });
    go("/search");
    back();
    assert.deepEqual(calls, [["go", "#/installed/myipas"], ["go", "#/search"], ["back"]]);
  } finally {
    setNavigator(null);
  }
});

test("screens never write location.hash or look up their nav item by index: they use go()/back() and their handle", () => {
  const dir = new URL("../screens/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js") && !n.endsWith(".test.js"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /location\.hash\s*=[^=]/, f);
    assert.doesNotMatch(src, /\.nav-stack\[data-tab="\$\{/, f);
    assert.doesNotMatch(src, /closest\??\.?\(\s*"\.nav-item"\s*\)/, f);
  }
});

function fakeItem() {
  const h1 = { textContent: "Package" };
  const btn = (text, ...cls) => ({ textContent: text, classList: { contains: (c) => cls.includes(c) } });
  const buttons = [btn("", "bar-button", "share-button"), btn("Refresh", "bar-button", "nav-moved"), btn("Install", "bar-button")];
  const left = { id: "left" };
  return {
    h1, buttons, left,
    querySelector: (s) => (s === ".nav-title" ? h1 : s === ".nav-left" ? left : null),
    querySelectorAll: (s) => (s === ".nav-right .bar-button" ? buttons : []),
  };
}

test("pageHandle: title, setTitle, the page's own right button (not Share, not a moved copy), a matched one, left", () => {
  const item = fakeItem();
  const body = {};
  const page = pageHandle(item, body);
  assert.equal(handleOf(body), page);
  assert.equal(handleOf({}), null);
  assert.equal(handleOf(null), null);
  assert.equal(page.title(), "Package");
  page.setTitle("Foo");
  assert.equal(item.h1.textContent, "Foo");
  assert.equal(page.rightButton(), item.buttons[2]);
  assert.equal(page.rightButton((b) => b.textContent === "Refresh"), item.buttons[1]);
  assert.equal(page.rightButton((b) => b.textContent === "Nope"), null);
  assert.equal(page.left(), item.left);
});
