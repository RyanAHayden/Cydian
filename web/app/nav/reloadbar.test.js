// F150/F179: Cydia's drop-down reload bar: the few fixed words it shows as a refresh goes on (core/reloadsteps.js), its Cancel
// (nav/reloadbar.js, screens/sources.js startRun) and that nothing it adds blocks the screens underneath.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reloadSteps, STEP_TEXT } from "../core/reloadsteps.js";
import { showReloadBar, phaseOf, PHASES, MIN_STEP_MS } from "./reloadbar.js";
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
// F179: a clock the tests move by hand, so the minimum time per step is checked exactly and fast.
function fakeClock() {
  let t = 1000, seq = 0;
  const timers = new Map();
  const clock = {
    now: () => t,
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { at: t + ms, f }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].f();
      }
      t = end;
    },
  };
  return clock;
}
const cancelButton = (bar) => bar.children.find((k) => k.classList.contains("reload-cancel"));

// ---- the words ----

test("F179: the steps go Updating Sources, Downloading Packages, Loading Data, Building Searcher Cache, never a name", () => {
  const seen = [];
  const s = reloadSteps([{ key: "a", name: "BigBoss" }, { key: "b", name: "Chariz" }, { key: "c" }], { apt: true, onText: (t) => seen.push(t) });
  assert.equal(s.text(), "Updating Sources");
  s.each({ key: "a" });
  s.each({ key: "c" });
  s.each({ key: "b" });
  s.load();
  s.cache();
  assert.deepEqual(seen, ["Updating Sources", "Downloading Packages", "Loading Data", "Building Searcher Cache"]);
  assert.deepEqual(Object.values(STEP_TEXT), ["Updating Sources", "Downloading Packages", "Loading Data", "Building Searcher Cache"]);
});

test("F179: the website and the sideload app say the same words as the jailbreak app", () => {
  const seen = [];
  const s = reloadSteps([{ key: "a", name: "Repo A", uri: "https://a.example/" }, { key: "b", name: "Repo B" }], { onText: (t) => seen.push(t) });
  s.each({ key: "a" });
  s.each({ key: "b" });
  assert.deepEqual(seen, ["Updating Sources", "Downloading Packages"]);
  assert.equal(reloadSteps([]).text(), "Downloading Packages", "nothing to update: no update step");
});

// ---- the bar ----

