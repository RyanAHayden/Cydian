// F150: Cydia's drop-down reload bar: the words it shows as a refresh goes on (core/reloadsteps.js), its Cancel
// (nav/reloadbar.js, screens/sources.js startRun) and that nothing it adds blocks the screens underneath.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reloadSteps, STEP_TEXT } from "../core/reloadsteps.js";
import { showReloadBar } from "./reloadbar.js";
import { startRun } from "../screens/sources.js";

// ---- a small DOM: what reloadbar.js and sources.js touch ----
function fakeEl(tag, doc) {
  const kids = [];
  const listeners = {};
  const cls = new Set();
  const el = {
    tagName: tag.toUpperCase(), attrs: {}, children: kids, parent: null, textContent: "", type: "",
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    get className() { return [...cls].join(" "); },
    set className(v) { cls.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) cls.add(c); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    set innerHTML(html) {
      kids.length = 0;
      for (const m of String(html).matchAll(/<(svg|span)[^>]*class="([^"]+)"/g)) { const k = fakeEl(m[1], doc); k.className = m[2]; k.parent = el; kids.push(k); }
    },
    querySelector(sel) { return kids.find((k) => k.classList.contains(sel.replace(/^\./, ""))) ?? null; },
    append(...xs) { for (const x of xs) { x.parent = el; kids.push(x); } },
    remove() { if (el.parent) { const i = el.parent.children.indexOf(el); if (i >= 0) el.parent.children.splice(i, 1); el.parent = null; } },
    addEventListener(t, f) { (listeners[t] ??= []).push(f); },
    click() { for (const f of listeners.click ?? []) f({ stopPropagation() {} }); },
    animations: [],
    animate(frames, opts) { const a = { frames, opts, finished: Promise.resolve() }; el.animations.push(a); return a; },
  };
  return el;
}
function fakeDoc() {
  const doc = {};
  doc.createElement = (t) => fakeEl(t, doc);
  doc.body = fakeEl("body", doc);
  doc.documentElement = fakeEl("html", doc);
  return doc;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const cancelButton = (bar) => bar.children.find((k) => k.classList.contains("reload-cancel"));

// ---- the words ----

test("F150: the text goes Updating Sources, Downloading <each source>, Loading Data, Building Searcher Cache", () => {
  const seen = [];
  const s = reloadSteps([{ key: "a", name: "BigBoss" }, { key: "b", name: "Chariz" }, { key: "c" }], { apt: true, onText: (t) => seen.push(t) });
  assert.equal(s.text(), "Updating Sources");
  s.each({ key: "a" });          // apt-get update is over and BigBoss answered: the next one is named
  s.each({ key: "c" });          // out of order: Chariz is still the first one waiting
  s.each({ key: "b" });          // none left: the headline
  s.load();
  s.cache();
  assert.deepEqual(seen, ["Updating Sources", "Downloading Chariz", "Downloading Packages", "Loading Data", "Building Searcher Cache"]);
  assert.deepEqual(Object.values(STEP_TEXT), ["Updating Sources", "Downloading Packages", "Loading Data", "Building Searcher Cache"]);
});

test("F150: without apt (the website, the sideload app) it starts on the first source", () => {
  const s = reloadSteps([{ key: "a", name: "Repo A" }, { key: "b", name: "Repo B" }]);
  assert.equal(s.text(), "Downloading Repo A");
  s.each({ key: "a" });
  assert.equal(s.text(), "Downloading Repo B");
  assert.equal(reloadSteps([]).text(), "Downloading Packages");
  assert.equal(reloadSteps([], { apt: true }).text(), "Downloading Packages", "nothing to update: no apt step");
});

// ---- the bar ----

test("F150: the bar drops down with the text, changes it, and slides back up; only transform animates", async () => {
  const doc = fakeDoc();
  const bar = showReloadBar("Updating Sources", { doc });
  const el = bar.el;
  assert.equal(doc.body.children.length, 1, "one element: the strip, and no scrim");
  assert.ok(el.classList.contains("reload-bar"));
  assert.equal(el.attrs.role, "status");
  assert.ok(el.querySelector(".reload-spinner"));
  assert.equal(el.querySelector(".reload-text").textContent, "Updating Sources");
  assert.equal(cancelButton(el).textContent, "Cancel");
  assert.ok(cancelButton(el).classList.contains("done"), "the blue bar button");
  assert.ok(doc.documentElement.classList.contains("has-reload"), "the nav bar and screens move down");
  bar.set("Loading Data");
  assert.equal(el.querySelector(".reload-text").textContent, "Loading Data");
  bar.hide();
  assert.ok(!doc.documentElement.classList.contains("has-reload"));
  await tick();
  assert.equal(doc.body.children.length, 0);
  for (const a of el.animations) for (const f of a.frames) assert.deepEqual(Object.keys(f), ["transform"]);
});

test("F150: Cancel hides the bar and calls onCancel once; showing another bar replaces the first", async () => {
  const doc = fakeDoc();
  let cancelled = 0;
  const bar = showReloadBar("x", { doc, onCancel: () => cancelled++ });
  cancelButton(bar.el).click();
  cancelButton(bar.el).click();
  assert.equal(cancelled, 1);
  assert.equal(bar.hidden, true);
  const one = showReloadBar("one", { doc });
  const two = showReloadBar("two", { doc });
  assert.equal(one.hidden, true);
  assert.equal(two.hidden, false);
  two.hide();
});

test("F150: nothing blocks input: no full-screen layer, no pointer-events trick, the page moves rather than is covered", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
  const bar = rules.find((r) => r.sel === ".reload-bar");
  assert.ok(bar, ".reload-bar missing");
  assert.doesNotMatch(bar.decl, /inset\s*:\s*0|bottom\s*:|height\s*:\s*100/, "the strip is only as tall as a bar");
  assert.match(bar.decl, /height\s*:\s*calc\(44px \+ env\(safe-area-inset-top\)\)/);
  for (const r of rules.filter((x) => /reload/.test(x.sel))) {
    assert.doesNotMatch(r.decl, /pointer-events\s*:\s*none/, r.sel);
    assert.doesNotMatch(r.decl, /transition\s*:(?![^;]*transform)/, `${r.sel}: transform/opacity only`);
  }
  const push = rules.find((r) => r.sel === "html.has-reload #navbar, html.has-reload #screens");
  assert.ok(push, "the nav bar and screens move down while it shows");
  assert.match(push.decl, /transform\s*:\s*translateY\(44px\)/);
  // and the bar's own module makes no scrim (the HUD's .hud-scrim is what used to eat taps)
  assert.doesNotMatch(readFileSync(new URL("./reloadbar.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""), /scrim|inset/);
});

// ---- Sources' run under the bar ----

function withPage(fn) {
  const saved = { document: globalThis.document, CSS: globalThis.CSS };
  globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
  globalThis.CSS ??= { escape: (s) => s };
  return Promise.resolve(fn()).finally(() => { globalThis.document = saved.document; if (!saved.CSS) delete globalThis.CSS; });
}
function fakeCtx(doc, log) {
  return {
    setBadge: (tab, v) => log.badges.push(v),
    reloadBar: (text, opts) => { const b = showReloadBar(text, { ...opts, doc }); log.bars.push(b); return b; },
    loadData: async () => log.steps.push("load"),
    buildCache: async () => log.steps.push("cache"),
  };
}

test("F150: a run drops the bar and its text follows the refresh to the end; the page is never covered", () => withPage(async () => {
  const doc = fakeDoc();
  const log = { badges: [], bars: [], steps: [] };
  const texts = [];
  const run = startRun(fakeCtx(doc, log), ["a", "b"]);
  const bar = log.bars[0];
  const set = bar.set;
  bar.set = (t) => { texts.push(t); set(t); };
  assert.equal(bar.el.querySelector(".reload-text").textContent, "Downloading Packages", "unknown sources: no names to give");
  assert.deepEqual(log.badges, ["spinner"], "the Sources badge spins, as before");
  run.onEach({ key: "a" });
  run.onEach({ key: "b" });
  await run.data();
  assert.deepEqual(log.steps, ["load", "cache"]);
  assert.deepEqual(texts.slice(-2), ["Loading Data", "Building Searcher Cache"]);
  run.end();
  assert.equal(bar.hidden, true);
  assert.equal(doc.body.children.length <= 1, true);
}));

test("F150: Cancel stops the run at once: the wait ends, the backend's signal aborts, late answers change nothing", () => withPage(async () => {
  const doc = fakeDoc();
  const log = { badges: [], bars: [], steps: [] };
  const run = startRun(fakeCtx(doc, log), ["a", "b"]);
  let finish;
  const never = new Promise((r) => { finish = r; });
  const waiting = run.until(never);
  cancelButton(log.bars[0].el).click();
  assert.equal(await waiting, true, "cancelled before the refresh ended");
  assert.equal(run.cancelled, true);
  assert.equal(run.signal.aborted, true);
  assert.equal(log.bars[0].hidden, true);
  assert.equal(log.badges.at(-1), null, "the spinning badge goes");
  const badges = log.badges.length;
  run.onEach({ key: "a" });             // a fetch already under way answers after Cancel
  await run.data();
  finish();
  assert.equal(log.badges.length, badges);
  assert.deepEqual(log.steps, [], "no Loading Data after Cancel");
}));

test("F150: a run where ctx has no reload bar works as before (no bar, the badge still spins)", () => withPage(async () => {
  const badges = [];
  const run = startRun({ setBadge: (t, v) => badges.push(v) }, ["a"]);
  run.onEach({ key: "a" });
  assert.equal(await run.until(Promise.resolve()), false);
  run.end();
  assert.deepEqual(badges, ["spinner", null]);
}));
