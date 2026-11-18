// Tweak Roulette (F154; concept: docs/concepts/browse/roulette.dc.html): iOS 6's picker with three wheels (type,
// vibe, price) that spin and come to rest on a real free package from the user's sources, then a card with Wish
// List (core/wishlist.js) and View (the package's page). No daily limit (user 2026-11-18: "don't limit the
// spins"): Spin always works. A day streak counts the days in a row with at least one spin, kept on the device
// beside the settings (localStorage["cydian.roulette"]). The apps builds spin app categories (core/catalog.js
// ROULETTE_TYPES). A haptic tick as rows pass the band, where the native bridge has haptics.
//
// Route: home browse/roulette (screens/home.js); the package below it is browse.js's (browse/roulette/package:<id>).
// Wheels move by transform only (docs/native.md: 120 Hz).
import { grouped, el } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog } from "../catalog.js";
import { haptic } from "../nav/haptic.js";
import { ROULETTE_TYPES, ROULETTE_VIBES, ROULETTE_PRICES, spinPick, dayKey, dayBefore } from "../core/catalog.js";
import { wishlist, iconBox, rememberNames, token } from "./browse.js";

export const ROULETTE_KEY = "cydian.roulette";
const ROW = 40;        // a wheel row's height (px)
const CENTER = 80;     // the band's top inside a wheel: the third of five rows
const COPIES = 14;     // each wheel's list repeated, so a spin of several turns never runs off the end
const TURNS = [3, 4, 5]; // whole turns per wheel: the right one stops last
const SECONDS = [1.6, 1.9, 2.2];

// ---- the streak (pure) -------------------------------------------------------------------------------------

// { last: "2026-11-18" | null, streak, best, spins } from storage; a fresh record when there is none or it's broken.
export function readSpins(storage = globalThis.localStorage) {
  const empty = { last: null, streak: 0, best: 0, spins: 0 };
  try {
    const v = JSON.parse(storage?.getItem(ROULETTE_KEY) ?? "null");
    if (!v || typeof v !== "object") return empty;
    const n = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    return { last: /^\d{4}-\d{2}-\d{2}$/.test(v.last) ? v.last : null, streak: n(v.streak), best: n(v.best), spins: n(v.spins) };
  } catch {
    return empty;
  }
}

export function saveSpins(state, storage = globalThis.localStorage) {
  try { storage?.setItem(ROULETTE_KEY, JSON.stringify(state)); } catch { /* private mode or full: this session only */ }
  return state;
}

// A spin on `today`: the first one of a day adds a day to the streak when yesterday had one, else starts it at 1;
// more spins the same day only count as spins.
export function recordSpin(state, today = dayKey()) {
  const s = { last: null, streak: 0, best: 0, spins: 0, ...state };
  const streak = s.last === today ? s.streak : s.last === dayBefore(today) ? s.streak + 1 : 1;
  return { last: today, streak, best: Math.max(s.best, streak), spins: s.spins + 1 };
}

// The streak as it stands on `today`: kept while the last spin was today or yesterday (today's spin can still
// carry it on), 0 once a day was missed.
export function currentStreak(state, today = dayKey()) {
  if (!state?.last) return 0;
  return state.last === today || state.last === dayBefore(today) ? state.streak : 0;
}

export const ROULETTE_SUBTITLE = "Spin for something new";
export const rouletteTitle = (jailbroken = true) => (jailbroken ? "Tweak Roulette" : "App Roulette");

// Browse's row for it (nav/ui.js grouped section): the subtitle and, once there is one, the day streak.
export function rouletteRow({ jailbroken = true, streak = 0, href = format({ tab: "home", path: ["browse", "roulette"] }) } = {}) {
  return { rows: [{ label: rouletteTitle(jailbroken), subtitle: ROULETTE_SUBTITLE + (streak > 0 ? ` · ${streak}-day streak` : ""),
    href, icon: { src: "icons/roulette.svg" }, cls: "browse-icon-row" }] };
}

