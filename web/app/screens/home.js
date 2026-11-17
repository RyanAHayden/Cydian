// Home tab, laid out like Cydia's on the 4S (ref/4s/screens/cydia-home.png; styles in home.css):
//   - Cydian's icon beside "Welcome to Cydian" and a by-line
//   - tile rows: GitHub | Sources as one outlined pair (Cydia: Facebook | Twitter), then Featured and Themes as two
//     white half-width tiles
//   - a full-width green tile for the current state (stateTile: Add a Source, n Upgrades Available, ...; Cydia's
//     Manage Account)
//   - a grouped list like Cydia's help links: Upgrading & Jailbreaking Help (our page), Find Extensions for
//     Applications (Search), More Package Sources (a curated list, one tap adds a source), About
// Every tile and row is a .cell-inner link, so it gets the table cells' held look (blue selection) from ios6.css
// and app.js. Featured banners from sources' sileo-featured.json go above the tiles once F20 lands.
//
// Routes below the tab: help, featured, sources (More Package Sources), about.
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { sourceKey } from "../core/sources.js";

export const title = "Home";

const REPO_URL = "https://github.com/RyanAHayden/Cydian";

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

export function nav(route, ctx) {
  switch (route.path[0]) {
    case "about": return { title: "About" };
    case "help": return { title: "Help" };
    case "featured": return { title: "Featured" };
    case "sources": return { title: "More Sources" };
  }
  return {
    title: "Cydian",
    left: { label: "About", onClick: () => showAbout(ctx) },
    // Reload, as on Cydia's Home: the Reloading Data HUD, then a fresh load of the app, which picks up newer
    // versions (the server sends every file with no-cache, so the phone re-checks each one).
    right: { label: "Reload", onClick: () => { ctx.showHUD("Reloading Data"); setTimeout(() => location.reload(), 350); } },
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

  const stateRow = tileRow("green", tile({ label: "", href: format({ tab: "sources" }), glyph: "loading" }));
  state.tile = stateRow.querySelector("a");
  paintTile(stateTile());

  home.append(
    head,
    tileRow("pair",
      tile({ label: "GitHub", href: REPO_URL, glyph: "github", external: true }),
      tile({ label: "Sources", href: format({ tab: "sources" }), glyph: "sources" })),
    tileRow("halves",
      tile({ label: "Featured", href: format({ tab: "home", path: ["featured"] }), glyph: "featured" }),
      tile({ label: "Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }), glyph: "themes" })),
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
      rows: [{ label: "Rootless", detail: "iOS 15 and later" }, { label: "Rootful", detail: "older, or palera1n" }],
      footer: "Cydian lists packages built for rootless jailbreaks (iphoneos-arm64) unless Settings says the "
        + "phone is rootful (iphoneos-arm). A package built for the other kind will not install.",
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
  body.append(grouped([{
    rows: [{ label: "Browse Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }) },
      { label: "All Packages", href: format({ tab: "sources", path: ["*", "section:*"] }) }],
    footer: "Featured packages appear here when your sources publish them.",
  }]));
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
    default: return renderRoot(el);
  }
}
