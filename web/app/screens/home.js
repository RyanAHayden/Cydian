// Home tab, laid out like Cydia's on the 4S (ref/4s/screens/cydia-home.png; styles in home.css):
//   - Cydian's icon beside "Welcome to Cydian" and a by-line
//   - tile rows: GitHub | Sources as one outlined pair (Cydia: Facebook | Twitter), then Featured and Themes as two
//     white half-width tiles
//   - a full-width green tile for the current state (stateTile: Add a Source, n Upgrades Available, ...; Cydia's
//     Manage Account)
//   - a grouped list like Cydia's help links: Upgrading & Jailbreaking Help (our page), Find Extensions for
//     Applications (Search), More Package Sources (a curated list, one tap adds a source); User Guides (screens/guides.js); Credits
// Every tile and row is a .cell-inner link, so it gets the table cells' held look (blue selection) from ios6.css
// and app.js. No featured banners above the tiles (F154: Browse's Tweak of the Day card instead).
//
// Routes below the tab: help, featured, sources (More Package Sources), guides/<id>, credits, wishlist (F102), and browse (F46): Browse's list
// (F124: New, Recently Updated, Popular, Featured, Free Apps / Tweaks / Themes, then the categories), browse/<list id>
// (core/catalog.js BROWSE_LISTS: new, updated, popular, featured, free-apps...), browse/category:<name>, and below those browse.js's tokens
// (package:<id>, author:<name>, versions:<id>), as in the Search tab.
import { grouped, el, placeholder } from "../nav/ui.js";
import { format, settingsRoute, parse } from "../router.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { sourceKey, sourcesFor } from "../core/sources.js";
import { settings } from "./settings.js";
import * as browse from "./browse.js";
import * as roulette from "./roulette.js";
import { catalog } from "../catalog.js";
import { currentDevice } from "../device.js";
import { signAndInstall, signingReady, getBring, deviceStatus, getServer } from "../signing-client.js";
import { featuredRefs } from "./extras.js";
import { browseList, browseListsFor, FRESH_DAYS, collection } from "../core/catalog.js";
import { dayOf, dayTitle } from "../core/changes.js";
import { isAltKey } from "../core/altstore.js";
import { homeOffer, debUrl, debAlert, REPO_URL, APP_IPA_URL, APP_NAME } from "../core/appoffer.js";
import { fetchRelease, debFor } from "../core/selfupdate.js";
import { refreshInBackground } from "./sources.js";
import { markCydianInstalled, browsingLocked, askToBrowse } from "../websign-gate.js";
import * as guides from "./guides.js";
import { guideRows, JAILBREAK_INFO_URL } from "./guides.js";

const DISCORD_URL = "https://discord.gg/3XASvpjbgp"; // Home's pair: GitHub | Discord (Cydia: Facebook | Twitter)

export const title = "Home";

// More Package Sources: well-known flat repos, added in one tap (core/sources.js addSource takes flat repos only, so
// the dist ones among the defaults can't be offered here). Each answered with a Release on 2026-11-17.
export const CURATED_SOURCES = [
  { name: "Chariz", uri: "https://repo.chariz.com/", blurb: "tweaks and themes, free and paid" },
  { name: "Havoc", uri: "https://havoc.app/", blurb: "tweaks and themes, free and paid" },
  { name: "Twickd", uri: "https://repo.twickd.com/", blurb: "tweaks from the Twickd team" },
  { name: "SparkDev", uri: "https://sparkdev.me/", blurb: "SparkDev's tweaks" },
  { name: "ElleKit", uri: "https://ellekit.space/", blurb: "the tweak injection library" },
  { name: "palera1n", uri: "https://repo.palera.in/", blurb: "palera1n's own packages" },
].map((s) => ({ ...s, key: sourceKey({ uri: s.uri, dist: "./" }) }));

// The green tile: what Home suggests next, from the source list and the upgrade count.
//   sources: the backend's list, or null while it loads; upgrades: a count, or null where nothing knows it yet
//   (the site has no installed list). Returns { kind, label, href }.
export function stateTile({ sources = null, upgrades = null, refreshing = 0 } = {}) {
  if (sources == null) return { kind: "loading", label: "Loading Sources", href: format({ tab: "sources" }) };
  if (!sources.length) return { kind: "add", label: "Add a Source", href: format({ tab: "home", path: ["sources"] }) };
  if (upgrades > 0) {
    return { kind: "upgrades", label: `${upgrades} ${upgrades === 1 ? "Upgrade" : "Upgrades"} Available`, href: format({ tab: "changes" }) };
  }
  // While a refresh runs, its errors aren't known yet: no "failed" until a source has actually failed this time.
  if (refreshing > 0) return { kind: "loading", label: "Refreshing Sources", href: format({ tab: "sources" }) };
  const failed = sources.filter((s) => s.error).length;
  if (failed) {
    return { kind: "failed", label: `${failed} ${failed === 1 ? "Source" : "Sources"} Failed to Load`, href: format({ tab: "sources" }) };
  }
  if (upgrades === 0) return { kind: "current", label: "Everything Up to Date", href: format({ tab: "changes" }) };
  return { kind: "changes", label: "See What's New", href: format({ tab: "changes" }) };
}

