// F77: My IPAs, under Installed (#/installed/myipas): the user's own IPAs, signed with their certificate.
// F79: the page is Install IPAs now, linked from Home (a tile) and Installed (its tile button): Browse first (the
// apps of the user's AltStore sources: Search, All Apps, then by category, browse.js's lists and app pages below),
// then My IPAs, the user's own. Add (nav bar) as before.
//
//   #/installed/myipas                      Install IPAs: Browse (grouped), then My IPAs: icon, name, version,
//                                           size and state; Add (nav bar) -> action sheet Files / From URL
//   #/installed/myipas/search               Search Apps: a search bar over the AltStore apps
//   #/installed/myipas/apps                 All Apps, A-Z
//   #/installed/myipas/category:<name>      one Browse category's apps (core/catalog.js browseCategory)
//   .../package:<id> and deeper             browse.js's pages (an app's page, Version History)
//   #/installed/myipas/ipa:<file>           an IPA's page, like a package page: header, Install (nav bar), Sign
//                                           Options, Sign Now, Save Signed IPA, details, Delete
//   #/installed/myipas/ipa:<file>/options   Sign Options: name, bundle ID, icon, extensions, arm64e fix-up
//
// In the sideload app the files live in iFizBox's Documents (Files > On My iPhone > iFizBox) and the shell signs them
// (signing-client.js libraryCall, native/Sources/MyIPAs.swift). On the website there is no signer on the phone:
// Add is Choose File (F197: the IPA is kept in this browser's IndexedDB and Install signs it here, signInBrowser with
// its bytes) or From URL; links are kept on this device, and a link's Install is an app page's (F95, user 2026-11-18: no
// Open in iFizBox / Get in AltStore / SideStore / Feather): it signs in the browser (F93), and until that lands it says
// the certificate is needed, with Download IPA (altstore.js siteCertificateAlert).
// Rules and labels: core/myipas.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, placeholder, el } from "../nav/ui.js";
import * as browse from "./browse.js";
import { catalog, ALL } from "../catalog.js";
import { mergeCategories, indexLetter } from "../core/catalog.js";
import { withLetterHeaders } from "../nav/vlist.js";
import { format, mounted, parse, settingsRoute } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showHUD } from "../nav/hud.js";
import { cleanSourceUrl } from "../core/sources.js";
import { detectMode } from "../core/settings.js";
import { deviceError, phaseLabel, isCgBI, fromBase64 } from "../core/signing.js";
import { apps, recordInstall } from "../core/installed.js";
import { MYIPAS, libraryRows, stateOf, formatBytes, ipaToken, fileOfToken, optionsParams, siteEntries, addSiteUrl,
  STATE_LABELS, addSiteFile, removeSiteEntry, openIpaStore, memoryIpaStore } from "../core/myipas.js";
import { readIpaFile } from "../core/ipainfo.js";
import { localSigning, libraryCall, installFromLibrary, signAndInstall } from "../signing-client.js";
import { siteCertificateAlert } from "./altstore.js";
import { NAME } from "../brand.js";

export { MYIPAS };

const view = { body: null, browse: null, route: null, seq: 0, browseSeq: 0 };
const known = new Map(); // file -> the last entry seen (titles, the page before its list call answers)

export const PAGE_TITLE = "Install IPAs";

// F79: Browse's own segments below the page: Search, All Apps, a category.
function browseSeg(seg) {
  if (seg === "search" || seg === "apps") return { page: seg };
  if (typeof seg === "string" && seg.startsWith("category:")) return { page: "category", value: seg.slice(9) };
  return null;
}

// Which page a route under Installed is: "list" (Install IPAs), "ipa", "options", F79's "search", "apps",
// "category" and "browse" (browse.js's pages below them), or null (not one of ours).
export function pageOf(route) {
  if (route.path[0] !== MYIPAS) return null;
  if (route.path.length === 1) return { page: "list" };
  const b = browseSeg(route.path[1]);
  if (b) return route.path.length === 2 ? b : { page: "browse" };
  const file = fileOfToken(route.path[1]);
  if (!file) return { page: "missing" };
  if (route.path.length === 2) return { page: "ipa", file };
  if (route.path.length === 3 && route.path[2] === "options" && localSigning()) return { page: "options", file };
  return { page: "missing" };
}

const site = () => !localSigning();

