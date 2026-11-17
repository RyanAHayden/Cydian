// Entry point: the tab bar, one navigation stack per tab (nav/stack.js), push/pop slides and the edge swipe back.
//
// DOM: #screens holds a .tab-stack per tab, and each holds its stack's .page elements, root first. A page is a
// fixed frame (.page, moved by transforms) around its own scroller (.page-body), so switching tabs or popping
// keeps every screen's scroll position. The nav bar holds a matching .nav-stack of .nav-items per tab. Only the
// top page of the active tab is visible; the one below shows during a slide or swipe.
//
// Screens (screens/*.js) export `title`, `render(body, route, ctx)` and optionally `nav(route, ctx)` returning
// { title, style: "grouped" | "plain", left: { label, onClick }, right: { label, onClick } } and `init(ctx)`,
// run once at start (e.g. to set the tab's badge). ctx: { go, back, setBadge, showHUD }.
import { TABS, createRouter, format, parent } from "./router.js";
import { createStacks, swipeCommits } from "./nav/stack.js";
import { animate, setProgress, clear, DURATION, EASE_OUT } from "./nav/transition.js";
import { attachEdgeSwipe } from "./nav/swipe.js";
import { createTabbar, tapTab } from "./nav/tabbar.js";
import { showHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";
import { initScroller } from "./nav/scroller.js";
import * as home from "./screens/home.js";
import * as sources from "./screens/sources.js";
import * as changes from "./screens/changes.js";
import * as installed from "./screens/installed.js";
import * as search from "./screens/search.js";
import * as settingsScreen from "./screens/settings.js";
import { sourceFilter } from "./core/sources.js";
import { getBackend } from "./backend.js";
import { startPush } from "./push-client.js";
import { launchURL } from "./launch.js";
import { isAddPath, parseAddLink } from "./core/handoff.js";
import { addSource } from "./screens/manage.js";

const SCREENS = { home, sources, changes, installed, search, settings: settingsScreen };

const screensEl = document.getElementById("screens");
const navbarEl = document.getElementById("navbar");
const tabStacks = {};
const navStacks = {};
for (const tab of TABS) {
  tabStacks[tab] = Object.assign(document.createElement("div"), { className: "tab-stack" });
  tabStacks[tab].dataset.tab = tab;
  screensEl.append(tabStacks[tab]);
  navStacks[tab] = Object.assign(document.createElement("div"), { className: "nav-stack" });
  navStacks[tab].dataset.tab = tab;
  navbarEl.append(navStacks[tab]);
}

const tabbar = createTabbar(document.getElementById("tabbar"), TABS, (t) => SCREENS[t].title);
const ctx = {
  go: (route) => router.go(route),
  back: () => goBack(),
  setBadge: (tab, n) => tabbar.setBadge(tab, n),
  showHUD,
  showAlert,
};

const stacks = createStacks({ tabs: TABS, create: makePage });

function button(spec, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = spec.label;
  if (spec.onClick) b.addEventListener("click", spec.onClick);
  return b;
}

// Called by stacks.sync while it builds a stack, root first: the parent is already the stack's last entry.
function makePage(tab, path) {
  const route = { tab, path };
  const screen = SCREENS[tab];
  const info = (screen.nav && screen.nav(route, ctx)) || {};
  const below = stacks.stack(tab).at(-1);
  const title = info.title ?? screen.title;

  const page = document.createElement("section");
  page.className = "page";
  const body = document.createElement("div");
  body.className = "page-body " + (info.style === "plain" ? "plain" : "grouped");
  const shade = document.createElement("div");
  shade.className = "page-shade";
  page.append(body, shade);
  tabStacks[tab].append(page);

  const item = document.createElement("div");
  item.className = "nav-item";
  const left = document.createElement("div");
  left.className = "nav-left";
  if (below) {
    const back = button({ label: below.page.title, onClick: () => goBack() }, "bar-button back");
    back.setAttribute("aria-label", "Back to " + below.page.title);
    left.append(back);
  } else if (info.left) left.append(button(info.left, "bar-button"));
  const h1 = document.createElement("h1");
  h1.className = "nav-title";
  h1.textContent = title;
  const right = document.createElement("div");
  right.className = "nav-right";
  if (info.right) right.append(button(info.right, "bar-button"));
  item.append(left, h1, right);
  navStacks[tab].append(item);

  screen.render(body, route, ctx);
  return { el: page, body, shade, item, title };
}

const pairOf = (top, below) => ({
  top: { page: top.page.el, shade: top.page.shade, item: top.page.item },
  below: { page: below.page.el, shade: below.page.shade, item: below.page.item },
});

function setTop(entry, on) {
  entry.page.el.classList.toggle("is-top", on);
  entry.page.item.classList.toggle("is-top", on);
}
// block: no taps while a slide runs. Not during the swipe: the finger's own pointer stream must keep coming.
function setMoving(pair, on, block = on) {
  for (const who of ["top", "below"]) {
    pair[who].page.classList.toggle("is-moving", on);
    pair[who].item.classList.toggle("is-moving", on);
  }
  document.documentElement.classList.toggle("nav-moving", block);
}
// Popped pages are already hidden; taking them out of the DOM costs a layout, so it waits until the screen is
// still (the next idle moment, at most 500 ms) instead of landing on the slide's last frame.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
function drop(entries) {
  if (!entries.length) return;
  for (const e of entries) setTop(e, false);
  idle(() => { for (const e of entries) { e.page.el.remove(); e.page.item.remove(); } }, { timeout: 500 });
}

let running = null;      // the slide in progress: { finish() }
let swipedBack = false;  // the swipe already slid the pop; the route change that follows only cleans up

function slide(top, below, p0, p1, cleanup, opts) {
  const pair = pairOf(top, below);
  setMoving(pair, true);
  setProgress(pair, p0);
  running = animate(pair, p0, p1, {
    ...opts,
    onEnd() {
      running = null;
      setMoving(pair, false);
      clear(pair);
      cleanup();
    },
  });
}

const router = createRouter({
  win: window,
  onRoute(route) {
    if (running) running.finish();
    const r = stacks.sync(route);
    const all = stacks.stack(r.tab);
    if (r.kind === "tab") {
      for (const t of TABS) {
        tabStacks[t].classList.toggle("is-active", t === r.tab);
        navStacks[t].classList.toggle("is-active", t === r.tab);
      }
      tabbar.select(r.tab);
    }
    if (r.kind === "push" && r.from) {
      setTop(r.to, true);
      slide(r.to, r.from, 0, 1, () => setTop(r.from, false));
    } else if (r.kind === "pop" && !swipedBack && !(webBack && !ownBack)) {
      const [old, ...deeper] = r.removed;
      drop(deeper);
      setTop(r.to, true);
      slide(old, r.to, 1, 0, () => drop([old]));
    } else {
      drop(r.removed);
      for (const e of all) setTop(e, e === r.to);
    }
    swipedBack = false;
    ownBack = false;
    updateEdge();
    document.title = r.to.page.title === "Cydian" ? "Cydian" : `${r.to.page.title} · Cydian`;
  },
});

// Back: history.back() when the parent is right behind us in history (we pushed here), so the browser's back and
// forward stay in step; on a deep link there is nothing behind, so replace the route with the parent instead.
// Outside the native app, iOS has its own edge swipe back: Safari's in a tab, and the system's in an iOS 26 home-screen
// web app. Both walk the browser history with their own animation. Ours on top made one swipe go back twice (theirs,
// then ours finishing and calling history.back() again), landing somewhere else. So on the web our edge strip stays
// off and a pop we didn't start isn't animated; we just show the page history lands on. The native app's WKWebView
// has no such gesture (N1 turns it off), so it keeps ours.
const webBack = !(globalThis.cydianApp || globalThis.cydianNative);
let ownBack = false; // the pop under way came from our back button or our swipe

function goBack() {
  ownBack = true;
  const top = stacks.top();
  const up = top && parent({ tab: top.tab, path: top.path });
  if (!up) return;
  if (top.pushed) history.back();
  else router.replace(up);
}

// The swipe starts on a thin strip along the left edge that takes touches for itself (touch-action: none), so the
// browser never turns the drag into its own back gesture or a scroll and cancels our pointer stream. It is only
// there while there is something to go back to.
const edgeEl = document.createElement("div");
edgeEl.className = "edge-swipe";
screensEl.append(edgeEl);
function updateEdge() {
  // pointer-events, not display: switching it costs no layout.
  edgeEl.classList.toggle("off", webBack || stacks.stack(stacks.activeTab()).length < 2);
}

let gesture = null; // the edge swipe in progress: { pair, top, below, width }
attachEdgeSwipe(edgeEl, {
  canStart: () => !webBack && !running && !gesture && stacks.stack(stacks.activeTab()).length > 1,
  begin() {
    const all = stacks.stack(stacks.activeTab());
    const [top, below] = [all.at(-1), all.at(-2)];
    gesture = { pair: pairOf(top, below), top, below, width: screensEl.clientWidth };
    setMoving(gesture.pair, true, false);
    return gesture.width;
  },
  move(dx) {
    if (gesture) setProgress(gesture.pair, 1 - Math.min(1, dx / gesture.width));
  },
  end(dx, vx) {
    const { top, below, width, pair } = gesture;
    gesture = null;
    const p = 1 - Math.min(1, dx / width);
    const commit = swipeCommits(dx, vx, width);
    setMoving(pair, false);
    // Keep the slide's speed close to the finger's: a fast flick finishes fast.
    const rest = commit ? p : 1 - p;
    const speed = Math.abs(vx) * DURATION / width; // full slides per DURATION at the finger's speed
    const duration = Math.max(120, Math.min(DURATION, rest * DURATION / Math.max(1, speed)));
    slide(top, below, p, commit ? 0 : 1, () => {
      if (!commit) return;
      swipedBack = true;
      setTop(below, true);
      setTop(top, false); // hidden until the route change drops it
      goBack();
    }, { duration, easing: EASE_OUT });
  },
});

// Tab taps go through selectTab so each tab keeps its place; the href is there for no-JS fallbacks and a11y.
for (const tab of TABS) tabbar.items[tab].href = format({ tab });
document.getElementById("tabbar").addEventListener("click", (e) => {
  const a = e.target.closest("a.tab");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  // A second tap at the root runs the screen's reselect() (Search focuses its field), in this handler (F36).
  const tab = a.dataset.tab;
  // Back to the root of the tab you are on is our own pop, so it slides like Back (not a jump).
  tapTab(tab, router.current(), { selectTab: (t) => { ownBack = true; router.selectTab(t); }, reselect: SCREENS[tab].reselect });
});

// Pressed look while a finger is down, like Cydia's: .is-pressed on the bar button or row under it, off when the
// finger lifts, leaves, or the touch turns into a scroll (pointercancel). :active alone is unreliable on iOS.
const PRESSABLE = ".bar-button, a.cell-inner, button.cell-inner, .alert-button, .del-confirm";
let pressed = null;
const unpress = () => { if (pressed) { pressed.classList.remove("is-pressed"); pressed = null; } };
document.addEventListener("pointerdown", (e) => {
  unpress();
  const el = e.target.closest?.(PRESSABLE);
  if (el && !el.disabled) { pressed = el; el.classList.add("is-pressed"); }
}, { passive: true });
for (const type of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(type, unpress, { passive: true });
document.addEventListener("pointermove", (e) => {
  if (pressed && !pressed.contains(document.elementFromPoint(e.clientX, e.clientY))) unpress();
}, { passive: true });
// iOS only applies :active to elements when a touch listener exists somewhere on the page.
document.addEventListener("touchstart", () => {}, { passive: true });

initScroller(document.getElementById("screens"));
for (const tab of TABS) if (SCREENS[tab].init) SCREENS[tab].init(ctx);
// Home Screen launches open on Home (F32, launch.js); a return from the background runs none of this.
const startAt = launchURL(window);
if (startAt) history.replaceState(null, "", startAt);
// F8: a /add?url=… link (core/handoff.js) opens Sources > Manage > Sources with Add Source's alert filled in.
const addFrom = isAddPath(location.pathname) ? parseAddLink(location.search) : null;
if (isAddPath(location.pathname)) {
  history.replaceState(null, "", location.pathname.replace(/add\/?$/, "") + format({ tab: "sources", path: ["manage", "sources"] }));
}
router.start();
if (addFrom) requestAnimationFrame(() => addSource(ctx, addFrom));

// Refresh Sources on Launch (Settings): in the background, no HUD; the Sources tab shows the result when it next loads.
if (settingsScreen.settings.isShown("refreshOnLaunch") && settingsScreen.settings.get("refreshOnLaunch")) getBackend().refreshSources(undefined, { filter: sourceFilter(settingsScreen.settings.deviceType()) }).catch(() => {});

// Upgrade alerts (F10): register the service worker and, if opted in, re-subscribe (iOS drops subscriptions now
// and then). After first paint, so it never competes with the launch.
if (!globalThis.cydianNative) setTimeout(() => startPush({ holds: () => settingsScreen.settings.holds.list() }).catch(() => {}), 3000);
