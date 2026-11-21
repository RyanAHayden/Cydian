#!/usr/bin/env node
// Browser smoke test: web/app in headless Chromium, driven like a finger. Not part of tools/check.sh (it needs
// Chromium; a run takes about 10 seconds); run it by hand after touching navigation, slides or overlays.
//
//   node tools/smoke/smoke.mjs [web/app dir] [--site] [--shots DIR] [--keep]
//
// It serves the directory on 127.0.0.1 (a random port), opens it as the jailbreak app (a fake `ifizboxNative`
// whose every call answers null; --site opens it as the website instead) at 390x844 with an iPhone user agent, and:
//   1. push: taps Home's Settings row, then a Settings row, and checks a push slide ran (.page.is-moving);
//   2. pop: taps the nav bar's Back and checks the route came back, with a slide;
//   3. swipe back: pushes again and drags a finger (CDP touch events) from the left edge, and checks the route came
//      back (the edge strip is off on the website, so --site skips this one);
//   4. sheet: opens one through the sheet scaffold (nav/sheet.js showSheet: every sheet in the app is built on it;
//      none opens from the fake bridge's empty state without data) and closes it with its Done button;
//   5. gallery: opens the screenshots gallery (screens/altstore.js previewSlot) above a group of rows and samples
//      every frame: the rows below must never overlap the gallery's visible part and must move with its edge;
//   6. skeleton: swaps a loading skeleton for content, at rest and with the page marked as mid-push: no fading
//      copy of the skeleton, and no fade at all mid-push;
// and through all of it records every animation that runs: `transitionrun` and `animationstart` events, and every
// Web Animation (CSS ones included) caught by polling document.getAnimations() each frame and by wrapping
// Element.animate. It fails if any of them animates a layout property (height, width, top/left, margins,
// padding, ...): 120 Hz means transform and opacity only (AGENTS.md, docs/native.md). Page errors fail it too.
// Taps are real CDP mouse events at the element's centre: the tap guard ignores el.click().
// Exit 0 on pass, 1 on a failed check, 2 when it couldn't run (no Chromium).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; args.splice(i, 1); return true; };
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const SITE = flag("--site");
const KEEP = flag("--keep");
const SHOTS = opt("--shots");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args[0] ?? join(here, "../../web/app"));
const CHROME = process.env.CHROMIUM ?? "chromium";

// Animated properties that make the browser lay out again every frame.
const LAYOUT = /^(height|width|(min|max)-(height|width)|top|right|bottom|left|inset(-.*)?|margin(-.*)?|padding(-.*)?|flex(-basis|-grow|-shrink)?|grid(-.*)?|gap|row-gap|column-gap|font-size|line-height|letter-spacing|word-spacing|border(-(top|right|bottom|left))?-width|border-width|block-size|inline-size|(min|max)-(block|inline)-size|all)$/;
export const isLayoutProperty = (p) => LAYOUT.test(p);