export function nav(route) {
  const p = pageOf(route);
  switch (p?.page) {
    case "list": return { title: PAGE_TITLE, right: { label: "Add", onClick: () => addMenu() } };
    case "search": return { title: "Search Apps", style: "plain" };
    case "apps": return { title: "All Apps", style: "plain" };
    case "category": return { title: p.value || "Apps", style: "plain" };
    case "browse": return browse.nav(route);
    case "ipa": return { title: known.get(p.file)?.name || p.file.replace(/\.ipa$/i, ""),
      right: { label: "Install", onClick: () => install(p.file) } };
    case "options": return { title: "Sign Options", right: { label: "Save", onClick: (e) => saveOptions(p.file, e.currentTarget) } };
    default: return { title: "Not Found" };
  }
}

let back = () => history.back();

export function render(body, route, ctx) {
  if (ctx?.back) back = ctx.back;
  style();
  const p = pageOf(route);
  if (p?.page === "list") {
    // One wrapper (the first child of a page stretches, ios6.css): Browse, then the library.
    const page = el("div", "install-ipas");
    view.browse = el("div", "install-ipas-browse");
    view.body = el("div", "install-ipas-mine");
    view.route = route;
    view.browse.append(grouped(browseGroups(null)));
    view.body.append(note("Loading"));
    // The search bar on top (user 2026-11-17): empty, Browse and My IPAs show; typed, every app on the sources.
    const results = el("div", "install-ipas-results");
    results.hidden = true;
    const hint = el("p", "empty search-note");
    const list = browse.packageList(results, route, [], { letters: false });
    results.append(hint, list.el);
    let seq = 0;
    const bar = searchBar("Search Apps", async (q) => {
      const mine = ++seq;
      results.hidden = !q;
      view.browse.hidden = view.body.hidden = Boolean(q);
      if (!q) return list.setItems([]);
      let rows;
      try { await catalog.ensure(); rows = appsOf(await catalog.search(q)); } catch (e) { if (mine === seq) hint.textContent = e.message; return; }
      if (mine !== seq) return;
      browse.rememberNames(rows);
      list.setItems(rows);
      hint.textContent = rows.length ? "" : "No Results";
    });
    page.append(bar, view.browse, view.body, results);
    body.append(page);
    markPlaceholders(view.browse);
    loadBrowse();
    load();
    return;
  }
  if (p?.page === "search") return renderSearch(body, route);
  if (p?.page === "apps") return renderFiltered(body, route, async () => appsOf(await catalog.list(ALL, ALL)), "Search All Apps");
  if (p?.page === "category") return renderFiltered(body, route, async () => appsOf(await catalog.browse(p.value)), `Search ${p.value}`);
  if (p?.page === "browse") return browse.render(body, route, ctx);
  if (p?.page === "ipa") return renderIpa(body, route, p.file);
  if (p?.page === "options") return renderOptions(body, route, p.file);
  body.append(note("Nothing here."));
}

let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  for (const f of ["../myipas.css", "../signsheet.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(f, import.meta.url).href;
    document.head.append(link);
  }
}