// Where a wheel at absolute row `pos` lands for `target` (an index in its list of `len`): `turns` whole turns on.
export function nextPos(pos, len, target, turns) {
  return pos - (pos % len) + len * turns + target;
}

// ---- the page ----------------------------------------------------------------------------------------------

export const nav = () => ({ title: "Roulette" });

// Haptics only where the app's bridge plays them (nav/haptic.js "haptic.tap"); Safari's fallbacks need a gesture.
const hasHaptics = () => Boolean(globalThis.cydianApp && globalThis.webkit?.messageHandlers?.cydian);

export function render(body, route, { jailbroken = true, storage = globalThis.localStorage } = {}) {
  body.classList.add("roulette-page");
  const types = ROULETTE_TYPES[jailbroken ? "jailbreak" : "apps"];
  const lists = [types.map((t) => ({ label: t.label, icon: `icons/sections/${t.icon}.png` })),
    ROULETTE_VIBES.map((label) => ({ label })), ROULETTE_PRICES.map((label) => ({ label }))];

  const stats = el("div", "roulette-stats");
  const streakNum = el("b", null, "0");
  const bestNum = el("b", null, "0");
  const stat = (num, label) => { const s = el("div", "roulette-stat"); s.append(num, el("span", null, label)); return s; };
  stats.append(stat(streakNum, "day streak"), stat(bestNum, "best streak"));
  const paintStats = () => {
    const s = readSpins(storage);
    streakNum.textContent = String(currentStreak(s));
    bestNum.textContent = String(s.best);
  };
  paintStats();

  const picker = el("div", "roulette-picker");
  picker.setAttribute("role", "img");
  picker.setAttribute("aria-label", "Roulette wheels");
  const wheels = lists.map((list, w) => {
    const wheel = el("div", `roulette-wheel w${w}`);
    const reel = el("div", "roulette-reel");
    fillReel(reel, list);
    wheel.append(reel);
    picker.append(wheel);
    return { reel, len: list.length, pos: list.length + Math.floor(Math.random() * list.length) };
  });
  picker.append(el("div", "roulette-band"));
  for (const wh of wheels) place(wh, false);

  const spin = el("button", "roulette-spin", "Spin");
  spin.type = "button";
  const result = el("div", "roulette-result");
  result.append(grouped([{ footer: "Each spin lands on a real free package from your sources. Spin once a day and your streak grows." }]));
  body.append(stats, picker, spin, result);

  let pool = null;
  const loadPool = () => (pool ??= catalog.ensure().then(() => catalog.roulette()).catch(() => []));
  // The worker knows the device for sure: where its types aren't the ones drawn, the type wheel takes the pool's.
  loadPool().then((p) => {
    if (!p.length || p.map((t) => t.label).join() === lists[0].map((t) => t.label).join()) return;
    lists[0] = p.map((t) => ({ label: t.label, icon: `icons/sections/${t.icon}.png` }));
    fillReel(wheels[0].reel, lists[0]);
    wheels[0].len = lists[0].length;
    wheels[0].pos = wheels[0].len;
    place(wheels[0], false);
  });
  let spinning = false;

  spin.addEventListener("click", async () => {
    if (spinning) return;
    spinning = true;
    spin.disabled = true;
    spin.textContent = "Spinning…";
    const p = await loadPool();
    const pick = spinPick(p);
    if (!pick) {
      spinning = false;
      spin.disabled = false;
      spin.textContent = "Spin";
      result.replaceChildren(grouped([{ footer: jailbroken ? "No free tweaks or themes in your sources yet. Add a source, then spin." : "No free apps in your sources yet. Add a source, then spin." }]));
      return;
    }
    saveSpins(recordSpin(readSpins(storage)), storage);
    paintStats();
    result.replaceChildren();
    // The type wheel rests on the pool's type by name (the pool comes from the worker, which knows the device).
    const type = Math.max(0, lists[0].findIndex((t) => t.label === p[pick.type].label));
    const targets = [type, Math.floor(Math.random() * ROULETTE_VIBES.length), freeSlot()];
    wheels.forEach((wh, w) => { wh.pos = nextPos(wh.pos, wh.len, targets[w], TURNS[w]); place(wh, SECONDS[w]); });
    const stopTicks = hasHaptics() ? ticking(wheels) : () => {};
    await new Promise((r) => setTimeout(r, SECONDS[2] * 1000 + 80));
    stopTicks();
    for (const wh of wheels) { wh.pos = wh.len + (wh.pos % wh.len); place(wh, false); } // back to the second copy, unseen
    spinning = false;
    spin.disabled = false;
    spin.textContent = "Spin";
    if (body.isConnected) result.replaceChildren(resultCard(pick.row, route));
  });
  return { spin, wheels };
}

