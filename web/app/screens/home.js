// Home tab, laid out like Cydia's on the 4S (ref/4s/screens/cydia-home.png; styles in home.css):
//   - Cydian's icon beside "Welcome to Cydian" and a by-line
//   - tile rows: GitHub | Sources as one outlined pair (Cydia: Facebook | Twitter), then Featured and Themes as two
//     white half-width tiles
//   - a full-width green tile for the current state (stateTile: Add a Source, n Upgrades Available, ...; Cydia's
//     Manage Account)
//   - a grouped list like Cydia's help links: Upgrading & Jailbreaking Help (our page), Find Extensions for
//     Applications (Search), More Package Sources (a curated list, one tap adds a source), About
// Every tile and row is a .cell-inner link, so it gets the table cells' held look (blue selection) from ios6.css
// and app.js. Featured banners from sources' sileo-featured.json sit above the tiles (F20, screens/extras.js).
//
// Routes below the tab: help, featured, sources (More Package Sources), about, and browse (F46): Browse's list
// (Popular, then the categories), browse/popular, browse/category:<name>, and below those browse.js's tokens
// (package:<id>, author:<name>, versions:<id>), as in the Search tab.
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { sourceKey, sourcesFor } from "../core/sources.js";
import { settings } from "./settings.js";
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { currentDevice } from "../device.js";
import { signAndInstall, signingReady, getBring } from "../signing-client.js";
import { homeFeatured } from "./extras.js";
import { homeOffer, debUrl, debAlert, APP_LABEL, APP_NAME, REPO_URL, APP_IPA_URL } from "../core/appoffer.js";
import { fetchRelease, debFor } from "../core/selfupdate.js";
import { refreshInBackground } from "./sources.js";

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
export function ipasTile(mode = "site") {
  if (mode === "jailbreak") return null;
  return { label: "Install IPAs", href: format({ tab: "installed", path: ["myipas"] }) };
}

// F37: the one-line hint Home shows while Settings > Device is Not Jailbroken, or null. `type` is deviceType().
export const DEVICE_HINT = "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device.";
export function deviceHint(type, mode = "site") {
  if (type !== "none") return null;
  // The sideload build is always Not Jailbroken: nothing to change there, so no hint.
  if (mode === "sideload") return null;
  return { text: DEVICE_HINT, href: format({ tab: "settings", path: ["device"] }) };
}

// F41: whether Home offers Themes (the tile, Featured's Browse Themes). Not Jailbroken lists apps only (F37).
export const showsThemes = (type) => type !== "none";

// F46: what a route under browse/ shows: { page: "root" | "popular" | "category" | "package" (browse.js's own
// pages, below a list), value }.
export function browsePage(path) {
  if (path.length === 1) return { page: "root" };
  if (path.length === 2 && path[1] === "popular") return { page: "popular" };
  if (path.length === 2 && path[1].startsWith("category:")) return { page: "category", value: path[1].slice(9) };
  return { page: "browse" };
}

