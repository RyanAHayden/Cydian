// F210: the app page's one-tap Installed toggle in the nav bar (screens/altstore.js markToggle, nav/navbar.js
// addNavIcon): a tap marks the app installed at the source's latest version, a second tap forgets it, and the icon
// follows the record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markToggle, toggleMarked, markToggleApplies, MARK_INSTALLED_LABEL, MARK_NOT_INSTALLED_LABEL } from "./altstore.js";
import { addNavIcon } from "../nav/navbar.js";
import { memoryAppStore, recordInstall, removeInstall } from "../core/installed.js";
import { BUNDLE_ID, GITHUB_REPO, NAME } from "../brand.js";

function fakeElement(tag) {
  const cls = new Set();
  const attrs = new Map();
  const listeners = {};
  const e = {
    tagName: tag.toUpperCase(), children: [], parentElement: null, dataset: {}, type: "",
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
    },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    get className() { return [...cls].join(" "); },
    setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null,
    addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    click: () => Promise.all((listeners.click ?? []).map((f) => f({ currentTarget: e }))),
    append: (...kids) => kids.forEach((k) => { k.parentElement?.children.splice(k.parentElement.children.indexOf(k), 1); k.parentElement = e; e.children.push(k); }),
    remove: () => { if (e.parentElement) { e.parentElement.children.splice(e.parentElement.children.indexOf(e), 1); e.parentElement = null; } },
  };
  return e;
}

function withDocument(doc, f) {
  const saved = globalThis.document;
  globalThis.document = doc;
  return Promise.resolve().then(f).finally(() => { globalThis.document = saved; });
}

const APP = { bundleIdentifier: "com.x.a", name: "A", sourceUrl: "https://s/apps.json", sourceName: "S", iconURL: "https://s/a.png",
  versions: [{ version: "2.1", downloadURL: "https://s/a2.ipa" }, { version: "2.0", downloadURL: "https://s/a1.ipa" }] };
const PKG = { key: "alt:https://s/apps.json", row: { id: "com.x.a" }, stanza: { kind: "ipa", ipa: APP } };

test("toggleMarked: the first tap records the source's latest version, the second forgets it", async () => {
  const mem = memoryAppStore([{ id: "com.x.b", version: "1" }]);
  assert.equal(await toggleMarked(APP, PKG, null, { store: async () => mem }), true);
  const rec = (await mem.all()).find((r) => r.id === "com.x.a");
  assert.equal(rec.version, "2.1");
  assert.equal(rec.key, PKG.key);
  assert.equal(rec.sourceName, "S");
  assert.equal(rec.icon, APP.iconURL);
  assert.equal(await toggleMarked(APP, PKG, null, { store: async () => mem }), false);
  assert.deepEqual((await mem.all()).map((r) => r.id), ["com.x.b"]);
});

test("markToggle: outline and 'Mark as Installed' until marked, filled and 'Mark as Not Installed' after; HUD and haptic each tap", async () => {
  await withDocument({ createElement: fakeElement }, async () => {
    const mem = memoryAppStore();
    const said = [];
    let buzzes = 0;
    const b = markToggle(APP, PKG, null, { store: async () => mem, buzz: () => { buzzes += 1; }, feedback: (t) => said.push(t) });
    await b.refreshed;
    assert.equal(b.tagName, "BUTTON");
    for (const c of ["bar-button", "bar-icon", "mark-toggle"]) assert.ok(b.classList.contains(c), c);
    assert.equal(b.classList.contains("is-marked"), false);
    assert.equal(b.getAttribute("aria-label"), MARK_INSTALLED_LABEL);

    await b.click();
    assert.equal((await mem.all())[0].version, "2.1", "marked at the latest version, no picker");
    assert.ok(b.classList.contains("is-marked"));
    assert.equal(b.getAttribute("aria-label"), MARK_NOT_INSTALLED_LABEL);

    await b.click();
    assert.deepEqual(await mem.all(), []);
    assert.equal(b.classList.contains("is-marked"), false);
    assert.equal(b.getAttribute("aria-label"), MARK_INSTALLED_LABEL);
    assert.deepEqual(said, ["Marked as Installed", "Marked as Not Installed"]);
    assert.equal(buzzes, 2);

    // The record changed elsewhere (an install, the Tracking section's rows): refresh follows it.
    await recordInstall(mem, { id: "com.x.a", version: "1.0" });
    await b.refresh();
    assert.ok(b.classList.contains("is-marked"));
    await removeInstall(mem, "com.x.a");
    await b.refresh();
    assert.equal(b.classList.contains("is-marked"), false);

    // Installed by iFizBox at an older version: filled, and a tap forgets it (not re-marked at the latest).
    await recordInstall(mem, { id: "com.x.a", version: "2.0" });
    const c = markToggle(APP, PKG, null, { store: async () => mem, buzz() {}, feedback() {} });
    await c.refreshed;
    assert.ok(c.classList.contains("is-marked"));
    await c.click();
    assert.deepEqual(await mem.all(), []);
  });
});