// A wheel's rows: its list `COPIES` times over.
function fillReel(reel, list) {
  reel.replaceChildren();
  for (let c = 0; c < COPIES; c++) {
    for (const item of list) {
      const slot = el("div", "roulette-slot");
      if (item.icon) { const img = el("img"); img.alt = ""; img.src = item.icon; slot.append(img); }
      slot.append(el("span", null, item.label));
      reel.append(slot);
    }
  }
}

// A "Free" row on the price wheel, picked at random.
function freeSlot() {
  const free = ROULETTE_PRICES.map((p, i) => [p, i]).filter(([p]) => p === "Free");
  return free[Math.floor(Math.random() * free.length)][1];
}

function place(wh, seconds) {
  wh.reel.style.transition = seconds ? `transform ${seconds}s cubic-bezier(.15,.7,.2,1)` : "none";
  wh.reel.style.transform = `translate3d(0, ${CENTER - wh.pos * ROW}px, 0)`;
  if (!seconds) void wh.reel.offsetHeight; // the jump back lands before the next spin's transition starts
}

// While the wheels turn: a tick each time any wheel brings a new row under the band (at most one per frame).
function ticking(wheels) {
  const last = wheels.map(() => null);
  let frame = 0;
  const step = () => {
    let moved = false;
    wheels.forEach((wh, w) => {
      const m = /matrix(?:3d)?\(([^)]+)\)/.exec(getComputedStyle(wh.reel).transform);
      if (!m) return;
      const v = m[1].split(",").map(Number);
      const y = v.length === 16 ? v[13] : v[5];
      const row = Math.round((CENTER - y) / ROW);
      if (last[w] !== null && row !== last[w]) moved = true;
      last[w] = row;
    });
    if (moved) haptic();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

// "You landed on": the package, then Wish List and View.
function resultCard(row, route) {
  rememberNames([row]);
  const g = el("div", "group roulette-landed");
  g.append(el("h2", "group-header", "You landed on"));
  const ul = el("ul", "table grouped");
  const top = el("li", "cell");
  const inner = el("div", "cell-inner roulette-pick");
  const words = el("span", "cell-text");
  words.append(el("span", "cell-label", row.name), el("span", "roulette-desc", row.short || row.section || ""));
  inner.append(iconBox(row, "roulette-icon"), words);
  top.append(inner);
  const actions = el("li", "cell");
  const bar = el("div", "cell-inner roulette-actions");
  const wish = el("button", "roulette-pill grey");
  wish.type = "button";
  const paintWish = () => {
    const on = wishlist().has(row.id);
    wish.textContent = on ? "On Wish List" : "Wish List";
    wish.setAttribute("aria-pressed", String(on));
  };
  paintWish();
  wish.addEventListener("click", () => { wishlist().set(row.id, !wishlist().has(row.id)); paintWish(); });
  const view = el("a", "roulette-pill", "View");
  view.href = format({ tab: route.tab, path: [...route.path, token("package", row.id)] });
  bar.append(wish, view);
  actions.append(bar);
  ul.append(top, actions);
  g.append(ul);
  return g;
}