const note = (text) => el("p", "empty", text);
const go = (path) => { location.hash = format({ tab: "installed", path }).replace(/^#/, ""); };
const ipaPath = (file) => [MYIPAS, ipaToken(file)];

// ---- the library ----------------------------------------------------------------------------------------------

async function entries() {
  if (site()) return { ipas: siteEntries(), identity: false };
  return libraryCall("list", {});
}

function remember(list) {
  for (const e of list ?? []) known.set(e.file, e);
}

async function load() {
  const seq = ++view.seq;
  let r;
  try { r = await entries(); } catch (e) {
    if (seq === view.seq) view.body.replaceChildren(note(deviceError(e).message));
    return;
  }
  if (seq !== view.seq || !view.body) return;
  remember(r?.ipas);
  draw(r?.ipas ?? []);
}

function draw(list) {
  const body = view.body;
  const rows = libraryRows(list, { site: site() });
  const frag = grouped([{ header: "My IPAs", rows: rows.map((r) => ({
    label: r.title, subtitle: r.subtitle, icon: { text: r.title.charAt(0).toUpperCase() },
    href: format({ tab: "installed", path: ipaPath(r.file) }),
  })), footer: rows.length ? "" : libraryEmptyText(site()) }]);
  const cells = frag.querySelectorAll(".cell");
  rows.forEach((r, i) => {
    cells[i].classList.add("myipa-row", `is-${r.state.kind}`);
    putIcon(cells[i].querySelector(".cell-icon"), r.icon);
  });
  body.replaceChildren(frag);
}

export function libraryEmptyText(site) {
  return site
    ? `No IPAs yet. Tap Add to choose an IPA in Files (kept in this browser, signed here when you install it) or to keep a link to one: Install opens it in ${NAME}, AltStore, SideStore or Feather.`
    : `No IPAs yet. Tap Add to choose one in Files or download one, or put IPAs in Files under On My iPhone > ${NAME}.`;
}

// ---- F79: Browse, the apps of the user's AltStore sources ------------------------------------------------------

// The catalog's rows that are AltStore apps (core/catalog.js slim: kind "ipa"); APT packages stay out.
export const appsOf = (rows) => (rows ?? []).filter((r) => r?.kind === "ipa");

const browseHref = (seg) => format({ tab: "installed", path: [MYIPAS, seg] });

// Install IPAs' Browse groups for `apps` (AltStore app rows), or null while the catalog loads: Search and All Apps,
// then the categories with their counts. No apps: a line saying where they come from.
export function browseGroups(apps) {
  const top = []; // the page's search bar searches (Search Apps' own page stays for older links)
  // Still loading: the same shape with grey bars where the counts and categories go (myipas.css .ph), so the page
  // shows at once and fills in place (user 2026-11-17).
  if (apps == null) {
    const bar = { label: "\u00a0", detail: "\u00a0", chevron: false, placeholder: true };
    return [{ header: "Browse", rows: [...top, { label: "All Apps", detail: "\u00a0", chevron: false, placeholder: true }] },
      { rows: [bar, bar, bar, bar] }];
  }
  if (!apps.length) {
    return [{ header: "Browse", rows: top,
      footer: site() ? "Add an AltStore source in Sources to browse its apps here." : "Add an AltStore source in Sources to browse its apps here. Every app installs signed with your certificate." }];
  }
  return [
    { header: "Browse", rows: [...top, { label: "All Apps", detail: String(apps.length), href: browseHref("apps") }] },
    { rows: mergeCategories(apps, { jailbroken: false }).map((c) => ({ label: c.name, detail: String(c.count), href: browseHref(`category:${c.name}`) })),
      footer: site() ? "Apps from your AltStore sources." : "Apps from your AltStore sources, signed with your certificate when you install one." },
  ];
}

// grouped() has no row classes: the placeholder rows are the ones whose label is a lone no-break space.
function markPlaceholders(root) {
  for (const li of root.querySelectorAll(".cell")) {
    const label = li.querySelector(".cell-label")?.textContent;
    const detail = li.querySelector(".cell-detail")?.textContent;
    if (label === "\u00a0" || detail === "\u00a0") li.classList.add("ph");
  }
}

async function loadBrowse() {
  const seq = ++view.browseSeq;
  let apps;
  try {
    await catalog.ensure();
    apps = appsOf(await catalog.list(ALL, ALL));
  } catch (e) {
    if (seq === view.browseSeq && view.browse) view.browse.replaceChildren(grouped([{ header: "Browse", footer: e.message }]));
    return;
  }
  if (seq !== view.browseSeq || !view.browse) return;
  view.browse.replaceChildren(grouped(browseGroups(apps)));
}

// Search's bar (packages.css); onQuery(trimmed text) runs as the user types (debounced) and on Search.
function searchBar(placeholder, onQuery) {
  const bar = el("form", "search-bar");
  bar.setAttribute("role", "search");
  const field = el("label", "search-field");
  const input = Object.assign(el("input"), { type: "search", placeholder, autocomplete: "off", spellcheck: false });
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", placeholder);
  input.enterKeyHint = "search";
  field.append(input);
  bar.append(field);
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => onQuery(input.value.trim()), 120); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); onQuery(input.value.trim()); input.blur(); });
  return bar;
}