test("markToggle: no store, nothing changes and no HUD claims it did", async () => {
  await withDocument({ createElement: fakeElement }, async () => {
    const said = [];
    const b = markToggle(APP, PKG, null, { store: async () => { throw new Error("no IndexedDB"); }, buzz() {}, feedback: (t) => said.push(t) });
    await b.refreshed;
    await b.click();
    assert.deepEqual(said, []);
    assert.equal(b.classList.contains("is-marked"), false);
  });
});

test("markToggleApplies: hidden for iFizBox's own app and an app with no version to mark", () => {
  assert.equal(markToggleApplies(APP), true);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: BUNDLE_ID }), false);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: `${BUNDLE_ID}.lite` }), false);
  assert.equal(markToggleApplies({ ...APP, versions: [{ version: "1", downloadURL: `https://github.com/${GITHUB_REPO}/releases/latest/download/${NAME}.ipa` }] }), false);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: "" }), false);
  assert.equal(markToggleApplies({ ...APP, versions: [] }), false);
  assert.equal(markToggleApplies(null), false);
});

test("addNavIcon: after Install in the DOM (setRightLabel still finds Install first), ordered left of it; a redraw replaces it", async () => {
  const right = fakeElement("div");
  right.querySelector = () => null;
  right.querySelectorAll = () => right.children.filter((c) => c.classList.contains("nav-icon-left"));
  const item = fakeElement("div");
  item.querySelector = (s) => (s === ".nav-right" ? right : null);
  const share = fakeElement("button");
  share.className = "bar-button bar-icon share-button";
  const install = fakeElement("button");
  install.className = "bar-button";
  right.append(share, install);
  const page = fakeElement("section");
  page.className = "page";
  const stack = fakeElement("div");
  stack.dataset.tab = "sources";
  stack.append(fakeElement("section"), page);
  stack.children[0].className = "page";
  const body = { closest: (s) => (s === ".page" ? page : null) };
  const doc = { createElement: fakeElement, querySelectorAll: (s) => (s === '.nav-stack[data-tab="sources"] > .nav-item' ? [fakeElement("div"), item] : []) };
  await withDocument(doc, () => {
    const icon = fakeElement("button");
    assert.equal(addNavIcon(body, icon, "mark"), true);
    assert.deepEqual(right.children, [share, install, icon]);
    assert.ok(icon.classList.contains("nav-icon-left"));
    assert.ok(install.classList.contains("nav-after-icon"));
    assert.equal(share.classList.contains("nav-after-icon"), false);
    assert.ok(item.classList.contains("has-nav-icon"));
    const again = fakeElement("button");
    addNavIcon(body, again, "mark");
    assert.deepEqual(right.children, [share, install, again], "the page drawn again: one toggle");
    assert.equal(addNavIcon({ closest: () => null }, fakeElement("button")), false, "no nav item yet");
  });
});