// F79: Home's Install IPAs tile, beside Browse: the Installed tab's Install IPAs page (screens/myipas.js). Not in the
// jailbreak app, which has no such page (apt installs there).
// F93 (as before F89): Install Cydian App on the website, Not Jailbroken: with a certificate in Settings > Signing,
// Cydian's IPA signed in the browser and installed, carrying the certificate (Bring My Certificate), sources and
// settings into its first launch; without one, Settings > Signing first. -> "install" | "signing"
// F96: once iOS was asked to install it, the website stops asking "Install Cydian First" (websign-gate.js).
export async function installApp({ ready = signingReady, install = signAndInstall, bring = getBring, go = (h) => { location.hash = h; },
  installed = markCydianInstalled } = {}) {
  if (!(await ready())) { go(format(settingsRoute(["signing"])).replace(/^#/, "")); return "signing"; }
  install({ url: APP_IPA_URL, name: APP_NAME, bring: bring(), onInstalled: () => installed() });
  return "install";
}

// F96: Home's Install Cydian App tile's action, also the first-visit prompt's Install Cydian: Not Jailbroken, signed
// in the browser (installApp); jailbroken, the .deb for the device's arch (installDeb).
export function installCydian({ offer = homeOffer({ mode: settings.mode, deviceType: settings.deviceType() }) } = {}) {
  if (!offer) return null;
  return offer.action === "deb" ? installDeb(offer.arch) : installApp();
}

// Home's Signing tile (Settings > Signing) where something signs: the sideload app and, F93, the website (in the
// browser). The jailbreak app shows Themes there. F123: only while signing isn't set up (user 2026-11-18: "when
// signing is setup it should be hidden in settings"); after that it lives in Settings > Signing alone.
export const showsSigningTile = (mode, setUp = false) => (mode === "sideload" || mode === "site") && !setUp;

// F123: whether signing is set up, for the Signing tile. The website: a certificate and profile saved, password
// right (signingReady). The sideload app: every step of Settings > Signing's walkthrough done (signing.js
// missingStep: the certificate on the device and an https Signing Server). Anything that fails counts as not set up.
export async function signingSetUp(mode, { ready = signingReady, status = () => deviceStatus(), server = getServer,
  missing = async (st, sv) => (await import("./signing.js")).missingStep(st, sv) } = {}) {
  try {
    if (mode === "site") return Boolean(await ready());
    if (mode === "sideload") return (await missing(await status(), server())) == null;
  } catch { /* the signer didn't answer */ }
  return false;
}

// F123: Home's list below the tiles, as Cydia's: the help links, User Guides, then Credits / Thank You. Settings (it left
// the tab bar; its pages open on Home's stack, router.js settingsRoute) is its own group, F135: first, directly under
// the tiles (user 2026-11-18: "move settings up on the main page and give it an icon"). F159: its gear is a tile glyph
// (.home-glyph.glyph-settings, home.css) with the tiles' inset, so it lines up with Featured/Signing above.
export const SETTINGS_ICON = "home-glyph glyph-settings";
// F157: the User Guides' lite set (no jailbreak guides) while Not Jailbroken: the sideload build, and the website
// while Settings > Device says so (as F144).
const guidesLite = () => guides.isLite(settings.deviceType());
export function homeLinks() {
  return [{ rows: [{ label: "Settings", href: format(settingsRoute()), icon: { cls: SETTINGS_ICON }, cls: "home-settings-row" }] }, {
    rows: [
      { label: "Upgrading & Jailbreaking Help", href: format({ tab: "home", path: ["help"] }) },
      { label: "Find Extensions for Applications", href: format({ tab: "search" }), chevron: true },
      // Manage Sources (user 2026-11-18), opened on Home's own stack (router mountLink): Back comes home.
      { label: "More Package Sources", href: format({ tab: "sources", path: ["manage"] }) },
    ],
  }, { header: "User Guides", rows: guideRows(format, guidesLite()) },
  { rows: [{ label: "Credits / Thank You", href: format({ tab: "home", path: ["credits"] }) }] }];
}

// F156: Home's link rows that stay open on the locked website (user 2026-11-18: "dont lock credits and thank you or
// jailbreaking help"): Settings (F123), Upgrading & Jailbreaking Help, the User Guides and Credits / Thank You. They
// need no install and help people get to one. Find Extensions and More Package Sources stay locked.
const OPEN_WHILE_LOCKED = new Set(["settings", "help", "guides", "credits"]);
export function openWhileLocked(href) {
  if (!href?.startsWith?.("#/")) return false;
  const route = parse(href);
  if (route.tab !== "home") return false;
  const first = route.path[0];
  return first === settingsRoute().path[0] ? true : OPEN_WHILE_LOCKED.has(first);
}
// Marks Home's locked link rows (.home-locked on the row's li; a group whose rows are all locked gets it too) and
// returns what it marked. links is homeLinks(), groups the .group boxes grouped(links) drew, in the same order.
export function lockHomeLinks(groups, links) {
  const marked = [];
  links.forEach((section, i) => {
    const group = groups[i];
    const cells = group?.querySelectorAll(".cell") ?? [];
    const shut = section.rows.map((r) => !openWhileLocked(r.href));
    if (shut.length && shut.every(Boolean)) { group.classList.add("home-locked"); marked.push(group); return; }
    shut.forEach((s, j) => { if (s && cells[j]) { cells[j].classList.add("home-locked"); marked.push(cells[j]); } });
  });
  return marked;
}
// A tap on anything in box marked .home-locked asks (askToBrowse) instead of opening; other taps go through.
export function askOnLocked(box, ask) {
  box.addEventListener("click", async (e) => {
    if (!e.target.closest?.(".home-locked")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    await ask();
  }, true);
}

// F154: no horizontal scroller of featured banners on Home or Browse, in any build (user 2026-11-18, the Browse
// concept). F135 had moved them from the jailbreak app's Home to Browse's top; Browse's Tweak of the Day card took
// their place. A source's own page still shows its banners (browse.js drawSections, F20).
export const homeShowsFeatured = () => false;
export const browseShowsFeatured = () => false;

export function ipasTile(mode = "site") {
  if (mode === "jailbreak") return null;
  return { label: "Install IPAs", href: format({ tab: "installed", path: ["myipas"] }) };
}

// F37: the one-line hint Home shows while Settings > Device is Not Jailbroken, or null. `type` is deviceType().
export const DEVICE_HINT = "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device.";
export function deviceHint(type, mode = "site") {
  if (type !== "none") return null;
  // The sideload build is always Not Jailbroken: nothing to change there, so no hint. Nor on the website (user
  // 2026-11-18: it's obviously the web; jailbroken visitors get "Jailbroken? Get Cydian.deb" in the Cydian App card).
  if (mode === "sideload" || mode === "site") return null;
  return { text: DEVICE_HINT, href: format(settingsRoute(["device"])) };
}

// F41: whether Home offers Themes (the tile, Featured's Browse Themes). Not Jailbroken lists apps only (F37).
export const showsThemes = (type) => type !== "none";

// F46: what a route under browse/ shows: { page: "root" | "list" | "category" | "browse" (browse.js's own pages,
// below a list), value }. F124: "list" is one of Browse's lists, by id (core/catalog.js BROWSE_LISTS).
// F154: also "roulette" (Tweak Roulette, screens/roulette.js), "categories" (All Categories) and "collection"
// (browse/collection:<id>, core/catalog.js COLLECTIONS).
export function browsePage(path) {
  if (path.length === 1) return { page: "root" };
  if (path.length === 2 && path[1] === "roulette") return { page: "roulette" };
  if (path.length === 2 && path[1] === "categories") return { page: "categories" };
  if (path.length === 2 && path[1].startsWith("collection:") && collection(path[1].slice(11))) return { page: "collection", value: path[1].slice(11) };
  if (path.length === 2 && browseList(path[1])) return { page: "list", value: path[1] };
  if (path.length === 2 && path[1].startsWith("category:")) return { page: "category", value: path[1].slice(9) };
  return { page: "browse" };
}

export function nav(route, ctx) {
  if (route.path[0] === "browse") {
    const b = browsePage(route.path);
    if (b.page === "root") return browse.browseHomeNav(); // F154: "Browse", the Featured / New / Top 25 drop-down as its title
    if (b.page === "roulette") return roulette.nav();
    if (b.page === "categories") return { title: "All Categories" };
    if (b.page === "collection") return { title: collection(b.value).title, style: "plain" };
    if (b.page === "list") return { title: browseList(b.value).title, style: "plain" };
    if (b.page === "category") return { title: b.value || "Browse", style: "plain" };
    return browse.nav(route);
  }
  switch (route.path[0]) {
    case "credits": return { title: "Credits" };
    case "guides": return guides.nav(route, guidesLite()); // F157
    case "help": return { title: "Help" };
    case "featured": return { title: "Featured" };
    case "sources": return { title: "More Sources" };
    case "wishlist": return route.path.length === 1 ? { title: "Wish List", style: "plain" } : browse.nav(route); // F102; F125 moved its row to Installed, the route stays for old links
  }
  return {
    title: "Cydian",
    back: "Home", // the back button above it reads Home, as Cydia's
    left: { label: "About", onClick: () => showAbout(ctx) },
    // F82 Reload, as Cydia's: the button turns into the small white spinner in its own spot while the sources and
    // Home's content reload, then back to Reload. The page keeps its content and swaps the new in place: no Loading
    // screen, no flash (it used to be location.reload()).
    right: { label: "Reload", onClick: (e) => reloadHome(e?.currentTarget, ctx) },
  };
}

// About, laid out like Cydia's on the 4S (ref/4s/screens/cydia-about.png): centred lines in groups with a blank line
// between them, and one wide Close button.
async function showAbout(ctx) {
  const version = (await globalThis.cydianNative?.call?.("app.info", {}).catch(() => null))?.version;
  await ctx.showAlert({
    title: "About Cydian",
    message: `${version ? `Version ${version}` : "Cydian Web"}\nFree and open source`
      + "\n\nRyan Hayden (Fizlo)\n\nInspired by Cydia\nby Jay Freeman (saurik)\nNot affiliated with SaurikIT",
    buttons: ["Close"],
  });
}

// ---- Reload (F82) -----------------------------------------------------------------------------------------

// The nav button while `work` runs: Cydia's small white spinner in the button's spot (home.css .is-reloading), not
// tappable; then the button again, whether `work` ended well or not. A tap while it spins does nothing (false).
export async function withReloadSpinner(button, work) {
  if (!button || button.classList.contains("is-reloading")) return false;
  const label = button.getAttribute("aria-label");
  button.classList.add("is-reloading");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Reloading");
  try {
    await work();
  } catch {
    // a source that failed shows on Sources and in the tile; the button still comes back
  } finally {
    button.classList.remove("is-reloading");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (label == null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", label);
  }
  return true;
}

// Resolves once no source is refreshing (screens/sources.js announce: globalThis.cydianRefreshing and the
// cydian:refreshing event), or after `ms` at most, so a refresh that never says it ended can't keep the spinner.
export function untilRefreshed(ms = 120000) {
  return new Promise((resolve) => {
    if (!(globalThis.cydianRefreshing > 0)) { resolve(); return; }
    let timer = null;
    const check = () => {
      if (globalThis.cydianRefreshing > 0) return;
      clearTimeout(timer);
      globalThis.removeEventListener?.("cydian:refreshing", check);
      resolve();
    };
    timer = setTimeout(() => { globalThis.removeEventListener?.("cydian:refreshing", check); resolve(); }, ms);
    globalThis.addEventListener?.("cydian:refreshing", check);
  });
}

// What Reload does, each step injectable for the test: refresh the sources (Settings' Refresh on Launch's way: the
// Sources tab's spinning badge, no HUD; when a refresh already runs, wait for that one), load the new package lists
// (new versions: Changes' badge and list), re-read dpkg in the app, look for Cydian's own update (app.js listens for
// cydian:reloaded, as a launch does), then redraw Home in place.
const loadNew = async () => {
  await catalog.ensure();
  if (catalog.statusSource() === "native") await catalog.reloadInstalled();
  globalThis.dispatchEvent?.(new Event("cydian:reloaded"));
};
// build.json (tools/buildinfo.sh), never from the browser's cache; null where there is none (a local checkout).
async function buildInfo(fetcher = globalThis.fetch) {
  try { const r = await fetcher("build.json", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}

// The website's Reload first re-downloads every file of the site (build.json lists them), which replaces whatever
// copy the browser kept, then loads the page again: a phone holding stale files gets the new version (user
// 2026-11-18). True when it reloaded the page.
export async function refreshWebFiles({ fetcher = globalThis.fetch, info = buildInfo, reloadPage = () => location.reload(), batch = 12 } = {}) {
  const b = await info(fetcher);
  if (!b?.files?.length) return false;
  for (let i = 0; i < b.files.length; i += batch) {
    await Promise.all(b.files.slice(i, i + batch).map((f) => fetcher(f, { cache: "reload" }).catch(() => null)));
  }
  reloadPage();
  return true;
}

export function reloadHome(button, ctx, { refresh = () => refreshInBackground(ctx), settled = untilRefreshed, reload = loadNew, redraw = () => state.redraw?.(),
  web = !globalThis.cydianNative } = {}) {
  if (web) return withReloadSpinner(button, async () => { if (!(await refreshWebFiles())) location.reload(); });
  return withReloadSpinner(button, async () => {
    if ((await refresh()) === "cancelled") return; // F150: the reload bar's Cancel stops the whole Reload
    await settled();
    await reload();
    await redraw();
  });
}

// F145: Home's root follows the website's lock (websign-gate.js setFirstVisit fires cydian:browse-lock): when it flips
// from what the page was drawn with, `redraw` draws it again, so no locked rows or padlocks stay after Browse Anyway
// (nor unlocked ones after Lock Home). Stops once `alive()` is false (the page is gone). -> a function that stops it.
export function followBrowseLock({ wasLocked, locked, alive = () => true, redraw, target = globalThis }) {
  const off = () => target.removeEventListener?.("cydian:browse-lock", on);
  function on() {
    if (!alive()) { off(); return; }
    if (locked() === wasLocked) return;
    off(); // the redrawn page follows with its own
    redraw();
  }
  target.addEventListener?.("cydian:browse-lock", on);
  return off;
}

// ---- state shared by the root page and the pages that change it ------------------------------------------

// redraw: set by the root page, Reload's in-place update of its content (renderRoot).
const state = { tile: null, seq: 0, redraw: null };

export function init() {
  // Sources tells when a refresh starts and each time one ends (screens/sources.js markLoading): repaint the tile.
  globalThis.addEventListener?.("cydian:refreshing", () => refreshState());
  // F96: no question at launch (user 2026-11-18); Home's rows below the Cydian App card are locked instead (renderRoot).
  // The root page stays in the stack while other tabs add or remove sources: look again whenever Home shows.
  globalThis.addEventListener?.("hashchange", () => {
    if (/^#\/home\/?$/.test(globalThis.location.hash)) refreshState();
  });
}

async function refreshState() {
  if (!state.tile) return;
  const seq = ++state.seq;
  let sources = [];
  let upgrades = null;
  try {
    const backend = getBackend();
    sources = await backend.sources();
    // No backend counts upgrades yet (it needs the installed list); the tile picks it up once one does.
    if (typeof backend.upgrades === "function") upgrades = (await backend.upgrades()).length ?? null;
  } catch {
    // a broken source store reads as no sources: the tile then offers to add one
  }
  // only the sources this device type shows (Not Jailbroken hides APT ones, and their errors with them)
  const shown = sourcesFor(sources, settings.deviceType()).shown;
  if (seq === state.seq) paintTile(stateTile({ sources: shown, upgrades, refreshing: globalThis.cydianRefreshing ?? 0 }));
}

function paintTile(t) {
  const a = state.tile;
  if (!a) return;
  a.href = t.href;
  a.dataset.state = t.kind;
  a.querySelector(".cell-label").textContent = t.label;
  a.querySelector(".cell-icon").className = "cell-icon home-glyph glyph-" + t.kind;
}

// ---- DOM -------------------------------------------------------------------------------------------------

// A page's content in one wrapper: the first child of a page stretches past its height (ios6.css rubber band), so
// a bare list of groups would push every group after the first off the screen.
function wrap(frag) {
  const d = el("div");
  d.append(frag);
  return d;
}

// One tile: a cell link with a glyph, a bold label and the chevron. External links open in a new tab.
function tile({ label, href, glyph, external = false, subtitle = null }) {
  const li = el("li", "cell");
  const a = el("a", "cell-inner chevron home-tile");
  a.href = href;
  if (external) { a.target = "_blank"; a.rel = "noopener"; }
  a.append(el("span", "cell-icon home-glyph glyph-" + glyph));
  if (subtitle) {
    const text = el("span", "home-tile-text");
    text.append(el("span", "cell-label", label), el("span", "cell-subtitle", subtitle));
    a.append(text);
  } else a.append(el("span", "cell-label", label));
  li.append(a);
  return li;
}

function tileRow(cls, ...tiles) {
  const row = el("div", "home-row " + cls);
  if (cls.split(" ").includes("stack")) { // one table, the tiles as full-width rows under each other
    const ul = el("ul", "table grouped home-tiles home-stack");
    ul.append(...tiles);
    row.append(ul);
  } else if (cls === "pair") {
    const ul = el("ul", "table home-pair");
    ul.append(...tiles);
    row.append(ul);
  } else {
    for (const t of tiles) {
      const ul = el("ul", "table grouped home-tiles");
      ul.append(t);
      row.append(ul);
    }
  }
  return row;
}

function renderRoot(body) {
  const home = el("div", "home");
  const head = el("div", "home-head");
  const icon = el("img", "home-icon");
  // The website shows its WEB icon (the home-screen one), so it's never taken for the app (user 2026-11-18).
  // The sideload app shows its LITE icon (its Home Screen icon), the jailbreak app the plain one.
  const g = !globalThis.cydianNative ? "icon-web-glossy" : settings.mode === "sideload" ? "icon-lite-glossy" : "icon-glossy";
  icon.src = `icons/${g}-76.png`;
  icon.srcset = `icons/${g}-76.png 1x, icons/${g}-152.png 2x, icons/${g}-228.png 3x`;
  icon.width = icon.height = 76;
  icon.alt = "";
  const words = el("div", "home-words");
  const title = el("h2", "home-title", "Welcome to Cydian");
  words.append(title);
  const by = el("p", "home-by", "by ");
  const who = el("a", null, "Ryan Hayden (Fizlo)"); // as Cydia's "Jay Freeman (saurik)"
  who.href = REPO_URL;
  who.target = "_blank";
  who.rel = "noopener";
  by.append(who);
  words.append(by);
  head.append(icon, words);
  const hintBox = el("div", "home-hint-box");
  const drawHint = () => {
    const h = deviceHint(settings.deviceType(), settings.mode);
    if (!h) { hintBox.replaceChildren(); return; }
    const a = el("a", "home-hint", h.text);
    a.href = h.href;
    hintBox.replaceChildren(a);
  };
  // Themes beside Featured when jailbroken; while Not Jailbroken (F41) a Signing tile takes its place, the way to
  // the user's own certificate (Settings > Signing), in the sideload app and on the website (F93).
  const halves = tileRow("halves",
    tile({ label: "Featured", href: format({ tab: "home", path: ["browse", "popular"] }), glyph: "featured" }), // Popular, not every package
    tile({ label: "Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }), glyph: "themes" }),
    tile({ label: "Signing", href: format(settingsRoute(["signing"])), glyph: "signing" }));
  let setUp = true; // hidden until signingSetUp answers: no tile flashing in and out once it is set up
  const drawThemes = () => {
    const themes = showsThemes(settings.deviceType());
    halves.children[1].hidden = !themes;
    halves.children[2].hidden = themes || !showsSigningTile(settings.mode, setUp);
    for (const row of lockedTop) row.hidden = !showsSigningTile(settings.mode, setUp);
  };
  // Asked again each time Home's root comes back (Settings > Signing is on Home's stack: Back from it lands here).
  const checkSigning = async () => {
    if (!showsSigningTile(settings.mode)) return;
    const now = await signingSetUp(settings.mode);
    if (now !== setUp && halves.isConnected) { setUp = now; drawThemes(); }
  };
  const onHash = () => {
    if (!halves.isConnected) { removeEventListener("hashchange", onHash); return; }
    if (/^#\/home\/?$/.test(location.hash)) checkSigning();
  };
  addEventListener("hashchange", onHash);
  const lockedNow = browsingLocked({ mode: settings.mode });
  const lockedTop = lockedNow ? [tileRow("halves", tile({ label: "Signing", href: format(settingsRoute(["signing"])), glyph: "signing" }))] : [];
  drawHint();
  drawThemes();
  checkSigning();
  const offHint = settings.onChange((key) => {
    if (key !== "device") return;
    if (!hintBox.isConnected) { offHint(); return; }
    drawHint();
    drawThemes();
    drawApp();
  });

  // Install Cydian App, full width under Featured | Signing, on the website only (I7, core/appoffer.js homeOffer):
  // Not Jailbroken, the sideload build signed in the browser with the user's own certificate (F93, installApp), or
  // Settings > Signing first when there's none; jailbroken, the release's .deb for the device's arch.
  // One green split button (user 2026-11-17): Install Cydian App | Send Settings (Open in Cydian App: the
  // certificate, sources and settings into the app).
  // The website: jailbroken visitors get Cydian from its own APT repo (Sileo, Zebra) or as a .deb (user 2026-11-18).
  // Its own purple tile (user 2026-11-18): the full Cydian, for a jailbroken phone, from Cydian's APT repo or a .deb.
  const debTile = settings.mode === "site" ? tile({ label: "Install Full Cydian", subtitle: "Jailbroken: tweaks, themes and apt",
    href: format({ tab: "home" }), glyph: "jailbreak" }) : null;
  debTile?.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); jailbrokenSheet(); }, true);
  const appRow = tileRow("green stack", tile({ label: "Install Cydian App", subtitle: "Signed with your certificate",
    href: format(settingsRoute(["signing"])), glyph: "install" }));
  // No Send Settings to Cydian (user 2026-11-18): Install Cydian App already carries the certificate and settings.
  const debRow = debTile ? tileRow("purple", debTile) : null;
  const appLink = appRow.querySelector("a");
  const appSub = appLink.querySelector(".cell-subtitle");
  let offer = null;
  appLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!offer) return;
    installCydian({ offer });
  }, true);
  const drawApp = () => {
    const type = settings.deviceType();
    offer = homeOffer({ mode: settings.mode, deviceType: type });
    appRow.hidden = !offer;
    if (appSub) appSub.textContent = offer?.action === "deb" ? "The .deb for your jailbreak" : "Signed with your certificate";
  };
  drawApp();

  // F46: Browse, under Featured and Themes. F124: a row of its own, full width and taller, with what it holds
  // (user 2026-11-18: "browse should be bigger"); F79's Install IPAs, which sat beside it, gets its own row below.
  const ipas = ipasTile(settings.mode);
  const browseRow = tileRow("stack browse", tile({ label: "Browse", subtitle: BROWSE_SUBTITLE,
    href: format({ tab: "home", path: ["browse"] }), glyph: "browse" }));
  const ipasRow = ipas ? tileRow("halves", tile({ label: ipas.label, href: ipas.href, glyph: "install" })) : null;

  const stateRow = tileRow("green", tile({ label: "", href: format({ tab: "sources" }), glyph: "loading" }));
  state.tile = stateRow.querySelector("a");
  paintTile(stateTile());
  // Locked Home (the website before Cydian is installed): Signing full width where Featured | Signing was, and
  // Featured down among the locked rows (user 2026-11-18). Ignore puts the usual row back.
  const lockedFeatured = lockedNow ? [tileRow("halves", tile({ label: "Featured", href: format({ tab: "home", path: ["browse", "popular"] }), glyph: "featured" }))] : [];
  if (lockedNow) halves.hidden = true;

  home.append(
    head,
    hintBox,
    tileRow("pair",
      tile({ label: "GitHub", href: REPO_URL, glyph: "github", external: true }),
      // Cydia's pair was Facebook | Twitter: here GitHub | Discord (the community)
      tile({ label: "Discord", href: DISCORD_URL, glyph: "discord", external: true })),
    halves,
    ...lockedTop,
    appRow,
    ...(debRow ? [debRow] : []),
    ...lockedFeatured,
    browseRow,
    ...(ipasRow ? [ipasRow] : []),
    stateRow,
  );
  body.append(home);
  // Cydia's list below the tiles: Settings (F135), the help links, User Guides, then Credits / Thank You (About is the nav button).
  const links = homeLinks();
  const list = grouped(links);
  const groups = [...list.children]; // the fragment empties once appended
  for (const group of groups) group.classList.add("home-links");
  home.append(list);
  // The website before Cydian is installed: everything below the Cydian App card is locked; a tap asks first. Not
  // Settings (F123: unlocked like Home, as its tab was), nor help, guides and credits (F156, lockHomeLinks).
  if (browsingLocked({ mode: settings.mode })) {
    const locked = [...lockedFeatured, browseRow, ...(ipasRow ? [ipasRow] : []), stateRow];
    for (const box of locked) box.classList.add("home-locked");
    lockHomeLinks(groups, links);
    askOnLocked(home, () => askToBrowse({ install: installCydian })); // Browse Anyway redraws Home (followBrowseLock below)
  }
  // F145: Browse Anyway (here, on a locked tab or in Settings) and Settings' Lock Home switch redraw Home at once.
  followBrowseLock({ wasLocked: lockedNow, locked: () => browsingLocked({ mode: settings.mode }), alive: () => home.isConnected,
    redraw: () => {
      const top = body.scrollTop;
      home.remove();
      renderRoot(body);
      body.scrollTop = top;
    } });
  // Cydia's line at the bottom of Home: the device, iOS, the installed version and the language
  // ("iPhone4,1, iOS 6.1.3, Cydia 1.1.9 (en-us)").
  const foot = el("p", "home-version", footLine({ ios: currentDevice().ios, web: !globalThis.cydianNative }));
  const commit = el("p", "home-version home-commit");
  home.append(foot, commit);
  globalThis.cydianNative?.call?.("app.info", {}).then((i) => { foot.textContent = footLine(i ?? {}); }, () => {});
  // The build under it (tools/buildinfo.sh's build.json, in the app's bundle and on the website): its commit, and on
  // the website the version it was deployed from.
  buildInfo().then((b) => {
    if (!b) return;
    commit.textContent = b.commit;
    if (!globalThis.cydianNative) foot.textContent = footLine({ ios: currentDevice().ios, version: b.version, web: true });
  });
  refreshState();
  // F82: Reload's redraw. Everything stays on screen; each part is updated where it is: the green tile and the
  // Install Cydian App offer at once.
  state.redraw = async () => {
    if (!home.isConnected) return;
    drawHint();
    drawThemes();
    drawApp();
    checkSigning();
    await refreshState();
  };
}

// The Home footer: "iPhone17,3, iOS 26.1, Cydian 0.1.1 (en-us)"; on the website "iPhone, iOS 26.1, Cydian Web (en-us)".
export function footLine({ machine = "", ios = "", version = "", web = false } = {}, lang = globalThis.navigator?.language ?? "en") {
  const app = web ? `Cydian Web${version ? ` ${version}` : ""}` : version ? `Cydian ${version}` : "Cydian Web";
  return [machine || "iPhone", ios ? `iOS ${ios}` : "", app].filter(Boolean).join(", ") + ` (${String(lang).toLowerCase()})`;
}

// Which Jailbreak's footer. F144: the sideload build lists apps only and has no Settings > Device, so it names no
// way to tweaks there; the website and the jailbreak app keep the Device hint.
export function helpJailbreakFooter(mode = "site") {
  if (mode === "sideload") {
    return "On a phone without a jailbreak Cydian lists apps from AltStore-style sources, signed and installed on "
      + "the phone. Tweaks and themes need a jailbroken iPhone and Cydian's jailbreak app.";
  }
  return "On a phone without a jailbreak Cydian lists apps from AltStore-style sources, installed with a "
    + "sideloader. Set Settings > Device to Jailbroken to list tweaks and themes built for rootless "
    + "(iphoneos-arm64), rootful (iphoneos-arm) or roothide (iphoneos-arm64e) jailbreaks. A package built for "
    + "another kind will not install.";
}

// Our own help page: what Cydian lists, for which jailbreaks, and how upgrades reach the phone.
function renderHelp(body) {
  body.append(wrap(grouped([
    {
      header: "Which Jailbreak",
      rows: [{ label: "Not Jailbroken", detail: "apps only" }, { label: "Rootless", detail: "iOS 15 and later" },
        { label: "Rootful", detail: "older, or palera1n" },
        { label: "Roothide", detail: "Dopamine roothide, Bootstrap" }],
      footer: helpJailbreakFooter(settings.mode),
    },
    {
      header: "Upgrading",
      rows: [{ label: "Check for Changes", href: format({ tab: "changes" }) }, { label: "Refresh Sources", href: format({ tab: "sources" }) }],
      footer: "Refresh in Sources fetches every source's package list again. Changes then shows what is new "
        + "or updated since the last refresh. Hold a package in Settings to keep it at its version.",
    },
    {
      header: "Jailbreaking",
      // ponytail: the site isn't up yet; drop "Coming Soon" once it is.
      rows: [{ label: "jailbreakme.dev", detail: "Coming Soon", chevron: true, onClick: () => window.open(JAILBREAK_INFO_URL, "_blank", "noopener") }],
      footer: "Which jailbreak works on your iPhone and iOS version, and how to run it.",
    },
    {
      header: "Before You Upgrade iOS",
      footer: "A jailbreak supports only the iOS versions it was made for. Check that one exists for the "
        + "version you are about to install, and keep a list of your packages so you can put them back.",
    },
  ])));
}

// Who Special Thanks thanks: [name, handle, their page, GitHub account for the picture, what for].
const THANKS = [
  ["Jay Freeman", "@saurik", "https://x.com/saurik", "saurik", "For Cydia, whose look and GPLv3 source Cydian follows."],
  ["Teehan+Lax", "@teehanlax", "https://x.com/teehanlax", "teehanlax", "For the iOS 6 GUI kit."],
  ["Riley Testut", "@rileytestut", "https://x.com/rileytestut", "rileytestut", "For AltStore and its source format."],
  ["Procursus", "GitHub", "https://github.com/ProcursusTeam", "ProcursusTeam", "For the bootstrap today's jailbreaks run on."],
  ["Dopamine", "@opa334dev", "https://x.com/opa334dev", "opa334", "opa334 and team, for the iOS 15 and 16 jailbreak."],
  ["palera1n", "@palera1n", "https://x.com/palera1n", "palera1n", "For the checkm8 jailbreak."],
  ["Calif", "@calif_io", "https://x.com/calif_io", "califio", "For the iOS 27.0.1 exploit."],
];

// Credits / Thank You (Cydia's credits.html: who it thanks), with what Cydian is and its version.
function renderCredits(body) {
  const rows = [{ label: "Version", detail: "Cydian Web" }, { label: "License", detail: "GPL-3.0+" },
    { label: "Source Code", detail: "GitHub", chevron: true, onClick: () => window.open(REPO_URL, "_blank", "noopener") }];
  body.append(wrap(grouped([
    { header: "Cydian", rows, footer: "A package manager with the iOS 6 look, for modern iPhones, by Ryan Hayden (Fizlo)." },
    {
      header: "Special Thanks",
      rows: THANKS.map(([label, handle, url, gh, why]) => ({
        label, subtitle: `${handle}\n${why}`, chevron: true, cls: "thanks-row",
        icon: { text: label.charAt(0), color: "#7a8a99", src: `https://github.com/${gh}.png?size=128` },
        onClick: () => window.open(url, "_blank", "noopener"),
      })),
      footer: "Cydian is not affiliated with SaurikIT or any of the above.",
    },
    { // F126: Cydia's artwork we use, with its licence
      header: "Artwork",
      rows: [{ label: "Section Icons", subtitle: "Jay Freeman (saurik)\nFrom Cydia, GPLv3", cls: "thanks-row",
        icon: { text: "C", color: "#7a8a99", src: "icons/sections/Tweaks.png" } }],
      footer: "Cydia's section icons and purpose badges, from its source at git.saurik.com/cydia.git.",
    },
  ])));
  globalThis.cydianNative?.call?.("app.info", {}).then((i) => {
    if (i?.version) body.querySelector(".cell-detail").textContent = i.version;
  }, () => {});
}

function renderFeatured(body) {
  body.append(grouped([{
    rows: [...(showsThemes(settings.deviceType()) ? [{ label: "Browse Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }) }] : []),
      { label: "All Packages", href: format({ tab: "sources", path: ["*", "section:*"] }) }],
    footer: "Featured packages appear here when your sources publish them.",
  }]));
}

// ---- Browse (F46) ----------------------------------------------------------------------------------------

// Browse's own page: F124's lists (New, Recently Updated, Popular, Featured, Free Apps / Tweaks / Themes), then the
// merged categories (core/catalog.js mergeCategories) with their counts. The catalog leaves Themes and Tweaks out
// while Settings > Device is Not Jailbroken, and so do the lists (browseListsFor).
// F154: Browse's page is browse.js renderBrowseHome now; this is its All Categories row's page: the categories first,
// then F124's lists. Placeholder rows while the catalog answers.
async function renderCategories(body) {
  const box = el("div");
  box.append(placeholder("page", 8));
  body.append(box);
  let cats;
  try {
    await catalog.ensure();
    cats = await catalog.categories();
  } catch (e) {
    box.replaceChildren(el("p", "empty", e.message));
    return;
  }
  const [lists, rest] = browseGroups(cats, { jailbroken: showsThemes(settings.deviceType()) });
  box.replaceChildren(grouped([rest, { ...lists, header: "Lists" }]));
}

// Home's Browse tile's second line.
export const BROWSE_SUBTITLE = "Featured, New, Top 25, Roulette";

// The groups of Browse's page for `cats` ([{ name, count }]): the lists (Free Tweaks and Themes only `jailbroken`),
// then the categories.
export function browseGroups(cats, { jailbroken = true } = {}) {
  const lists = { rows: browseListsFor(jailbroken).map((l) => ({ label: l.title, href: format({ tab: "home", path: ["browse", l.id] }) })),
    footer: `New and Recently Updated reach back ${FRESH_DAYS} days. Popular: what the most sources list.` };
  if (!cats.length) return [lists, { footer: "Add a source to browse its packages." }];
  return [lists, {
    header: "Categories",
    rows: cats.map((c) => ({ label: c.name, detail: String(c.count), href: format({ tab: "home", path: ["browse", `category:${c.name}`] }) })),
  }];
}

// F124: New and Recently Updated under a header per day, newest first (the Changes tab's day titles).
export function dayHeaders(rows, now = Date.now()) {
  const out = [];
  let day = null;
  for (const r of rows) {
    const d = dayOf(r.seen);
    if (d !== day) { day = d; out.push({ header: dayTitle(d, now) }); }
    out.push(r);
  }
  return out;
}

// F124, Featured: the sources' banners (sileo-featured.json), then the AltStore sources' featured apps.
async function featuredRows() {
  const [refs, sources] = await Promise.all([featuredRefs().catch(() => []), getBackend().sources().catch(() => [])]);
  const alts = await Promise.all(sources.filter((s) => isAltKey(s.key)).map((s) => catalog.altSource(s.key).catch(() => null)));
  const appRefs = alts.flatMap((a) => (a?.featured ?? []).map((r) => ({ key: r.key, id: r.id })));
  return catalog.featured([...refs, ...appRefs]);
}

// Each list's rows and how it reads (browse.js renderSearchableList).
const LIST_VIEW = {
  new: { rows: () => catalog.fresh("new"), headers: dayHeaders,
    empty: `Nothing new in the last ${FRESH_DAYS} days. Packages your sources add show up here after a refresh.` },
  updated: { rows: () => catalog.fresh("updated"), headers: dayHeaders,
    empty: `No updates in the last ${FRESH_DAYS} days. New versions show up here after a refresh.` },
  popular: { rows: () => catalog.popular() },
  featured: { rows: featuredRows, empty: "None of your sources features packages." },
  "free-apps": { rows: () => catalog.free("apps"), letters: true },
  "free-tweaks": { rows: () => catalog.free("tweaks"), letters: true },
  "free-themes": { rows: () => catalog.free("themes"), letters: true },
};

function renderBrowseRoute(body, route, ctx) {
  const b = browsePage(route.path);
  if (b.page === "root") {
    return browse.renderBrowseHome(body, route, { jailbroken: showsThemes(settings.deviceType()), featured: featuredRows, headers: dayHeaders });
  }
  if (b.page === "roulette") return roulette.render(body, route, { jailbroken: showsThemes(settings.deviceType()) });
  if (b.page === "categories") return renderCategories(body);
  if (b.page === "collection") {
    const c = collection(b.value);
    return browse.renderSearchableList(body, route, () => catalog.collection(c.id), { letters: true, label: `Search ${c.title}`,
      empty: `None of your sources' packages fit ${c.title} yet.` });
  }
  if (b.page === "list") {
    const v = LIST_VIEW[b.value];
    return browse.renderSearchableList(body, route, v.rows, { letters: Boolean(v.letters), headers: v.headers ?? null,
      empty: v.empty, label: `Search ${browseList(b.value).title}` });
  }
  if (b.page === "category") return browse.renderSearchableList(body, route, () => catalog.browse(b.value), { letters: true, label: `Search ${b.value}` });
  return browse.render(body, route, ctx);
}

// More Package Sources: one row per curated repo; a tap asks, checks the repo and adds it. Listed ones are ticked.
function renderSources(body, ctx) {
  const box = el("div");
  body.append(box);
  let busy = false;
  async function draw() {
    let have = new Set();
    try {
      have = new Set((await getBackend().sources()).map((s) => s.key));
    } catch {
      // no store: every source shows as addable
    }
    box.replaceChildren(grouped([{
      header: "Package Sources",
      rows: CURATED_SOURCES.map((s) => ({
        label: s.name,
        subtitle: s.blurb || s.uri,
        checked: have.has(s.key),
        icon: { text: s.name[0] },
        onClick: have.has(s.key) ? undefined : () => add(s),
      })),
      footer: "Tap a source to add it. Ticked sources are already in your list.",
    }]));
  }
  async function add(s) {
    if (busy) return;
    const { index } = await showAlert({ title: "Add Source", message: `${s.name}\n${s.uri}`, buttons: ["Cancel", "Add Source"], cancel: 0 });
    if (index !== 1) return;
    busy = true;
    const hide = ctx.showHUD("Verifying URL");
    let error = null;
    try {
      await getBackend().addSource(s.uri);
    } catch (e) {
      error = e;
    } finally {
      hide();
      busy = false;
    }
    if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    await draw();
    refreshState();
  }
  draw();
}

export function render(el, route, ctx) {
  switch (route.path[0]) {
    case "credits": return renderCredits(el);
    case "guides": guides.render(el, route, { lite: guidesLite() }); return; // F157
    case "help": return renderHelp(el);
    case "featured": return renderFeatured(el);
    case "sources": return renderSources(el, ctx);
    case "browse": return renderBrowseRoute(el, route, ctx);
    case "wishlist": return route.path.length === 1 ? browse.renderWishlist(el, route) : browse.render(el, route, ctx);
    default: return renderRoot(el);
  }
}

// I7: Cydian's .deb for a jailbroken visitor's arch: the latest release's asset for it (GitHub's API, which answers
// browsers), else the rootless Cydian.deb. Safari downloads it to Files, where Sileo or Filza installs it.
// "Jailbroken? Get Cydian.deb": Cydian's own APT repo (tools/release.sh: a flat repo beside each release's assets)
// added in Sileo or Zebra, which then keep Cydian updated; or the URL to paste elsewhere; or the .deb itself.
// B17: cydian.dev/repo/ (the Worker serves the release assets itself): GitHub's latest/download redirect ends at a
// signed URL too long for Zebra's cache file name.
export const CYDIAN_APT_REPO = "https://cydian.dev/repo/";
export const JAILBROKEN_SHEET = { title: "Install Cydian with your jailbreak's package manager: it keeps Cydian updated.",
  buttons: ["Add to Sileo", "Add to Zebra", "Copy Repo URL", "Download .deb"] };
const CYDIAN_PACKAGE = "com.ryha.cydian";
export const repoLinks = (repo = CYDIAN_APT_REPO, id = CYDIAN_PACKAGE) => ({
  sileo: `sileo://source/${repo}`, zebra: `zbra://sources/add/${repo}`,
  // their pages for a package, once the repo is there
  sileoPackage: `sileo://package/${id}`, zebraPackage: `zbra://packages/${id}` });

// Sileo and Zebra can't add a repo and open a package in one link: after Add to Sileo/Zebra, coming back here asks
// to open Cydian's page there (the alert's tap opens it, as Safari requires), so Get is one tap away (user 2026-11-18).
function offerPackageOnReturn(name, link) {
  let away = false;
  const onVis = async () => {
    if (document.visibilityState === "hidden") { away = true; return; }
    if (!away) return;
    document.removeEventListener("visibilitychange", onVis);
    await showAlert({ title: `Open Cydian in ${name}?`, message: `Cydian's repo is in ${name} now. Its page there has Get.`,
      buttons: ["Not Now", `Open in ${name}`], cancel: 0, colors: { 1: "green" },
      onTap: (i) => { if (i === 1) location.href = link; } });
  };
  document.addEventListener("visibilitychange", onVis);
}
async function jailbrokenSheet() {
  const { showActionSheet } = await import("../nav/actionsheet.js");
  const i = await showActionSheet(JAILBROKEN_SHEET);
  const links = repoLinks();
  if (i === 0) { offerPackageOnReturn("Sileo", links.sileoPackage); location.href = links.sileo; }
  else if (i === 1) { offerPackageOnReturn("Zebra", links.zebraPackage); location.href = links.zebra; }
  else if (i === 2) {
    try { await navigator.clipboard.writeText(CYDIAN_APT_REPO); } catch { /* shown below anyway */ }
    await showAlert({ title: "Repo URL Copied", message: CYDIAN_APT_REPO, buttons: ["OK"] });
  } else if (i === 3) {
    const { showActionSheet: pick } = await import("../nav/actionsheet.js");
    const kinds = [["Rootless (Dopamine, palera1n)", "iphoneos-arm64"], ["Roothide", "iphoneos-arm64e"], ["Rootful (checkra1n, older)", "iphoneos-arm"]];
    const k = await pick({ title: "Which jailbreak?", buttons: kinds.map(([l]) => l) });
    if (k >= 0) installDeb(kinds[k][1]);
  }
}

async function installDeb(arch) {
  let release = null;
  try { release = await fetchRelease(); } catch { /* the plain rootless .deb below */ }
  const url = debUrl(arch, { release, debFor });
  const { index } = await showAlert(debAlert(arch, url));
  if (url && index === 1) { markCydianInstalled(); location.href = url; } // F96: its download is as far as the website sees
}