// All Apps and a category: their list with a search bar that narrows this list only.
export const matchApp = (r, q) => [r.name, r.short, r.author, r.id].some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase()));
async function renderFiltered(body, route, fetchRows, hint) { // hint: the search bar's (not "placeholder", the loading rows)
  const wait = placeholder("list");
  body.append(wait);
  let rows;
  try { await catalog.ensure(); rows = await fetchRows(); } catch (e) { wait.replaceWith(note(e.message)); return; }
  if (!rows.length) { wait.replaceWith(note("No apps.")); return; }
  wait.remove();
  const lettered = (list) => withLetterHeaders(list, (r) => indexLetter(r.name));
  const none = el("p", "empty", "No Results");
  none.hidden = true;
  const list = browse.packageList(body, route, rows, { letters: true });
  body.append(searchBar(hint, (q) => {
    const shown = q ? rows.filter((r) => matchApp(r, q)) : rows;
    list.setItems(q ? shown : lettered(shown));
    none.hidden = shown.length > 0;
  }), none, list.el);
}

// Search Apps (older links): Search's bar (packages.css) over the AltStore apps only, results as browse.js rows.
function renderSearch(body, route) {
  const bar = el("form", "search-bar");
  bar.setAttribute("role", "search");
  const field = el("label", "search-field");
  const input = Object.assign(el("input"), { type: "search", placeholder: "Search Apps", autocomplete: "off", spellcheck: false });
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search apps: name, description or developer");
  input.enterKeyHint = "search";
  field.append(input);
  bar.append(field);
  const hint = el("p", "empty search-note", "App names, descriptions and developers.");
  body.append(bar, hint);
  const list = browse.packageList(body, route, [], { letters: false });
  body.append(list.el);
  let seq = 0;
  let timer = 0;
  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) { list.setItems([]); hint.textContent = "App names, descriptions and developers."; return; }
    let rows;
    try {
      await catalog.ensure();
      rows = appsOf(await catalog.search(q));
    } catch (e) {
      if (mine === seq) hint.textContent = e.message;
      return;
    }
    if (mine !== seq) return;
    browse.rememberNames(rows);
    list.setItems(rows);
    hint.textContent = rows.length ? "" : "No Results";
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 120); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); input.blur(); });
  setTimeout(() => { if (input.isConnected) input.focus(); }, 350); // after the push animation
}

// An IPA's icon on a placeholder box (the letter stays under it): Apple's CgBI PNG doesn't draw in a browser, but the
// shell hands over plain PNGs (UIKit decodes CgBI).
function putIcon(box, b64) {
  if (!box || typeof b64 !== "string" || !b64) return;
  try { if (isCgBI(fromBase64(b64))) return; } catch { return; }
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  img.onerror = () => img.remove();
  img.src = `data:image/png;base64,${b64}`;
  box.append(img);
}

const refresh = () => { if (view.body?.isConnected) load(); };

// Sources refreshed or changed: Browse counts again.
catalog.onChange?.(() => { if (view.browse?.isConnected) loadBrowse(); });

export async function addMenu() {
  if (site()) {
    // F197: the picker opens from the sheet's tap (Safari opens a file input only inside the user's tap).
    const i = await showActionSheet({ buttons: ["Choose File", "From URL"] });
    if (i === 0) return chooseSiteFile();
    if (i === 1) return addFromUrl();
    return;
  }
  const i = await showActionSheet({ buttons: ["Files", "From URL"] }); // F79: Browse is the page's own section now
  if (i === 0) return pickFiles();
  if (i === 1) return addFromUrl();
}