test("F150: the bar drops down with the text, changes it, and slides back up; only transform animates", async () => {
  const doc = fakeDoc();
  const clock = fakeClock();
  const bar = showReloadBar("Updating Sources", { doc, clock });
  const el = bar.el;
  assert.equal(doc.body.children.length, 1, "one element: the strip, and no scrim");
  assert.ok(el.classList.contains("reload-bar"));
  assert.equal(el.attrs.role, "status");
  assert.ok(el.querySelector(".reload-spinner"));
  assert.equal(el.querySelector(".reload-text").textContent, "Updating Sources");
  assert.equal(cancelButton(el).textContent, "Cancel");
  assert.ok(cancelButton(el).classList.contains("done"), "the blue bar button");
  assert.ok(doc.documentElement.classList.contains("has-reload"), "the scrollers get room for the strip");
  clock.advance(MIN_STEP_MS);
  bar.set("Loading Data");
  assert.equal(el.querySelector(".reload-text").textContent, "Loading Data");
  bar.hide();
  clock.advance(MIN_STEP_MS);
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

test("F150/F204: nothing blocks input or moves: a 44 pt strip on the tab bar, no pointer-events trick, no push", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
  const bar = rules.find((r) => r.sel === ".reload-bar");
  assert.ok(bar, ".reload-bar missing");
  assert.doesNotMatch(bar.decl, /inset\s*:\s*0|top\s*:|height\s*:\s*100/, "the strip is only as tall as a bar");
  assert.match(bar.decl, /(^|;)\s*height\s*:\s*44px/);
  assert.match(bar.decl, /bottom\s*:\s*var\(--tab-h\)/, "it sits on top of the tab bar");
  assert.ok(Number(/z-index\s*:\s*(\d+)/.exec(bar.decl)[1]) < 3, "below the tab bar (3), so it slides out from behind it");
  for (const r of rules.filter((x) => /reload/.test(x.sel))) {
    assert.doesNotMatch(r.decl, /pointer-events\s*:\s*none/, r.sel);
    assert.doesNotMatch(r.decl, /transition\s*:(?![^;]*\b(transform|translate|opacity)\b)/, `${r.sel}: transform/opacity only`);  }
  assert.ok(!rules.some((r) => /has-reload[^,{]*(#navbar|#screens|\.sheet)\b/.test(r.sel)), "the nav bar, screens and sheets no longer move");
  const room = rules.find((r) => /^html\.has-reload :is\([^)]*\.page-body[^)]*\.sheet-scroll[^)]*\)::after$/.test(r.sel));
  assert.ok(room, "the scrollers get room at their end while it shows");
  assert.match(room.decl, /height\s*:\s*44px/);
  assert.ok(!rules.some((r) => r.sel === "body:has(.sheet) .reload-bar"), "B154: a modal sheet covers the strip; nothing lifts it over one");
  assert.doesNotMatch(readFileSync(new URL("./reloadbar.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""), /translateY\(-/, "it slides up from behind the tab bar, not down from the top");
  // and the bar's own module makes no scrim (the HUD's .hud-scrim is what used to eat taps)
  assert.doesNotMatch(readFileSync(new URL("./reloadbar.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""), /scrim|inset/);
});

// ---- F179: fixed steps only, each up for the minimum time ----

test("F179: only the four fixed steps reach the strip; names, URLs, counts and per-file text are dropped", () => {
  assert.equal(MIN_STEP_MS >= 500 && MIN_STEP_MS <= 800, true, "about 0.6 s");
  for (const p of PHASES) assert.equal(phaseOf(p), p);
  assert.equal(phaseOf("Downloading BigBoss"), "Downloading Packages");
  assert.equal(phaseOf("Downloading https://repo.chariz.com/Packages.bz2"), "Downloading Packages");
  for (const t of ["BigBoss", "Fetching 3 of 12", "https://apt.example/Release", "Parsing Packages.xz", "", null]) assert.equal(phaseOf(t), null, String(t));

  const doc = fakeDoc();
  const clock = fakeClock();
  const bar = showReloadBar("Downloading Chariz", { doc, clock });
  const label = bar.el.querySelector(".reload-text");
  const seen = [label.textContent];
  const feed = ["Downloading BigBoss", "https://x.example/", "Loading 5 of 9", "Loading Data", "Building Searcher Cache", "Havoc"];
  for (const t of feed) { bar.set(t); clock.advance(100); if (label.textContent !== seen.at(-1)) seen.push(label.textContent); }
  for (let i = 0; i < 20; i++) { clock.advance(100); if (label.textContent !== seen.at(-1)) seen.push(label.textContent); }
  assert.deepEqual(seen, ["Downloading Packages", "Loading Data", "Building Searcher Cache"]);
  for (const t of seen) assert.ok(PHASES.includes(t), t);
  bar.hide();
});

test("F179: each step stays up at least the minimum even when the work is faster, then the bar slides away", () => {
  const doc = fakeDoc();
  const clock = fakeClock();
  const bar = showReloadBar("Updating Sources", { doc, clock });
  const label = bar.el.querySelector(".reload-text");
  const changes = [{ text: label.textContent, at: clock.now() }];
  const look = () => { if (label.textContent !== changes.at(-1).text) changes.push({ text: label.textContent, at: clock.now() }); };
  // the whole refresh is over in 50 ms
  bar.set("Downloading Packages"); clock.advance(10); look();
  bar.set("Loading Data"); clock.advance(10); look();
  bar.set("Building Searcher Cache"); clock.advance(10); look();
  bar.hide();
  assert.equal(bar.hidden, true, "the run is over at once");
  assert.ok(doc.body.children.includes(bar.el), "but the strip stays until its steps have had their time");
  let goneAt = null;
  for (let i = 0; i < 400 && goneAt == null; i++) {
    clock.advance(10); look();
    if (!doc.documentElement.classList.contains("has-reload")) goneAt = clock.now();
  }
  assert.deepEqual(changes.map((c) => c.text), PHASES);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i].at - changes[i - 1].at >= MIN_STEP_MS, `${changes[i - 1].text} up ${changes[i].at - changes[i - 1].at} ms`);
  assert.ok(goneAt - changes.at(-1).at >= MIN_STEP_MS, "the last step too, before the slide");
  assert.ok(goneAt - changes.at(-1).at < MIN_STEP_MS + 50, "and no longer than needed");
  bar.set("Loading Data");
  assert.equal(label.textContent, "Building Searcher Cache", "nothing changes after hide()");
});

test("F179: a slow step changes at once when the next comes; Cancel and a new bar take it away without waiting", () => {
  const doc = fakeDoc();
  const clock = fakeClock();
  let cancelled = 0;
  const bar = showReloadBar("Updating Sources", { doc, clock, onCancel: () => cancelled++ });
  const label = bar.el.querySelector(".reload-text");
  clock.advance(2000);
  bar.set("Downloading Packages");
  assert.equal(label.textContent, "Downloading Packages", "already up long enough: no wait");
  bar.set("Loading Data");
  cancelButton(bar.el).click();
  assert.equal(cancelled, 1);
  assert.ok(!doc.documentElement.classList.contains("has-reload"), "Cancel does not wait for the minimum");
  assert.equal(label.textContent, "Downloading Packages", "and the queued step never shows");

  const one = showReloadBar("Updating Sources", { doc, clock });
  one.hide();                                   // still lingering for its minimum
  const two = showReloadBar("Updating Sources", { doc, clock });
  assert.ok(!doc.body.children.includes(one.el) || one.el.animations.length === 2, "the first slides away now");
  assert.ok(doc.documentElement.classList.contains("has-reload"), "the new bar keeps the scrollers' extra room");
  clock.advance(MIN_STEP_MS * 2);
  assert.ok(doc.documentElement.classList.contains("has-reload"), "the old bar's timer does not take the new one's room");
  two.dismiss();
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
    reloadBar: (text, opts) => { const b = showReloadBar(text, { ...opts, doc, minMs: 0 }); log.bars.push(b); return b; },
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
  assert.equal(bar.el.querySelector(".reload-text").textContent, "Updating Sources");
  assert.deepEqual(log.badges, ["spinner"], "the Sources badge spins, as before");
  run.onEach({ key: "a" });
  run.onEach({ key: "b" });
  await run.data();
  // F233: each source that lands goes into the catalog at once (a load, coalesced), then the run's own last steps
  assert.deepEqual(log.steps.slice(-2), ["load", "cache"]);
  assert.ok(log.steps.filter((s) => s === "load").length >= 2, "a landed source loaded before the run's Loading Data");
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
