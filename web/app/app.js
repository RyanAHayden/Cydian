// Entry point: the tab bar, one navigation stack per tab (nav/stack.js), push/pop slides and the edge swipe back.
//
// DOM: #screens holds a .tab-stack per tab, and each holds its stack's .page elements, root first. A page is a
// fixed frame (.page, moved by transforms) around its own scroller (.page-body), so switching tabs or popping
// keeps every screen's scroll position. The nav bar holds a matching .nav-stack of .nav-items per tab. Only the
// top page of the active tab is visible; the one below shows during a slide or swipe.
//
// Screens (screens/*.js) export `title`, `render(body, route, ctx)` and optionally `nav(route, ctx)` returning
// { title, back (the back button's label above it; else the title), style: "grouped" | "plain", left: { label, onClick }, right: { label, onClick } | [several] } and `init(ctx)`,
// run once at start (e.g. to set the tab's badge). ctx: { go, back, setBadge, showHUD }.
import { detectMode } from "./core/settings.js";
import { TABS, BAR_TABS, createRouter, format, parent, mounted } from "./router.js";
import { createStacks, swipeCommits } from "./nav/stack.js";
import { animate, setProgress, clear, DURATION, EASE_OUT } from "./nav/transition.js";
import { attachEdgeSwipe } from "./nav/swipe.js";
import { keepRow, ghostFor } from "./nav/selection.js";
import { createTabbar, tapTab, scrollToTop } from "./nav/tabbar.js";
import { showHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";
import { initScroller } from "./nav/scroller.js";
import { initMomentumTap, heldTap } from "./nav/momentum-tap.js";
import { makeScrollToTop } from "./nav/statusbar.js";
import * as home from "./screens/home.js";
import * as sources from "./screens/sources.js";
import * as changes from "./screens/changes.js";
import * as installed from "./screens/installed.js";
import * as search from "./screens/search.js";
import * as settingsScreen from "./screens/settings.js";
import { sourceFilter } from "./core/sources.js";
import { getBackend } from "./backend.js";
import { appSchemeFor } from "./core/applinks.js";
import { launchURL } from "./launch.js";
import { isAddPath, parseAddLink } from "./core/handoff.js";
import { addSource } from "./screens/manage.js";
import { initQueue } from "./screens/queue.js";
import { initIpaLinks } from "./screens/ipa-install.js";
import { startEssential, appVersion } from "./essential-ui.js";
import { showBanner } from "./nav/banner.js";
import { showReloadBar } from "./nav/reloadbar.js";
import { catalog } from "./catalog.js";
import { createUpgradeNotices } from "./settings.js";
import { createPrefsMirror } from "./settings.js";

const SCREENS = { home, sources, changes, installed, search, settings: settingsScreen };

const screensEl = document.getElementById("screens");
const navbarEl = document.getElementById("navbar");
const tabStacks = {};
const navStacks = {};
// F123: one stack per tab-bar tab; Settings' pages live on Home's (router.js settingsRoute).
for (const tab of BAR_TABS) {
  tabStacks[tab] = Object.assign(document.createElement("div"), { className: "tab-stack" });
  tabStacks[tab].dataset.tab = tab;
  screensEl.append(tabStacks[tab]);
  navStacks[tab] = Object.assign(document.createElement("div"), { className: "nav-stack" });
  navStacks[tab].dataset.tab = tab;
  navbarEl.append(navStacks[tab]);
}

// F65: the icon badge N5's daemon sets goes once the Changes tab shows no upgrades (jailbreak app only).
const upgradeNotices = createUpgradeNotices({ settings: settingsScreen.settings, current: () => router.current() }); // called only once the screens init, after router exists
const tabbar = createTabbar(document.getElementById("tabbar"), BAR_TABS, (t) => SCREENS[t].title);
const ctx = {
  go: (route) => router.go(route),
  back: () => goBack(),
  setBadge: (tab, n) => { tabbar.setBadge(tab, n); upgradeNotices.badge(tab, n); },
  showHUD,
  showAlert,
  // F150: Sources' refreshes drop the reload bar; its last two steps load the new package lists into the catalog
  // ("Loading Data") and build All Sources, the merged index Search reads, by asking for its sections ("Building
  // Searcher Cache"). A failure there shows where it is used (the source's Sections page, Search), not as the
  // refresh's error.
  reloadBar: showReloadBar,
  loadData: () => catalog.ensure().catch(() => {}),
  buildCache: () => catalog.sections().catch(() => {}),
};

const stacks = createStacks({ tabs: BAR_TABS, create: makePage });

function button(spec, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = spec.label;
  if (spec.onClick) b.addEventListener("click", spec.onClick);
  if (spec.onPress) b.addEventListener("pointerdown", spec.onPress); // touch-down (Sources' Add: Type before the Paste bubble)
  if (spec.ref) spec.ref(b); // F147: the screen keeps the button to change its label later (Installed's Wish List count)
  return b;
}

// Called by stacks.sync while it builds a stack, root first: the parent is already the stack's last entry.
function makePage(tab, path) {
  const route = mounted({ tab, path }); // another tab's page opened here (router.js mounted): that screen draws it
  const screen = SCREENS[route.tab];
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
    const back = button({ label: below.page.back, onClick: () => goBack() }, "bar-button back");
    back.setAttribute("aria-label", "Back to " + below.page.back);
    left.append(back);
  } else if (info.left) left.append(button(info.left, "bar-button"));
  const h1 = document.createElement("h1");
  h1.className = "nav-title";
  h1.textContent = title;
  if (info.titleView) { h1.classList.add("nav-title-view"); h1.replaceChildren(info.titleView); } // a control in the title's place (F127)
  const right = document.createElement("div");
  right.className = "nav-right";
  // `right` may be one button or several side by side (Sources: Add and Manage).
  for (const b of [info.right].flat().filter(Boolean)) right.append(button(b, "bar-button"));
  item.append(left, h1, right);
  navStacks[tab].append(item);

  screen.render(body, route, ctx);
  return { el: page, body, shade, item, title, back: info.back ?? title }; // back: the label pages above it show
}