async function pickFiles() {
  let r;
  try { r = await libraryCall("pick", {}); } catch (e) {
    await showAlert({ title: "Couldn't Add", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  remember(r?.ipas);
  if (view.body?.isConnected) draw(r?.ipas ?? []);
  if (r?.files?.length === 1) go(ipaPath(r.files[0]));
}

// ---- F197: the website's Choose File: an IPA from Files, kept in this browser -----------------------------------

let ipaStore = null;
const siteStore = () => (ipaStore ??= openIpaStore().catch(() => memoryIpaStore()));
// What this site may still keep (Safari's quota less what it uses), or null when the browser doesn't say.
const siteRoom = async () => {
  const est = await globalThis.navigator?.storage?.estimate?.();
  return est && Number.isFinite(est.quota) && Number.isFinite(est.usage) ? est.quota - est.usage : null;
};

function chooseSiteFile() {
  const input = Object.assign(el("input", "visually-hidden"), { type: "file", accept: ".ipa,application/octet-stream" });
  document.body.append(input);
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.remove();
    if (f) await addPickedFile(f);
  }, { once: true });
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.click();
}

// A picked File into My IPAs (the HUD while its Info.plist is read and its bytes stored), then its page.
export async function addPickedFile(file, { store, read = readIpaFile, room = siteRoom, alert = showAlert, hud = showHUD, open = go } = {}) {
  const hide = hud("Adding");
  let entry;
  try { entry = await addSiteFile(file, { store: store ?? (await siteStore()), read, room }); } catch (e) {
    hide();
    await alert({ title: "Couldn't Add", message: String(e?.message ?? e), buttons: ["OK"] });
    return null;
  }
  if (hide.done) hide.done("Added"); else hide();
  known.set(entry.file, entry);
  refresh();
  open(ipaPath(entry.file));
  return entry;
}

// Install for a kept IPA: signed in this browser from its bytes (no download), with the same early itms link,
// progress page, Cancel and upload as an app page's Install. Called inside Install's tap, nothing awaited before
// signInBrowser opens iOS's prompt; the bytes are read after.
export function siteFileInstall(entry, { store = siteStore, sign = signAndInstall, onInstalled = () => {} } = {}) {
  return sign({ name: entry.name || entry.file.replace(/\.ipa$/i, ""), bundleId: entry.bundleId || null, version: entry.version || "",
    bytes: async () => (await (typeof store === "function" ? store() : store)).get(entry.file), onInstalled });
}

// The Add alert as Sources has it: a URL field with Paste, cleaned up by cleanSourceUrl.
async function addFromUrl() {
  const { index, value } = await showAlert({
    title: "Enter IPA URL",
    message: site() ? "A link to an .ipa, kept on this iPhone. Install opens it in a sideloader." : `A link to an .ipa: ${NAME} downloads it into My IPAs.`,
    input: { placeholder: "https://", value: "https://", type: "url", paste: cleanSourceUrl },
    buttons: ["Cancel", "Add"],
    cancel: 0,
  });
  if (index !== 1) return;
  const url = cleanSourceUrl(value) || String(value ?? "").trim();
  if (site()) {
    let entry;
    try { entry = addSiteUrl(globalThis.localStorage, url); } catch (e) {
      await showAlert({ title: "Couldn't Add", message: e.message, buttons: ["OK"] });
      return;
    }
    known.set(entry.file, entry);
    refresh();
    return;
  }
  const hide = showHUD("Downloading");
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  let r;
  try {
    r = await libraryCall("add", { url }, (ev) => { const t = phaseLabel(ev); if (t && label) label.textContent = t; });
  } catch (e) {
    hide();
    await showAlert({ title: "Couldn't Download", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  if (hide.done) hide.done("Added"); else hide();
  remember(r?.ipas);
  if (view.body?.isConnected) draw(r?.ipas ?? []);
}

// ---- an IPA's page ----------------------------------------------------------------------------------------------

async function entryOf(file) {
  const r = await entries();
  remember(r?.ipas);
  return { entry: (r?.ipas ?? []).find((e) => e.file === file) ?? null, identity: Boolean(r?.identity) };
}

function setTitle(body, title) {
  const page = body.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const h1 = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i]?.querySelector(".nav-title");
  if (h1 && h1.textContent !== title) h1.textContent = title;
}

const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

function header(entry) {
  const name = entry.name || entry.file;
  const head = el("div", "pkg-head");
  const icon = el("span", "pkg-icon large");
  icon.append(el("span", "pkg-letter", name.charAt(0).toUpperCase()));
  putIcon(icon, entry.icon);
  const ht = el("div", "pkg-head-text");
  const top = el("span", "pkg-head-top");
  top.append(el("span", "pkg-head-name", name));
  ht.append(top);
  if (entry.version) ht.append(el("span", "pkg-head-version", entry.version));
  ht.append(el("span", "pkg-head-version myipa-bundle", entry.bundleId || (site() ? hostOf(entry.url) : "")));
  head.append(icon, ht);
  const size = formatBytes(entry.size);
  if (size) head.append(el("span", "pkg-head-size", size));
  const g = el("div", "group");
  const t = el("div", "table grouped pkg-head-table");
  t.append(head);
  g.append(t);
  return g;
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };

async function renderIpa(body, route, file) {
  body.append(placeholder("page"));
  let entry, identity;
  try { ({ entry, identity } = await entryOf(file)); } catch (e) {
    body.replaceChildren(note(deviceError(e).message));
    return;
  }
  if (!entry) {
    body.replaceChildren(grouped([{ rows: [{ label: "Not in My IPAs" }], footer: `${file} was deleted or moved.` }]));
    return;
  }
  setTitle(body, entry.name || file);
  body.replaceChildren(header(entry));
  if (site() && entry.stored) {
    const details = [
      { label: "Version", detail: entry.version || "—", chevron: false },
      { label: "Bundle ID", detail: entry.bundleId || "—", chevron: false },
      { label: "Size", detail: formatBytes(entry.size) || "—", chevron: false },
    ];
    if (entry.minimumOS) details.push({ label: "Requires", detail: `iOS ${entry.minimumOS}`, chevron: false });
    body.append(grouped([
      { header: "Details", rows: details,
        footer: "Kept in this browser. Install signs it here with your certificate (Settings > Signing) and iOS installs it." },
      { rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }] },
    ]));
    markDelete(body);
    return;
  }
  if (site()) {
    body.append(grouped([
      { header: "Link", rows: [{ label: entry.url, chevron: false }],
        footer: `Install opens this link in ${NAME}, AltStore, SideStore or Feather, which sign it on the iPhone, or downloads the IPA.` },
      { rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }] },
    ]));
    markDelete(body);
    return;
  }
  const st = stateOf(entry);
  const status = [{ label: "Status", detail: st.label, chevron: false }];
  if (entry.signed) {
    status.push({ label: "Signed", detail: dateText(entry.signed.at), chevron: false });
    if (entry.signed.expires) status.push({ label: "Signature Expires", detail: dateText(entry.signed.expires), chevron: false });
    if (entry.signed.bundleId && entry.signed.bundleId !== entry.bundleId) status.push({ label: "Signed As", detail: entry.signed.bundleId, chevron: false });
  }
  const changed = optionsChanged(entry.options);
  const actions = [
    { label: "Sign Options", detail: changed ? "Changed" : "As Is", href: format({ tab: "installed", path: [...ipaPath(file), "options"] }) },
    { label: "Sign Now", subtitle: entry.signed ? "Signed already: signs again" : "Signs on this iPhone, no connection needed", onClick: () => signNow(entry, body, route) },
    { label: "Save Signed IPA", subtitle: "Files, AirDrop and other apps", onClick: () => saveSigned(entry, body, route) },
  ];
  const details = [
    { label: "Version", detail: entry.version || "—" },
    { label: "Bundle ID", detail: entry.bundleId || "—" },
    { label: "Size", detail: formatBytes(entry.size) || "—" },
  ];
  if (entry.minimumOS) details.push({ label: "Requires", detail: `iOS ${entry.minimumOS}` });
  if (entry.extensions?.length) details.push({ label: "Extensions", detail: String(entry.extensions.length) });
  details.push({ label: "File", detail: entry.file });
  const groups = [
    { rows: status, footer: entry.error ? `This file can't be signed: ${entry.error}` : !identity ? "Add your certificate in Settings > Signing to sign it." : "" },
  ];
  if (!entry.error) groups.push({ rows: actions, footer: "Signing happens on this iPhone and works offline. Installing needs a connection only for the Signing Server's install manifest." });
  groups.push({ header: "Details", rows: details });
  groups.push({ rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }] });
  body.append(grouped(groups));
  markDelete(body);
}