// --- static server ---------------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; } // the site's Worker isn't here
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --- Chromium over CDP ---------------------------------------------------------------------------------------------
const prof = await mkdtemp(join(tmpdir(), "ifizbox-smoke-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
let chromeFailed = null;
chrome.on("error", (e) => { chromeFailed = e; });
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bail = async (code, msg) => { console.error(msg); await cleanup(); process.exit(code); };

let ws;
for (let i = 0; i < 75 && !ws && !chromeFailed; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
if (!ws) await bail(2, `smoke: couldn't start ${CHROME}${chromeFailed ? `: ${chromeFailed.message}` : ""} (set CHROMIUM=<path>)`);

let nextId = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n  ${expr}`);
  return r.result?.result?.value;
};

// Runs before any page script: the animation recorder, and the fake bridge for the app.
const RECORDER = `(() => {
  const rec = window.__smoke = { anims: [], moves: 0, seen: new WeakSet() };
  const name = (el) => el && el.nodeType === 1 ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "") : String(el);
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const SKIP = new Set(["offset", "easing", "composite", "computedOffset"]);
  const note = (kind, target, props, extra) => rec.anims.push({ kind, target: name(target), props, extra, at: Math.round(performance.now()) });
  const fromAnim = (a, kind) => {
    if (rec.seen.has(a)) return; rec.seen.add(a);
    let props = [];
    try { props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !SKIP.has(x)).map(kebab)))]; } catch {}
    if (a.transitionProperty) props.push(a.transitionProperty);
    note(kind || a.constructor.name, a.effect && a.effect.target, [...new Set(props)], a.animationName || a.transitionProperty || "");
  };
  document.addEventListener("transitionrun", (e) => note("transitionrun", e.target, [e.propertyName]), true);
  document.addEventListener("animationstart", (e) => { note("animationstart", e.target, [], e.animationName); for (const a of e.target.getAnimations()) fromAnim(a); }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...a) { const r = animate.apply(this, a); fromAnim(r, "animate"); return r; };
  const poll = () => { try { for (const a of document.getAnimations()) fromAnim(a); } catch {} if (document.querySelector(".page.is-moving")) rec.moves++; requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
})();`;
const BRIDGE = `window.ifizboxNative = { jailbreak: "rootless", call: async () => null };`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER + (SITE ? `try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}` : BRIDGE) });
await send("Page.navigate", { url: base + "#/home" });

const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const settle = () => until("!document.querySelector('.page.is-moving, .sheet.is-moving') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)", 4000);
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return ok; };
const shot = async (n) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(SHOTS, n + ".png"), Buffer.from(r.result.data, "base64"));
};
const hash = () => ev("location.hash");
// The centre of the last visible element matching css (and holding text), scrolled into view; null if none.
const find = (css, text = "") => ev(`(() => {
  const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.offsetParent && x.getClientRects().length && x.textContent.includes(${JSON.stringify(text)})
    && !x.closest('.page:not(.is-top), [hidden], [aria-hidden=true]')).at(-1);
  if (!e) return null;
  e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
const tap = async (css, text = "") => {
  const at = await find(css, text);
  if (!at) return false;
  await sleep(150);
  await mouse("mouseMoved", at[0], at[1], 0);
  await mouse("mousePressed", at[0], at[1]);
  await sleep(60);
  await mouse("mouseReleased", at[0], at[1], 0);
  return true;
};
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
const swipeBack = async () => { // a finger from the left edge to two thirds across, over ~300 ms
  const y = 420;
  await touch("touchStart", 4, y);
  for (let x = 10; x <= 280; x += 15) { await sleep(16); await touch("touchMove", x, y); }
  await sleep(16);
  await touch("touchEnd", 280, y);
};
const resetMoves = () => ev("window.__smoke.moves = 0");
const moved = () => ev("window.__smoke.moves");

try {
  check(await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000), "the app draws Home");
  await sleep(1500);
  await shot("1-home");

  // 1. push
  const settingsRow = ["a, .cell, li, button", "Settings"];
  await resetMoves();
  check(await tap(...settingsRow), "Home shows a Settings row");
  await until("location.hash.includes('settings')", 3000);
  await settle();
  check((await hash()).includes("settings"), `push to Settings (route ${await hash()})`);
  check(await moved() > 0, "the push slid");
  await shot("2-settings");
  const settingsHash = await hash();

  const pushOne = async () => { // Settings' first row that opens a page
    await resetMoves();
    const ok = await tap(".page.is-top a.cell[href*='settings/'], .page.is-top .cell.chevron, .page.is-top a[href*='settings/']");
    await until(`location.hash !== ${JSON.stringify(settingsHash)}`, 3000);
    // The hash changes before the slide starts (a route whose modules aren't loaded yet shows once they are), so
    // settle() alone can pass before the push even began: wait for the slide to run, then for it to end.
    await until("window.__smoke.moves > 0", 3000);
    await settle();
    return ok && (await hash()) !== settingsHash;
  };
  // The edge strip takes a touch only with no slide running and something to go back to (app.js canStart,
  // updateEdge): wait until it is the live element under the finger's start, with nothing moving, for two frames.
  const EDGE_LIVE = `!document.documentElement.classList.contains("nav-moving") && !document.querySelector(".page.is-moving, .nav-item.is-moving")
    && document.elementFromPoint(4, 420)?.matches(".edge-swipe:not(.off)")`;
  const edgeLive = async () => (await until(EDGE_LIVE, 4000))
    && ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(${EDGE_LIVE}))))`);
  check(await pushOne(), `push a Settings page (route ${await hash()})`);
  check(await moved() > 0, "that push slid");
  await shot("3-pushed");

  // 2. pop with Back
  await resetMoves();
  check(await tap(".nav-item.is-top .back, .navbar .back"), "the nav bar shows Back");
  await until(`location.hash === ${JSON.stringify(settingsHash)}`, 3000);
  await settle();
  check((await hash()) === settingsHash, `Back pops (route ${await hash()})`);
  check(await moved() > 0, "the pop slid");

  // 3. swipe back (the app only: the website leaves Back to the browser's own gesture)
  if (!SITE) {
    check(await pushOne(), "push again");
    check(await edgeLive(), "the edge strip is live once the push is at rest");
    await resetMoves();
    await swipeBack();
    await until(`location.hash === ${JSON.stringify(settingsHash)}`, 3000);
    await settle();
    if (!check((await hash()) === settingsHash, `swipe back pops (route ${await hash()})`)) {
      console.log(`  at the edge: ${await ev("(() => { const e = document.elementFromPoint(4, 420); return e ? e.tagName + '.' + e.className : 'nothing'; })()")}`);
    }
    check(await moved() > 0, "the swipe dragged the page");
    await shot("4-swiped");
  }

  // 4. a sheet
  const before = await ev("document.querySelectorAll('.sheet').length");
  await ev(`import("./nav/sheet.js").then(({ showSheet }) => { const b = document.createElement("div"); b.className = "smoke-body"; b.textContent = "smoke"; window.__smokeClose = showSheet({ title: "Smoke", body: b }); })`);
  await sleep(100);
  await settle();
  check(await ev("document.querySelectorAll('.sheet').length") > before, "a sheet opens");
  await shot("5-sheet");
  check(await tap(".sheet .sheet-right button, .sheet .sheet-right a, .sheet .sheet-right *", "Done"), "the sheet shows Done");
  await until(`document.querySelectorAll('.sheet').length === ${before}`, 3000);
  check(await ev("document.querySelectorAll('.sheet').length") === before, "Done closes the sheet");
  await settle();

  // 5. B195: the screenshots gallery opening on a page (screens/altstore.js previewSlot, as an app or package page
  // draws it, with a group of rows under it). Every frame, the gallery's visible bottom (its pictures, cut by the
  // slot's clip) must not reach past the top of the rows below, and those rows must move with it. With --shots the
  // animations run at a tenth of their speed and the step is shot every 150 ms (6-gallery-NN.png), to look at by eye.
  const SLOW = SHOTS ? 10 : 1;
  if (SHOTS) await send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
  const galleryRun = ev(`(async () => {
    const body = document.querySelector(".page.is-top .page-body");
    if (!body) return { error: "no page body" };
    const { previewSlot } = await import("./screens/altstore.js");
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1300"><rect width="600" height="1300" fill="#c33"/></svg>');
    const shots = [0, 1].map(() => ({ url: "data:image/svg+xml," + svg, width: 600, height: 1300 }));
    const below = document.createElement("ul");
    below.className = "table grouped smoke-below";
    for (const t of ["Rating", "Works On", "Size"]) { const li = document.createElement("li"); li.className = "cell"; li.textContent = t; below.append(li); }
    // The page first, with the slot's loading strip (as an app page opens while it waits for the App Store's
    // screenshots); the pictures come once its own slides are done.
    let give;
    const slot = previewSlot("smoke", new Promise((r) => { give = r; }), { settleMs: 50 });
    body.scrollTop = 0;
    body.prepend(slot, below);
    await new Promise((r) => setTimeout(r, ${600 * SLOW}));
    give({ shots });
    const frames = [];
    const sample = () => {
      const s = slot.getBoundingClientRect();
      const clip = getComputedStyle(slot).overflowY !== "visible" ? s.bottom : Infinity;
      const content = Math.max(s.top, ...[...slot.querySelectorAll(".alt-shot, .shots-group, .shots-loading")].map((e) => e.getBoundingClientRect().bottom));
      frames.push({ visible: Math.min(clip, content), next: below.getBoundingClientRect().top, open: Boolean(slot.querySelector(".alt-shot")) });
    };
    const t0 = performance.now();
    await new Promise((done) => { const tick = () => { sample(); if (performance.now() - t0 < ${2500 * SLOW}) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    const res = await slot.gallery;
    slot.remove(); below.remove();
    return { frames, shown: res.shown };
  })()`);
  if (SHOTS) {
    await sleep(600 * SLOW);
    const end = Date.now() + 2500 * SLOW * 0.9;
    for (let n = 0; Date.now() < end && n < 40; n++) { await shot(`6-gallery-${String(n).padStart(2, "0")}`); await sleep(150); }
  }
  const gallery = await galleryRun;
  if (SHOTS) await send("Animation.setPlaybackRate", { playbackRate: 1 });
  if (check(!gallery.error && gallery.shown > 0, `the gallery opened${gallery.error ? ": " + gallery.error : ""}`)) {
    const f = gallery.frames;
    const end = f.at(-1);
    const gap = end.next - end.visible; // the rows' place under the gallery at rest
    const over = f.filter((x) => x.visible > x.next + 1);
    const moving = f.filter((x) => x.open && Math.abs(x.next - end.next) > 1);
    const drift = Math.max(0, ...moving.map((x) => Math.abs(x.next - x.visible - gap)));
    check(over.length === 0, `the rows below never overlap the gallery (${over.length} of ${f.length} frames${over.length ? `, worst ${Math.max(...over.map((x) => x.visible - x.next)).toFixed(1)}px` : ""})`);
    check(moving.length >= 3, `the rows below slid down as it opened (${moving.length} moving frames)`);
    check(drift <= 2, `the rows moved with the gallery's edge (off by at most ${drift.toFixed(1)}px)`);
  }

  // 6. B195: a page's loading skeleton swapped for its content leaves no fading copy of itself, and a page still in
  // its push slide (.page.is-moving, set here by hand on the top page) fades nothing in either.
  const skeleton = await ev(`(async () => {
    const page = document.querySelector(".page.is-top");
    const body = page?.querySelector(".page-body");
    if (!body) return { error: "no page body" };
    const { placeholder } = await import("./nav/ui.js");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const content = () => { const u = document.createElement("ul"); u.className = "table grouped smoke-content"; u.innerHTML = "<li class=cell>Loaded</li>"; return u; };
    const swap = async (moving) => {
      const ph = placeholder("page");
      body.prepend(ph);
      await wait(${500 * (SHOTS ? 10 : 1)});
      page.classList.toggle("is-moving", moving);
      const u = content();
      ph.replaceWith(u);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const ghosts = [...body.querySelectorAll("[data-slide-ghost]")].filter((g) => g.querySelector(".ph")).length;
      const fading = u.getAnimations().filter((a) => a.playState === "running").length;
      page.classList.toggle("is-moving", false);
      u.remove();
      return { ghosts, fading };
    };
    return { rest: await swap(false), push: await swap(true) };
  })()`);
  if (check(!skeleton.error, `a skeleton swap ran${skeleton.error ? ": " + skeleton.error : ""}`)) {
    check(skeleton.rest.ghosts === 0 && skeleton.push.ghosts === 0, "a skeleton leaves no fading copy over the content");
    check(skeleton.push.fading === 0 && skeleton.rest.fading === 0, "the content takes the skeleton's place at once (no fade, no blank blink)");
  }

  // 7. B271: a page's long description (screens/description.js) opened with More, tapped as a finger would: the page
  // keeps its scroll position every frame, the rows below slide down, and the text's visible bottom (its clip) never
  // reaches past the Less row's top. Then Less folds it and scrolls back to the description, as before.
  const descSetup = await ev(`(async () => {
    const body = document.querySelector(".page.is-top .page-body");
    if (!body) return { error: "no page body" };
    const { descriptionGroup } = await import("./screens/description.js");
    const text = ["A long description.", "", ...Array.from({ length: 30 }, (_, i) => "Line " + i + " of a text long enough to fold behind More")].join("\\n");
    const wrap = document.createElement("div");
    wrap.className = "smoke-desc";
    const spacer = document.createElement("div");
    spacer.style.height = "600px";
    const below = document.createElement("ul");
    below.className = "table grouped smoke-desc-below";
    for (const t of ["Version", "Size", "Section"]) { const li = document.createElement("li"); li.className = "cell"; li.textContent = t; below.append(li); }
    const tail = document.createElement("div");
    tail.style.height = "1200px";
    wrap.append(spacer, descriptionGroup(text), below, tail);
    body.append(wrap);
    await new Promise((r) => setTimeout(r, 400)); // its layout check (rAF) and slide.js's first measure
    const more = wrap.querySelector(".desc-more");
    if (!more) return { error: "no More row" };
    body.scrollTop = wrap.offsetTop + 450; // the description in mid-screen, scrolled to
    await new Promise((r) => requestAnimationFrame(r));
    const r = more.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scroll: body.scrollTop };
  })()`);
  if (check(!descSetup.error, `a long description drew with More${descSetup.error ? ": " + descSetup.error : ""}`)) {
    const sampling = ev(`(async () => {
      const body = document.querySelector(".page.is-top .page-body");
      const wrap = body.querySelector(".smoke-desc");
      const box = wrap.querySelector(".desc-text");
      const frames = [];
      const t0 = performance.now();
      await new Promise((done) => { const tick = () => {
        const row = wrap.querySelector(".desc-more");
        const b = box.getBoundingClientRect();
        const cut = (e) => +(/inset\\(\\S+ \\S+ ([\\d.]+)px/.exec(getComputedStyle(e).clipPath)?.[1] ?? 0);
        const table = box.closest(".table");
        frames.push({ scroll: body.scrollTop, visible: b.bottom - cut(box), next: row.getBoundingClientRect().top,
          rowEnd: row.getBoundingClientRect().bottom, tableEnd: table.getBoundingClientRect().bottom - cut(table),
          below: wrap.querySelector(".smoke-desc-below").getBoundingClientRect().top, open: !box.classList.contains("collapsed") });
        if (performance.now() - t0 < ${1500 * SLOW}) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
      return frames;
    })()`);
    if (SHOTS) await send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
    await sleep(100);
    await mouse("mouseMoved", descSetup.x, descSetup.y, 0);
    await mouse("mousePressed", descSetup.x, descSetup.y);
    await sleep(60);
    await mouse("mouseReleased", descSetup.x, descSetup.y, 0);
    if (SHOTS) for (let n = 0; n < 12; n++) { await shot(`7-desc-${String(n).padStart(2, "0")}`); await sleep(150 * SLOW / 4); }
    const f = (await sampling).filter((x) => x.open);
    if (SHOTS) await send("Animation.setPlaybackRate", { playbackRate: 1 });
    if (check(f.length > 0, "More opened the description")) {
      const end = f.at(-1);
      const gap = end.next - end.visible;
      const jumped = f.filter((x) => Math.abs(x.scroll - descSetup.scroll) > 0.5);
      check(jumped.length === 0, `More kept the scroll position (${descSetup.scroll}px${jumped.length ? `, moved to ${jumped[0].scroll}px` : ""})`);
      const over = f.filter((x) => x.visible > x.next + 1);
      check(over.length === 0, `the text never shows under its Less row while it opens (${over.length} of ${f.length} frames)`);
      const moving = f.filter((x) => Math.abs(x.below - end.below) > 1);
      check(moving.length >= 3, `the rows below slid down as it opened (${moving.length} moving frames)`);
      const drift = Math.max(0, ...f.map((x) => Math.abs(x.next - x.visible - gap)));
      check(drift <= 2, `the text's edge moved with its Less row (off by at most ${drift.toFixed(1)}px)`);
      const edge = end.tableEnd - end.rowEnd;
      const tdrift = Math.max(0, ...f.map((x) => Math.abs(x.tableEnd - x.rowEnd - edge)));
      check(tdrift <= 2, `the group's bottom edge moved with its Less row (off by at most ${tdrift.toFixed(1)}px)`);
    }
    await settle();
    const less = await ev(`(async () => { const body = document.querySelector(".page.is-top .page-body");
      const row = document.querySelector(".smoke-desc .desc-more");
      body.scrollTop += row.getBoundingClientRect().top - body.clientHeight / 2; // the Less row in mid-screen
      await new Promise((r) => requestAnimationFrame(r));
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, scroll: body.scrollTop }; })()`);
    await mouse("mouseMoved", less.x, less.y, 0);
    await mouse("mousePressed", less.x, less.y);
    await sleep(60);
    await mouse("mouseReleased", less.x, less.y, 0);
    await sleep(100);
    await settle();
    const after = await ev(`(() => { const r = document.querySelector(".smoke-desc .desc-more").getBoundingClientRect();
      return { y: r.y + r.height / 2, scroll: document.querySelector(".page.is-top .page-body").scrollTop,
        folded: document.querySelector(".smoke-desc .desc-text").classList.contains("collapsed") }; })()`);
    check(after.folded && after.scroll < less.scroll && Math.abs(after.y - less.y) <= 2,
      `Less folded it and scrolled back to the description (scroll ${less.scroll} -> ${after.scroll}px, row ${Math.round(less.y)} -> ${Math.round(after.y)})`);
    await settle();
    await ev(`document.querySelector(".smoke-desc")?.remove()`);
  }

  // the verdict
  const anims = await ev("window.__smoke.anims");
  const bad = anims.filter((a) => a.props.some(isLayoutProperty));
  console.log(`${anims.length} animations recorded`);
  if (KEEP) for (const a of anims) console.log(`  ${a.kind} ${a.target} [${a.props.join(", ")}] ${a.extra ?? ""}`);
  for (const a of bad) console.log(`  layout: ${a.kind} on ${a.target}: ${a.props.filter(isLayoutProperty).join(", ")}`);
  check(anims.length > 0, "animations were seen at all (the recorder works)");
  check(bad.length === 0, "no layout property animated (transform and opacity only)");
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ").slice(0, 600) : ""}`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
}
ws.close();
await cleanup();
console.log(failures.length ? `smoke: ${failures.length} failed` : "smoke: passed");
process.exit(failures.length ? 1 : 0);