// withSelect (F163): a pop, so the row that opened `top` (below.selected, nav/selection.js) fades with it. Its
// copy may be laid again here (the list re-rendered while hidden): that is the one layout a pop's start costs.
const pairOf = (top, below, withSelect = false) => ({
  top: { page: top.page.el, shade: top.page.shade, item: top.page.item },
  below: { page: below.page.el, shade: below.page.shade, item: below.page.item,
    select: withSelect ? ghostFor(below.selected, below.page.el) : null },
});

// F163: the row tapped to push a page stays blue on the page below until that page comes back. lastPress is the
// last row a finger went down on (the press handler below); a push that follows it within PRESS_MS opened it.
const PRESS_MS = 1500;
let lastPress = null; // { el, at }
function keepSelected(entry) {
  const press = lastPress;
  lastPress = null;
  if (!press || performance.now() - press.at > PRESS_MS || !press.el.matches(".cell-inner")) return;
  if (!press.el.isConnected || !entry.page.el.contains(press.el)) return;
  unselect(entry);
  entry.selected = keepRow(press.el);
}
function unselect(entry) {
  if (!entry?.selected) return;
  entry.selected.mark?.remove();
  entry.selected = null;
}

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

function slide(top, below, p0, p1, cleanup, { withSelect = false, ...opts } = {}) {
  const pair = pairOf(top, below, withSelect);
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
      for (const t of BAR_TABS) {
        tabStacks[t].classList.toggle("is-active", t === r.tab);
        navStacks[t].classList.toggle("is-active", t === r.tab);
      }
      tabbar.select(r.tab);
    }
    if (r.kind === "push" && r.from) {
      setTop(r.to, true);
      keepSelected(r.from);
      slide(r.to, r.from, 0, 1, () => setTop(r.from, false));
    } else if (r.kind === "pop" && !swipedBack && !(webBack && !ownBack)) {
      const [old, ...deeper] = r.removed;
      drop(deeper);
      setTop(r.to, true);
      slide(old, r.to, 1, 0, () => { drop([old]); unselect(r.to); }, { withSelect: true });
    } else {
      drop(r.removed);
      unselect(r.to); // back on top without a slide (a swipe already faded it, a web back, a tab): no blue left
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
  const below = stacks.below();
  const up = below ? { tab: below.tab, path: below.path } : top && parent({ tab: top.tab, path: top.path });
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
    gesture = { pair: pairOf(top, below, true), top, below, width: screensEl.clientWidth };
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
      unselect(below); // faded out with the swipe
      setTop(below, true);
      setTop(top, false); // hidden until the route change drops it
      goBack();
    }, { duration, easing: EASE_OUT, withSelect: true });
  },
});

