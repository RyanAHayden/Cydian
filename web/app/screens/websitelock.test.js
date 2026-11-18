// F145: the website's lock. Browse Anyway (and Lock Home) redraw Home at once; Lock Home and Install on the Website
// live in Settings > General > Website, not Signing; while locked, Install on the Website is padlocked and asks
// "Install iFizBox First" like Home's rows.
import { test } from "node:test";
import assert from "node:assert/strict";

// The page's window hears ifizbox:browse-lock (websign-gate.js setFirstVisit); Node's globalThis has no events of its own.
if (!globalThis.addEventListener) {
  const bus = new EventTarget();
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
}

// ---- a small fake DOM: enough for nav/ui.js grouped(), createSwitch and the settings pages ------------------------
function fakeDom() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: { removeProperty() {}, setProperty() {} },
      dataset: {}, parentNode: null, textContent: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      set innerHTML(_) { e.children = []; }, get innerHTML() { return ""; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
      append(...c) {
        for (const x of c) {
          if (x?.isFragment) { const kids = x.children.splice(0); kids.forEach((k) => e.append(k)); continue; }
          if (typeof x === "string") continue;
          x.remove?.();
          x.parentNode = e;
          e.children.push(x);
        }
      },
      replaceChildren(...c) { for (const k of e.children) k.parentNode = null; e.children = []; e.append(...c); },
      remove() { if (e.parentNode) { e.parentNode.children = e.parentNode.children.filter((x) => x !== e); e.parentNode = null; } },
      get isConnected() { let n = e; while (n.parentNode) n = n.parentNode; return n === body; },
      get firstChild() { return e.children[0] ?? null; },
      get lastChild() { return e.children.at(-1) ?? null; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      removeEventListener(t, f) { e.listeners[t] = (e.listeners[t] ?? []).filter((x) => x !== f); },
      click() { const ev = { currentTarget: e, target: e, preventDefault() {}, stopImmediatePropagation() {} }; for (const f of e.listeners.click ?? []) f(ev); },
      querySelectorAll(sel) {
        const classes = sel.split(".").filter(Boolean);
        const out = [];
        const walk = (n) => { for (const k of n.children) { if (classes.every((c) => k._cls?.has(c))) out.push(k); walk(k); } };
        walk(e);
        return out;
      },
      querySelector(sel) { return e.querySelectorAll(sel)[0] ?? null; },
      closest(sel) { const c = sel.replace(/^\./, ""); for (let n = e; n; n = n.parentNode) if (n._cls?.has(c)) return n; return null; },
      animate: () => ({ finished: Promise.resolve() }),
      focus() {}, blur() {}, setPointerCapture() {},
    };
    return e;
  };
  const body = make("body");
  return {
    body,
    createElement: make,
    createDocumentFragment: () => Object.assign(make("#fragment"), { isFragment: true }),
    addEventListener() {}, removeEventListener() {}, activeElement: null,
    documentElement: { dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, getAttribute: () => null },
    querySelectorAll: () => [],
  };
}

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const labels = (n) => n.querySelectorAll(".cell-label").map((x) => x.textContent);