function markDelete(body) {
  const last = [...body.querySelectorAll(".group")].at(-1);
  last?.querySelector(".cell-inner")?.classList.add("myipa-delete");
}

const optionsChanged = (o) => Boolean(o && (o.name || o.bundleId || o.icon || o.removeExtensions?.length || o.fixArm64e === false));

function rerender(body, route) {
  if (!body.isConnected) return;
  body.replaceChildren();
  render(body, route);
}

// Offline is fine: no Signing Server check here (Install makes it). Without a certificate the shell answers
// no_identity, which opens Settings > Signing.
async function signNow(entry, body, route) {
  const hide = showHUD("Signing");
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  try {
    await libraryCall("sign", { file: entry.file }, (ev) => { const t = phaseLabel(ev); if (t && label) label.textContent = t; });
  } catch (e) {
    hide();
    const why = deviceError(e, entry.name);
    await showAlert({ title: why.open ? why.title : `Couldn't Sign ${entry.name || ""}`.trim(), message: why.message, buttons: ["OK"] });
    if (why.open === "signing") location.hash = format(settingsRoute(["signing"])).replace(/^#/, "");
    return;
  }
  if (hide.done) hide.done("Signed"); else hide();
  rerender(body, route);
  refresh();
}

async function saveSigned(entry, body, route) {
  if (!entry.signed) {
    const i = await showActionSheet({ title: `${entry.name || "It"} isn't signed yet. Sign it now, then save it?`, buttons: ["Sign and Save"] });
    if (i !== 0) return;
    await signNow(entry, body, route);
    const { entry: now } = await entryOf(entry.file).catch(() => ({ entry: null }));
    if (!now?.signed) return;
  }
  try { await libraryCall("export", { file: entry.file }); } catch (e) {
    await showAlert({ title: "Couldn't Save", message: deviceError(e).message, buttons: ["OK"] });
  }
}

async function confirmDelete(entry) {
  const i = await showActionSheet({ title: site() ? (entry.stored ? "The IPA is deleted from this browser." : "") : "The IPA and its signed copy are deleted from this iPhone.",
    buttons: ["Delete IPA"], destructive: 0 });
  if (i !== 0) return;
  try {
    if (site()) await removeSiteEntry(entry, { store: entry.stored ? await siteStore() : null });
    else await libraryCall("delete", { file: entry.file });
  } catch (e) {
    await showAlert({ title: "Couldn't Delete", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  known.delete(entry.file);
  back();
  refresh();
}

// Install (nav bar): F30's record in Installed once iOS has it.
async function install(file) {
  let entry = known.get(file);
  const record = (id, name, version, icon) => apps().then((store) => recordInstall(store, {
    id, name, version, source: null, sourceName: "My IPAs", icon: icon ? `data:image/png;base64,${icon}` : null })).catch(() => {});
  if (site()) {
    entry ??= siteEntries().find((e) => e.file === file);
    if (!entry) return;
    if (entry.stored) {
      await siteFileInstall(entry, { onInstalled: (r) => {
        if (r?.bundleId) record(r.bundleId, r.name || entry.name, r.version || entry.version || "", entry.icon);
      } });
      return;
    }
    await siteInstallSheet(entry);
    return;
  }
  const name = entry?.options?.name || entry?.name || file.replace(/\.ipa$/i, "");
  await installFromLibrary({ file, name, onInstalled: (r) => {
    if (r?.bundleId) record(r.bundleId, r.name || name, r.version || entry?.version || "", entry?.options?.icon || entry?.icon);
  } });
  refresh();
  const route = { tab: "installed", path: ipaPath(file) };
  const body = shownBody(route);
  if (body) rerender(body, route);
}

// The IPA's page body when it is on screen (its own tab, or mounted on Home's stack), else null. Only the active
// tab's stack: every tab has an .is-top page, and Home's came first, so its root got the IPA's page (user 2026-11-18).
export function shownBody(route) {
  if (format(mounted(parse(location.hash))) !== format(route)) return null;
  return document.querySelector(".tab-stack.is-active > .page.is-top .page-body");
}

// F95: the website's Install for one of the user's links, as an app page's (F92): the certificate alert, whose
// Download IPA opens the link. -> whether it downloaded.
export function siteInstallSheet(entry, { alert, open = (u) => { location.href = u; } } = {}) {
  const url = entry?.url;
  if (!url) return Promise.resolve(false);
  return siteCertificateAlert({ download: () => open(url), ...(alert ? { alert } : {}) });
}

// ---- Sign Options -----------------------------------------------------------------------------------------------

const edits = new Map(); // file -> the options page's edits until Save

async function renderOptions(body, route, file) {
  body.append(placeholder("page", 5));
  let entry;
  try { ({ entry } = await entryOf(file)); } catch (e) {
    body.replaceChildren(note(deviceError(e).message));
    return;
  }
  if (!entry) {
    body.replaceChildren(note(`${file} isn't in My IPAs any more.`));
    return;
  }
  const o = entry.options ?? {};
  const ed = { name: o.name || "", bundleId: o.bundleId || "", icon: o.icon || null,
    removeExtensions: [...(o.removeExtensions ?? [])], fixArm64e: o.fixArm64e !== false };
  edits.set(file, { entry, ed });
  const { iconPNG } = await import("../signing-sheet.js");
  const { createSwitch } = await import("./settings.js");
  body.replaceChildren();

  const g = el("div", "group");
  g.append(el("h2", "group-header", "Install As"));
  const ul = el("ul", "table grouped");
  const field = (label, value, placeholder, set, extra = {}) => {
    const li = el("li", "cell");
    const row = el("label", "cell-inner sign-row ss-field");
    const input = Object.assign(el("input", "sign-value"), { type: "text", value, placeholder, ...extra });
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.addEventListener("input", () => set(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    row.append(el("span", "cell-label", label), input);
    li.append(row);
    return li;
  };
  ul.append(field("Name", ed.name, entry.name || "", (v) => { ed.name = v; }));
  ul.append(field("Bundle ID", ed.bundleId, entry.bundleId || "", (v) => { ed.bundleId = v; }, { inputMode: "url" }));
  const iconLi = el("li", "cell sign-files-cell");
  const iconRow = el("div", "cell-inner sign-row ss-icon-row");
  const iconState = el("span", "sign-value", ed.icon ? "Chosen" : "The App's");
  iconRow.append(el("span", "cell-label", "Icon"), iconState);
  const fileInput = Object.assign(el("input", "visually-hidden"), { type: "file", accept: "image/*" });
  fileInput.id = "mio" + Math.random().toString(36).slice(2);
  const choose = Object.assign(el("label", "bar-button sign-browse", ed.icon ? "Reset" : "Choose"), { htmlFor: fileInput.id });
  choose.addEventListener("click", (e) => {
    if (!ed.icon) return; // the label opens the picker
    e.preventDefault();
    ed.icon = null;
    iconState.textContent = "The App's";
    choose.textContent = "Choose";
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    try {
      ed.icon = await iconPNG(f);
      iconState.textContent = "Chosen";
      choose.textContent = "Reset";
    } catch {
      await showAlert({ title: "Can't Use This Image", message: `${NAME} couldn't read it. Choose a PNG or JPEG.`, buttons: ["OK"] });
    }
  });
  iconLi.append(iconRow, fileInput, choose);
  ul.append(iconLi);
  g.append(ul, el("p", "group-footer", "Empty fields keep what the IPA has. A new bundle ID installs a second copy; your profile may still change it."));
  body.append(g);

  const exts = entry.extensions ?? [];
  if (exts.length) {
    const eg = el("div", "group");
    eg.append(el("h2", "group-header", "Extensions"));
    const eul = el("ul", "table grouped");
    for (const x of exts) {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner has-switch ss-ext");
      const text = el("span", "cell-text");
      text.append(el("span", "cell-label", x.name || x.path.split("/").pop()), el("span", "cell-subtitle", x.point || x.bundleId || x.path));
      inner.append(text, createSwitch({ label: `Keep ${x.name || x.path}`, checked: !ed.removeExtensions.includes(x.path), onToggle: (on) => {
        const set = new Set(ed.removeExtensions);
        if (on) set.delete(x.path); else set.add(x.path);
        ed.removeExtensions = [...set];
      } }));
      li.append(inner);
      eul.append(li);
    }
    eg.append(eul, el("p", "group-footer", "Turn one off to leave it out: each extension needs an App ID of its own, which a free account may not have to spare."));
    body.append(eg);
  }

  const ag = el("div", "group");
  const aul = el("ul", "table grouped");
  const ali = el("li", "cell");
  const ainner = el("div", "cell-inner has-switch");
  ainner.append(el("span", "cell-label", "arm64e Fix-Up"), createSwitch({ label: "arm64e Fix-Up", checked: ed.fixArm64e, onToggle: (on) => { ed.fixArm64e = on; } }));
  ali.append(ainner);
  aul.append(ali);
  ag.append(aul, el("p", "group-footer", "Mends binaries built for the old arm64e ABI so they run on newer iPhones. Leave it on unless an app won't open."));
  body.append(ag);
}

async function saveOptions(file) {
  const cur = edits.get(file);
  if (!cur) return;
  let params;
  try { params = optionsParams(cur.entry, cur.ed); } catch (e) {
    await showAlert({ title: "Can't Save", message: e.message, buttons: ["OK"] });
    return;
  }
  try { await libraryCall("options", params); } catch (e) {
    await showAlert({ title: "Can't Save", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  edits.delete(file);
  back();
  setTimeout(() => {
    const route = { tab: "installed", path: ipaPath(file) };
    const body = shownBody(route);
    if (body) rerender(body, route);
    refresh();
  }, 400);
}

export { STATE_LABELS };

// N9: an IPA shared with iFizBox (share.js): Install, as the IPA page's button does (signs, installs, remembers it).
export const installLibraryFile = (file) => install(file);