// Tab taps go through selectTab so each tab keeps its place; the href is there for no-JS fallbacks and a11y.
for (const tab of BAR_TABS) tabbar.items[tab].href = format({ tab });
// The website before Cydian is installed (websign-gate.js browsingLocked): only Home in the tab bar (Settings is on
// Home's stack since F123, so it stays reachable); the others are dimmed with a lock, and a tap asks Install Cydian
// First (user 2026-11-18). Ignore unlocks them all.
const OPEN_TABS = new Set(["home"]);
let gate = null;
const lockTabs = async () => {
  gate ??= await import("./websign-gate.js");
  const locked = gate.browsingLocked({ mode: detectMode() });
  for (const t of BAR_TABS) tabbar.items[t].classList.toggle("tab-locked", locked && !OPEN_TABS.has(t));
};
if (!(globalThis.cydianApp || globalThis.cydianNative)) { lockTabs(); addEventListener("cydian:browse-lock", lockTabs); }

document.getElementById("tabbar").addEventListener("click", (e) => {
  const a = e.target.closest("a.tab");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.classList.contains("tab-locked")) {
    import("./screens/home.js").then((h) => gate.askToBrowse({ install: () => h.installCydian() })).catch(() => {});
    return;
  }
  // A second tap at the root scrolls the page to the top (F148), then runs the screen's reselect() (Search focuses
  // its field), in this handler (F36).
  const tab = a.dataset.tab;
  // Back to the root of the tab you are on is our own pop, so it slides like Back (not a jump).
  tapTab(tab, router.current(), { selectTab: (t) => { ownBack = true; router.selectTab(t); }, reselect: SCREENS[tab].reselect,
    scrollTop: () => scrollToTop(stacks.top()?.page.body) });
});