export function nav(route, ctx) {
  if (route.path[0] === "browse") {
    const b = browsePage(route.path);
    if (b.page === "root") return { title: "Browse" };
    if (b.page === "popular") return { title: "Popular", style: "plain" };
    if (b.page === "category") return { title: b.value || "Browse", style: "plain" };
    return browse.nav(route);
  }
  switch (route.path[0]) {
    case "about": return { title: "About" };
    case "help": return { title: "Help" };
    case "featured": return { title: "Featured" };
    case "sources": return { title: "More Sources" };
  }
  return {
    title: "Cydian",
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
  await ctx.showAlert({
    title: "About Cydian",
    message: "Version 0.1\nFree and open source\n\nRyan Hayden (Fizlo)\n\nInspired by Cydia\nby Jay Freeman (saurik)\nNot affiliated with SaurikIT",
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
// Sources tab's spinning badge, no HUD; when a refresh already runs, wait for that one), then redraw Home in place.
export function reloadHome(button, ctx, { refresh = () => refreshInBackground(ctx), settled = untilRefreshed, redraw = () => state.redraw?.() } = {}) {
  return withReloadSpinner(button, async () => {
    await refresh();
    await settled();
    await redraw();
  });
}

// ---- state shared by the root page and the pages that change it ------------------------------------------

// redraw: set by the root page, Reload's in-place update of its content (renderRoot).
const state = { tile: null, seq: 0, redraw: null };

export function init() {
  // Sources tells when a refresh starts and each time one ends (screens/sources.js markLoading): repaint the tile.
  globalThis.addEventListener?.("cydian:refreshing", () => refreshState());
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

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
  icon.src = "icons/icon-glossy-76.png";
  icon.srcset = "icons/icon-glossy-76.png 1x, icons/icon-glossy-152.png 2x, icons/icon-glossy-228.png 3x";
  icon.width = icon.height = 76;
  icon.alt = "";
  const words = el("div", "home-words");
  words.append(el("h2", "home-title", "Welcome to Cydian"));
  const by = el("p", "home-by", "by ");
  const who = el("a", null, "Ryan Hayden (Fizlo)"); // as Cydia's "Jay Freeman (saurik)"
  who.href = REPO_URL;
  who.target = "_blank";
  who.rel = "noopener";
  by.append(who);
  words.append(by);
  // A nod to the original, in the by-line's own style (the "not affiliated" note is in About).
  const nod = el("p", "home-by home-nod", "inspired by ");
  const cydia = el("a", null, "saurik's Cydia");
  cydia.href = "https://cydia.saurik.com/";
  cydia.target = "_blank";
  cydia.rel = "noopener";
  nod.append(cydia);
  words.append(nod);
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
  // the user's own certificate (Settings > Signing), which is what installs apps without a jailbreak.
  const halves = tileRow("halves",
    tile({ label: "Featured", href: format({ tab: "home", path: ["browse", "popular"] }), glyph: "featured" }), // Popular, not every package
    tile({ label: "Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }), glyph: "themes" }),
    tile({ label: "Signing", href: format({ tab: "settings", path: ["signing"] }), glyph: "signing" }));
  const drawThemes = () => {
    const themes = showsThemes(settings.deviceType());
    halves.children[1].hidden = !themes;
    halves.children[2].hidden = themes;
  };
  drawHint();
  drawThemes();
  const offHint = settings.onChange((key) => {
    if (key !== "device") return;
    if (!hintBox.isConnected) { offHint(); return; }
    drawHint();
    drawThemes();
    drawApp();
  });

  // Install Cydian App, full width under Featured | Signing, on the website only (I7, core/appoffer.js homeOffer):
  // Not Jailbroken, the sideload build (I2) signed with the user's own certificate through the signing server, or
  // Settings > Signing first when there's none; jailbroken, the release's .deb for the device's arch.
  // One green split button (user 2026-11-17): Install Cydian App | Send Settings (Open in Cydian App: the certificate,
  // sources and settings into the app).
  const sendTile = tile({ label: "Send Settings to App", subtitle: "Your certificate, sources and settings", href: format({ tab: "home" }), glyph: "send" });
  const appRow = tileRow("green stack", tile({ label: "Install Cydian App", subtitle: "Signed with your certificate",
    href: format({ tab: "settings", path: ["signing"] }), glyph: "install" }), sendTile);
  const appLink = appRow.querySelector("a");
  let offer = null;
  appLink.addEventListener("click", (e) => {
    // decided synchronously from the last known state, so the link's default (Signing) and the install never both run
    if (!offer || offer.action === "signing") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (offer.action === "install") signAndInstall({ url: APP_IPA_URL, name: APP_NAME, bring: getBring() }); // F75
    else installDeb(offer.arch);
  }, true);
  // F75: Send Settings (Open in Cydian App), the split button's right half (the website, not jailbroken).
  const openRow = sendTile;
  openRow.querySelector("a").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    import("./importlink.js").then((m) => m.openInApp());
  }, true);
  const drawApp = () => {
    const type = settings.deviceType();
    offer = homeOffer({ mode: settings.mode, deviceType: type, certificate: false });
    appRow.hidden = !offer;
    openRow.hidden = !(settings.mode === "site" && type === "none");
    if (!offer || offer.action === "deb") return;
    signingReady().then((ok) => {
      offer = homeOffer({ mode: settings.mode, deviceType: settings.deviceType(), certificate: ok });
    });
  };
  drawApp();
  // Back from Settings > Signing with a certificate set: the tile installs now.
  const onShow = () => {
    if (!appRow.isConnected) { removeEventListener("hashchange", onShow); return; }
    if (/^#\/home\/?$/.test(location.hash)) drawApp();
  };
  addEventListener("hashchange", onShow);

  // F46: Browse, full width under Featured and Themes.
  // F79: Install IPAs beside it, where the build has the page.
  const ipas = ipasTile(settings.mode);
  const browseRow = tileRow("halves", tile({ label: "Browse", href: format({ tab: "home", path: ["browse"] }), glyph: "browse" }),
    ...(ipas ? [tile({ label: ipas.label, href: ipas.href, glyph: "install" })] : []));

  const stateRow = tileRow("green", tile({ label: "", href: format({ tab: "sources" }), glyph: "loading" }));
  state.tile = stateRow.querySelector("a");
  paintTile(stateTile());
  const featured = { box: homeFeatured() }; // F20: sources' sileo-featured.json banners, a couple from each

  home.append(
    head,
    hintBox,
    featured.box,
    tileRow("pair",
      tile({ label: "GitHub", href: REPO_URL, glyph: "github", external: true }),
      // Cydia's pair was Facebook | Twitter: here GitHub | Discord (the community)
      tile({ label: "Discord", href: DISCORD_URL, glyph: "discord", external: true })),
    halves,
    appRow,
    browseRow,
    stateRow,
  );
  body.append(home);
  const list = grouped([{
    rows: [
      { label: "Upgrading & Jailbreaking Help", href: format({ tab: "home", path: ["help"] }) },
      { label: "Find Extensions for Applications", href: format({ tab: "search" }), chevron: true },
      { label: "More Package Sources", href: format({ tab: "home", path: ["sources"] }) },
      { label: "About", href: format({ tab: "home", path: ["about"] }) },
    ],
  }]);
  const group = list.firstChild;
  group.classList.add("home-links");
  home.append(list);
  // Cydia's line at the bottom of Home: the device, iOS, the installed version and the language
  // ("iPhone4,1, iOS 6.1.3, Cydia 1.1.9 (en-us)").
  const foot = el("p", "home-version", footLine({ ios: currentDevice().ios }));
  home.append(foot);
  globalThis.cydianNative?.call?.("app.info", {}).then((i) => { foot.textContent = footLine(i ?? {}); }, () => {});
  refreshState();
  // F82: Reload's redraw. Everything stays on screen; each part is updated where it is: the green tile and the
  // Install Cydian App offer at once, the featured banners swapped for the new ones only once those are drawn.
  state.redraw = async () => {
    if (!home.isConnected) return;
    drawHint();
    drawThemes();
    drawApp();
    await refreshState();
    const box = homeFeatured();
    await box.ready; // extras.js homeFeatured: its banners are drawn (or there are none)
    if (featured.box.isConnected) featured.box.replaceWith(box);
    featured.box = box;
  };
}

// The Home footer: "iPhone17,3, iOS 26.1, Cydian 0.1.1 (en-us)"; on the website "iPhone, iOS 26.1, Cydian Web (en-us)".
export function footLine({ machine = "", ios = "", version = "" } = {}, lang = globalThis.navigator?.language ?? "en") {
  const app = version ? `Cydian ${version}` : "Cydian Web";
  return [machine || "iPhone", ios ? `iOS ${ios}` : "", app].filter(Boolean).join(", ") + ` (${String(lang).toLowerCase()})`;
}

// Our own help page: what Cydian lists, for which jailbreaks, and how upgrades reach the phone.
function renderHelp(body) {
  body.append(wrap(grouped([
    {
      header: "Which Jailbreak",
      rows: [{ label: "Not Jailbroken", detail: "apps only" }, { label: "Rootless", detail: "iOS 15 and later" },
        { label: "Rootful", detail: "older, or palera1n" },
        { label: "Roothide", detail: "Dopamine roothide, Bootstrap" }],
      footer: "On a phone without a jailbreak Cydian lists apps from AltStore-style sources, installed with a "
        + "sideloader. Set Settings > Device to Jailbroken to list tweaks and themes built for rootless "
        + "(iphoneos-arm64), rootful (iphoneos-arm) or roothide (iphoneos-arm64e) jailbreaks. A package built for "
        + "another kind will not install.",
    },
    {
      header: "Upgrading",
      rows: [{ label: "Check for Changes", href: format({ tab: "changes" }) }, { label: "Refresh Sources", href: format({ tab: "sources" }) }],
      footer: "Refresh in Sources fetches every source's package list again. Changes then shows what is new "
        + "or updated since the last refresh. Hold a package in Settings to keep it at its version.",
    },
    {
      header: "Before You Upgrade iOS",
      footer: "A jailbreak supports only the iOS versions it was made for. Check that one exists for the "
        + "version you are about to install, and keep a list of your packages so you can put them back.",
    },
  ])));
}

function renderFeatured(body) {
  body.append(homeFeatured()); // F20
  body.append(grouped([{
    rows: [...(showsThemes(settings.deviceType()) ? [{ label: "Browse Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }) }] : []),
      { label: "All Packages", href: format({ tab: "sources", path: ["*", "section:*"] }) }],
    footer: "Featured packages appear here when your sources publish them.",
  }]));
}

// ---- Browse (F46) ----------------------------------------------------------------------------------------

// Browse's own page: Popular, then the merged categories (core/catalog.js mergeCategories) with their counts. The
// catalog leaves Themes and Tweaks out while Settings > Device is Not Jailbroken.
async function renderBrowse(body) {
  const box = el("div");
  const spin = el("div", "loading");
  spin.append(el("span", "loading-spinner"), el("span", null, "Loading Packages"));
  box.append(spin);
  body.append(box);
  let cats;
  try {
    await catalog.ensure();
    cats = await catalog.categories();
  } catch (e) {
    box.replaceChildren(el("p", "empty", e.message));
    return;
  }
  box.replaceChildren(grouped(browseGroups(cats)));
}

// The groups of Browse's page for `cats` ([{ name, count }]).
export function browseGroups(cats) {
  const popular = { rows: [{ label: "Popular", href: format({ tab: "home", path: ["browse", "popular"] }) }],
    footer: "Packages the most sources list, then the newest updates." };
  if (!cats.length) return [popular, { footer: "Add a source to browse its packages." }];
  return [popular, {
    header: "Categories",
    rows: cats.map((c) => ({ label: c.name, detail: String(c.count), href: format({ tab: "home", path: ["browse", `category:${c.name}`] }) })),
  }];
}

function renderBrowseRoute(body, route, ctx) {
  const b = browsePage(route.path);
  if (b.page === "root") return renderBrowse(body);
  if (b.page === "popular") return browse.renderList(body, route, () => catalog.popular(), false);
  if (b.page === "category") return browse.renderList(body, route, () => catalog.browse(b.value), true);
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
    case "about":
      el.append(wrap(grouped([
        { header: "Cydian", rows: [{ label: "Version", detail: "0.1" }, { label: "License", detail: "GPL-3.0+" }] },
        { rows: [{ label: "Source Code", detail: "GitHub", onClick: () => window.open(REPO_URL, "_blank", "noopener") }] },
        { footer: "A package manager with the iOS 6 look, for modern iPhones." },
      ])));
      return;
    case "help": return renderHelp(el);
    case "featured": return renderFeatured(el);
    case "sources": return renderSources(el, ctx);
    case "browse": return renderBrowseRoute(el, route, ctx);
    default: return renderRoot(el);
  }
}

// I7: Cydian's .deb for a jailbroken visitor's arch: the latest release's asset for it (GitHub's API, which answers
// browsers), else the rootless Cydian.deb. Safari downloads it to Files, where Sileo or Filza installs it.
async function installDeb(arch) {
  let release = null;
  try { release = await fetchRelease(); } catch { /* the plain rootless .deb below */ }
  const url = debUrl(arch, { release, debFor });
  const { index } = await showAlert(debAlert(arch, url));
  if (url && index === 1) location.href = url;
}