async function withDom(fn) {
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = fakeDom();
  globalThis.localStorage = memory();
  try { return await fn(globalThis.document); } finally {
    globalThis.document = saved.document;
    if (saved.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved.localStorage;
  }
}

// ---- 1) Home follows the lock -----------------------------------------------------------------------------------

test("F145: Browse Anyway redraws Home at once, and so does locking it again", async () => {
  const { followBrowseLock } = await import("./home.js");
  const { askToBrowse, setFirstVisit, browsingLocked } = await import("../websign-gate.js");
  const storage = memory();
  const locked = () => browsingLocked({ mode: "site", storage });
  // Home as drawn: locked. Each redraw draws a new page that follows on from its own state (as renderRoot does).
  const draws = [];
  const page = (wasLocked) => {
    draws.push(wasLocked);
    followBrowseLock({ wasLocked, locked, redraw: () => page(locked()) });
  };
  page(locked());
  assert.deepEqual(draws, [true]);
  // Browse Anyway on the alert (a locked row, a locked tab or Settings): redrawn unlocked, with no reload.
  const r = await askToBrowse({ alert: async (a) => {
    assert.deepEqual(a.buttons, ["Install iFizBox", "Browse Anyway", "Cancel"]);
    return { index: 1 };
  }, storage });
  assert.equal(r, "browse");
  assert.deepEqual(draws, [true, false], "one redraw, unlocked");
  // Cancel changes nothing, so nothing redraws.
  await askToBrowse({ alert: async () => ({ index: 2 }), storage });
  setFirstVisit("later", storage); // the same state again: no redraw
  assert.deepEqual(draws, [true, false]);
  // Settings' Lock Home switch: locked again at once.
  setFirstVisit("ask", storage);
  assert.deepEqual(draws, [true, false, true]);
});

test("F145: a Home page that's gone stops listening", async () => {
  const { followBrowseLock } = await import("./home.js");
  const target = new EventTarget();
  let alive = true, redraws = 0, state = true;
  followBrowseLock({ wasLocked: true, locked: () => state, alive: () => alive, redraw: () => redraws++, target });
  alive = false;
  state = false;
  target.dispatchEvent(new Event("ifizbox:browse-lock"));
  alive = true;
  target.dispatchEvent(new Event("ifizbox:browse-lock"));
  assert.equal(redraws, 0);
});

// ---- 2) the new place -------------------------------------------------------------------------------------------

test("F145: Lock Home and Install on the Website are in General > Website on the website, and only there", async () => {
  await withDom(async (doc) => {
    const { websiteSection, LOCK_HOME_LABEL, WEBSITE_INSTALLS_LABEL } = await import("./website-settings.js");
    const { render } = await import("./settings.js");
    const page = doc.createElement("div");
    doc.body.append(page);
    render(page, { tab: "home", path: ["general"] });
    const box = page.querySelector(".website-settings");
    assert.ok(box, "General has the Website groups");
    assert.deepEqual(box.querySelectorAll(".group-header").map((h) => h.textContent), ["Website", "Other Apps"]);
    assert.deepEqual(labels(box), [LOCK_HOME_LABEL, WEBSITE_INSTALLS_LABEL]);
    // Other pages and builds don't have them.
    const display = doc.createElement("div");
    render(display, { tab: "home", path: ["display"] });
    assert.equal(display.querySelector(".website-settings"), null);
    for (const mode of ["sideload", "jailbreak"]) assert.equal(websiteSection({ mode }).children.length, 0, mode);
  });
  // Settings > Signing on the website no longer draws them.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const signing = src.slice(src.indexOf("async function drawSiteSigning"));
  assert.ok(!/websiteSection|websiteInstallsSection|Lock Home/.test(signing), "nothing of it left in Signing");
  assert.ok(!/function websiteInstallsSection/.test(src));
});

// ---- 3) the locked rows -----------------------------------------------------------------------------------------

test("F145: while the site is locked, Install on the Website is padlocked and asks Install iFizBox First", async () => {
  await withDom(async (doc) => {
    const { websiteSection, WEBSITE_INSTALLS_LABEL } = await import("./website-settings.js");
    const { setFirstVisit, websiteInstallsOn } = await import("../websign-gate.js");
    const storage = memory();
    const target = new EventTarget();
    const asked = [];
    let installs = 0;
    let answer = 2;
    const alert = async (a) => { asked.push(a); return { index: answer }; };
    // setFirstVisit fires the event on globalThis; send it to this section's target too.
    const relay = () => target.dispatchEvent(new Event("ifizbox:browse-lock"));
    globalThis.addEventListener("ifizbox:browse-lock", relay);
    try {
      const box = websiteSection({ mode: "site", storage, alert, install: async () => { installs++; }, target });
      doc.body.append(box);
      const group = () => box.querySelectorAll(".group")[1];
      const row = () => group().querySelector(".cell-inner");
      assert.equal(box.dataset.locked, "true");
      assert.ok(group().classList.contains("home-locked"), "dimmed like Home's locked rows");
      assert.ok(row().classList.contains("chevron"), "a padlock where the chevron goes (home.css .home-locked)");
      assert.equal(row().querySelector(".switch"), null, "no switch to flip while locked");
      assert.equal(row().querySelector(".cell-label").textContent, WEBSITE_INSTALLS_LABEL);
      // The Lock Home switch is on and stays usable.
      const lockSwitch = box.querySelectorAll(".group")[0].querySelector(".switch");
      assert.equal(lockSwitch.getAttribute("aria-checked"), "true");

      // Cancel: still locked, nothing installed, website installs still off.
      await row().click();
      await new Promise((r) => setImmediate(r));
      assert.equal(asked.length, 1);
      assert.equal(asked[0].title, "Install iFizBox First");
      assert.deepEqual(asked[0].buttons, ["Install iFizBox", "Browse Anyway", "Cancel"]);
      assert.deepEqual(asked[0].countdown, { button: 1, seconds: 5 }, "Browse Anyway (5)");
      assert.equal(box.dataset.locked, "true");
      assert.equal(websiteInstallsOn(storage), false);

      // Install iFizBox: Home's install flow.
      answer = 0;
      row().click();
      await new Promise((r) => setImmediate(r));
      assert.equal(installs, 1);
      assert.equal(box.dataset.locked, "true");

      // Browse Anyway: the section redraws unlocked, with F96's switch back.
      answer = 1;
      row().click();
      await new Promise((r) => setImmediate(r));
      assert.equal(box.dataset.locked, "false");
      assert.ok(!group().classList.contains("home-locked"));
      assert.ok(row().querySelector(".switch"), "the switch again");
      assert.equal(box.querySelectorAll(".group")[0].querySelector(".switch").getAttribute("aria-checked"), "false", "Lock Home off");

      // Lock Home on again: padlocked again at once.
      box.querySelectorAll(".group")[0].querySelector(".switch").click();
      assert.equal(box.dataset.locked, "true");
      assert.ok(group().classList.contains("home-locked"));
      setFirstVisit("later", storage);
      assert.equal(box.dataset.locked, "false");
    } finally {
      globalThis.removeEventListener("ifizbox:browse-lock", relay);
    }
  });
});