// Pressed look while a finger is down, like Cydia's: .is-pressed on the bar button or row under it, off when the
// finger lifts, leaves, or the touch turns into a scroll (pointercancel). :active alone is unreliable on iOS.
const PRESSABLE = ".bar-button, a.cell-inner, button.cell-inner, .alert-button, .del-confirm";
let pressed = null, pressedAt = 0;
// A quick tap still shows the held look for a moment, as UIKit does: otherwise a button that opens something (Browse's
// file picker) never visibly goes down.
const unpress = () => {
  const el = pressed;
  if (!el) return;
  pressed = null;
  setTimeout(() => { if (pressed !== el) el.classList.remove("is-pressed"); }, Math.max(0, 140 - (performance.now() - pressedAt)));
};
document.addEventListener("pointerdown", (e) => {
  unpress();
  const el = e.target.closest?.(PRESSABLE);
  if (!e.isPrimary) return; // one finger's button at a time, as UIKit does
  lastPress = null;
  // A new press clears any other still showing (a quick tap's lingering 140 ms included): one held look at a time.
  for (const other of document.querySelectorAll(".is-pressed")) if (other !== el && !other.classList.contains("sel-ghost")) other.classList.remove("is-pressed");
  // While a row shows its Delete (a swipe), a tap on a row only puts the Delete away: no blue, as Cydia.
  const delShown = el?.closest("ul")?.querySelector(":scope > .armed") && !el.matches(".del-confirm");
  if (el && !el.disabled && !delShown) { pressed = el; pressedAt = performance.now(); el.classList.add("is-pressed"); lastPress = { el, at: pressedAt }; }
}, { passive: true });
for (const type of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(type, unpress, { passive: true });
document.addEventListener("pointermove", (e) => {
  if (pressed && !pressed.contains(document.elementFromPoint(e.clientX, e.clientY))) unpress();
}, { passive: true });
// A held row lets go the moment its list scrolls (UIKit cancels the cell's highlight when the pan starts); iOS's
// pointercancel alone can come late or not at all after a long hold.
// F153: not while a tap stops a coasting list (its last scroll events come after the touch-down); that tap opens the row.
document.addEventListener("scroll", () => { if (pressed && !heldTap()) { pressed.classList.remove("is-pressed"); pressed = null; lastPress = null; } }, { capture: true, passive: true });
// The search fields' clear button (packages.css .search-field::after): a tap at the field's right end, while it has
// text, empties it and searches again (the field's own input listener), keeping the keyboard up.
document.addEventListener("click", (e) => {
  const f = e.target;
  if (!(f instanceof Element) || !f.classList.contains("search-field")) return;
  const input = f.querySelector("input");
  if (!input?.value || e.clientX < f.getBoundingClientRect().right - 32) return;
  e.preventDefault();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}, true);
// iOS only applies :active to elements when a touch listener exists somewhere on the page.
document.addEventListener("touchstart", () => {}, { passive: true });

initScroller(document.getElementById("screens"));
initMomentumTap(); // F153: a quick tap during momentum opens the row, not only stops the scroll
for (const tab of TABS) if (SCREENS[tab].init) SCREENS[tab].init(ctx);
// N4: the install queue (jailbreak build: the backend has one): Confirm opens when a package is queued.
if (typeof getBackend().queue === "function") initQueue(ctx);
initIpaLinks(); // F67: a tapped .ipa link offers Install IPA (jailbreak build only)
// Home Screen launches open on Home (F32, launch.js); a return from the background runs none of this.
const startAt = launchURL(window);
if (startAt) history.replaceState(null, "", startAt);
// F8: a /add?url=… link (core/handoff.js) opens Sources > Manage > Sources with Add Source's alert filled in.
const addFrom = isAddPath(location.pathname) ? parseAddLink(location.search) : null;
if (isAddPath(location.pathname)) {
  history.replaceState(null, "", location.pathname.replace(/add\/?$/, "") + format({ tab: "sources", path: ["manage", "sources"] }));
}
// The Home Screen web app opens outside links in a sheet over itself, address bar on top. x-safari-https://… makes
// iOS hand them to Safari instead, and from there to their own apps (Discord, GitHub). The app's shell sends them
// out natively already (LinkOut); a Safari tab opens them as usual.
const standalone = !globalThis.cydianNative && (navigator.standalone || matchMedia?.("(display-mode: standalone)").matches);
if (standalone) {
  const outside = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) && x.origin !== location.origin ? x.href : null; } catch { return null; } };
  // A site with its own app's scheme (core/applinks.js: X, YouTube) opens that app; Safari only if it didn't come up.
  const viaSafari = (href) => {
    const app = appSchemeFor(href);
    if (!app) { location.href = "x-safari-" + href; return; }
    location.href = app;
    setTimeout(() => { if (document.visibilityState === "visible") location.href = "x-safari-" + href; }, 1500);
  };
  const open = window.open.bind(window);
  window.open = (u, ...rest) => { const href = outside(u); if (href) { viaSafari(href); return null; } return open(u, ...rest); };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    const href = a && outside(a.getAttribute("href"));
    if (href && (a.target === "_blank" || a.rel.includes("noopener"))) { e.preventDefault(); viaSafari(href); }
  }, true);
}
router.start();
// F93 (as before F89): first launch of a Cydian installed from the website: its signed copy carries the website's
// sources and settings as web/transfer.link (signed in the browser, websign-job.js); import them once, no question.
// Only on the very first launch (user 2026-11-17: the website is rarely used after that).
if (globalThis.cydianNative) {
  let done = null;
  try { done = localStorage.getItem("cydian.transferDone"); } catch { /* private */ }
  if (!done) fetch("transfer.link", { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).then(async (link) => {
    link = link?.trim();
    if (!link || !link.startsWith("cydian://import?")) return;
    try { localStorage.setItem("cydian.transferDone", "1"); } catch { /* imports again next launch */ }
    const { handleIncoming } = await import("./incoming.js");
    await handleIncoming(link);
  }).catch(() => {});
}
upgradeNotices.start();
createPrefsMirror({ settings: settingsScreen.settings }).start(); // F70: N7's settings to the daemon
document.getElementById("boot")?.remove(); // the first page is drawn: the loading screen goes
if (addFrom) requestAnimationFrame(() => addSource(ctx, addFrom));

// Refresh Sources on Launch (Settings): in the background, no HUD; the Sources tab shows the result when it next loads.
// Refresh on Launch: in the background, with the Sources tab's spinning red badge (screens/sources.js).
if (settingsScreen.settings.isShown("refreshOnLaunch") && settingsScreen.settings.get("refreshOnLaunch")) SCREENS.sources.refreshInBackground?.(ctx);

// F72: in the app, once the launch has settled, the Essential Upgrade alert when Cydian (or, jailbroken, apt, dpkg or
// another Essential: yes package) has an upgrade on Cydian's built-in source. It replaces F61's own popup: only when
// that source couldn't be read does F61 look on GitHub (at most once a day).
// F75: cydian:// links from the website (Send Settings, Home's Open in Cydian App) and elsewhere (incoming.js).
// cydian://install (F89) is no longer sent by the website since F92/F95: only for links already out there.
if (globalThis.cydianNative) import("./incoming.js").then((m) => m.startIncoming()).catch(() => {});

// The Home Screen icon's long-press Upgrade All (native Shortcut.perform): Changes, every upgrade queued, Confirm.
// F167: the native shell calls this on a status bar tap (App.swift scrollViewShouldScrollToTop).
globalThis.cydianScrollToTop = makeScrollToTop(document, () => stacks.top()?.page.body);

globalThis.cydianShortcut = async (type) => {
  if (type !== "upgrade") return;
  location.hash = "#/changes";
  (await import("./screens/changes.js")).upgradeEverything().catch(() => {});
};
if (globalThis.cydianPendingShortcut) { globalThis.cydianShortcut(globalThis.cydianPendingShortcut); globalThis.cydianPendingShortcut = null; }

if (globalThis.cydianNative) {
  // Every launch (Home's Reload is one) and every return: Cydian's source first (the Essential Upgrade alert); when
  // that found nothing to say, GitHub's release, without the once-a-day wait (user 2026-11-17: only Settings' Check
  // for Updates showed it).
  const lookForUpdates = () => startEssential()
    .then((r) => (["complete", "essential", "ignored", "notified"].includes(r) ? r : settingsScreen.checkUpdates({ always: true })))
    .catch(() => {});
  setTimeout(lookForUpdates, 2000);
  globalThis.addEventListener("cydian:reloaded", lookForUpdates); // Home's Reload (screens/home.js reloadHome)
  // The first launch after Cydian updated itself (iOS closed the old one as it installed this one): say so.
  appVersion().then((v) => {
    if (!v) return;
    let last = null;
    try { last = localStorage.getItem("cydian.lastVersion"); localStorage.setItem("cydian.lastVersion", v); } catch { return; }
    if (last && last !== v) {
      showBanner({ title: "Cydian", message: `Updated to ${v}.`, duration: 4000 });
      // The icon badge counted this very update: clear it; Changes sets it again with what's still waiting (user 2026-11-18).
      Promise.resolve(globalThis.cydianNative.call("app.badge", { count: 0 })).catch(() => {});
    }
  }).catch(() => {});
  // Back in the foreground after a while: look again (an essential update can come out while Cydian sits in the
  // background, and iOS rarely cold-launches it).
  let lastEssential = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastEssential < 60 * 1000) return; // every return, once a minute at most
    lastEssential = Date.now();
    lookForUpdates();
  });
}

// F89: Web Push went with the website's server. A browser that registered the old push service worker (sw.js,
// F10) drops it, so iOS stops waking it for pushes that no longer come.
if (!globalThis.cydianNative) {
  setTimeout(() => navigator.serviceWorker?.getRegistrations?.()
    .then((all) => Promise.all(all.map((r) => r.unregister()))).catch(() => {}), 3000);
}
