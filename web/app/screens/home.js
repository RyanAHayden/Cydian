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
import { sourceKey } from "../core/sources.js";
import { settings } from "./settings.js";
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { signAndInstall, signingAvailable, signingReady } from "../signing-client.js";
import { homeFeatured } from "./extras.js";

export const title = "Home";

const REPO_URL = "https://github.com/RyanAHayden/Cydian";
// The sideload build, published as a release asset (native/build.sh makes it).
const APP_IPA_URL = `${REPO_URL}/releases/latest/download/Cydian.ipa`;

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
export function stateTile({ sources = null, upgrades = null } = {}) {
  if (sources == null) return { kind: "loading", label: "Loading Sources", href: format({ tab: "sources" }) };
  if (!sources.length) return { kind: "add", label: "Add a Source", href: format({ tab: "home", path: ["sources"] }) };
  if (upgrades > 0) {
    return { kind: "upgrades", label: `${upgrades} ${upgrades === 1 ? "Upgrade" : "Upgrades"} Available`, href: format({ tab: "changes" }) };
  }
  const failed = sources.filter((s) => s.error).length;
  if (failed) {
    return { kind: "failed", label: `${failed} ${failed === 1 ? "Source" : "Sources"} Failed to Load`, href: format({ tab: "sources" }) };
  }
  if (upgrades === 0) return { kind: "current", label: "Everything Up to Date", href: format({ tab: "changes" }) };
  return { kind: "changes", label: "See What's New", href: format({ tab: "changes" }) };
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
    // Reload: a fresh load of the app straight away (the loading screen shows while it comes back), which picks up
    // newer versions: the server sends every file with no-cache. (The HUD first could freeze the Home Screen app.)
    right: { label: "Reload", onClick: () => location.reload() },
  };
}

// About, laid out like Cydia's on the 4S (ref/4s/screens/cydia-about.png): centred lines in groups with a blank line
// between them, and one wide Close button.
async function showAbout(ctx) {
  await ctx.showAlert({
    title: "About Cydian",
    message: "Version 0.1\nFree and open source\n\nRyan Hayden\n\nInspired by Cydia\nby Jay Freeman (saurik)\nNot affiliated with SaurikIT",
    buttons: ["Close"],
  });
}

// ---- state shared by the root page and the pages that change it ------------------------------------------

const state = { tile: null, seq: 0 };

export function init() {
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
  if (seq === state.seq) paintTile(stateTile({ sources, upgrades }));
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
function tile({ label, href, glyph, external = false }) {
  const li = el("li", "cell");
  const a = el("a", "cell-inner chevron home-tile");
  a.href = href;
  if (external) { a.target = "_blank"; a.rel = "noopener"; }
  a.append(el("span", "cell-icon home-glyph glyph-" + glyph), el("span", "cell-label", label));
  li.append(a);
  return li;
}

function tileRow(cls, ...tiles) {
  const row = el("div", "home-row " + cls);
  if (cls === "pair") {
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
  const who = el("a", null, "Ryan Hayden");
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
    tile({ label: "Featured", href: format({ tab: "home", path: ["featured"] }), glyph: "featured" }),
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

  // Install Cydian App, full width under Featured | Signing, on the website while Not Jailbroken: the sideload build
  // (I2), signed with the user's own certificate through the signing server. Without a certificate it opens Settings
  // > Signing first. (Install on a jailbroken phone, the .deb, is I7.)
  const appRow = tileRow("halves", tile({ label: "Install Cydian App", href: format({ tab: "settings", path: ["signing"] }), glyph: "install" }));
  const appLink = appRow.querySelector("a");
  appLink.addEventListener("click", (e) => {
    // decided synchronously from the last known state, so the link's default (Signing) and the install never both run
    if (!appLink.dataset.ready) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    signAndInstall({ url: APP_IPA_URL, name: "Cydian" });
  }, true);
  const drawApp = () => {
    appRow.hidden = showsThemes(settings.deviceType()) || !signingAvailable();
    signingReady().then((ok) => { if (ok) appLink.dataset.ready = "1"; else delete appLink.dataset.ready; });
  };
  drawApp();
  // Back from Settings > Signing with a certificate set: the tile installs now.
  const onShow = () => {
    if (!appRow.isConnected) { removeEventListener("hashchange", onShow); return; }
    if (/^#\/home\/?$/.test(location.hash)) drawApp();
  };
  addEventListener("hashchange", onShow);

  // F46: Browse, full width under Featured and Themes.
  const browseRow = tileRow("halves", tile({ label: "Browse", href: format({ tab: "home", path: ["browse"] }), glyph: "browse" }));

  const stateRow = tileRow("green", tile({ label: "", href: format({ tab: "sources" }), glyph: "loading" }));
  state.tile = stateRow.querySelector("a");
  paintTile(stateTile());

  home.append(
    head,
    hintBox,
    homeFeatured(), // F20: sources' sileo-featured.json banners, a couple from each
    tileRow("pair",
      tile({ label: "GitHub", href: REPO_URL, glyph: "github", external: true }),
      tile({ label: "Sources", href: format({ tab: "sources" }), glyph: "sources" })),
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
  refreshState();
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
