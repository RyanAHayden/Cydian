// The package pages the Sources and Search tabs share: a source's Sections, a package list, a package's page and
// an author's packages. Not a tab of its own: sources.js and search.js hand it the routes below them.
//
// Routes. In the Sources tab the first segment is a source key (`deb:<URI>:<dist>`, or `*` for All Sources) and
// opens its Sections; every segment after that (and every segment in the Search tab) is a token:
//   section:<name>   the packages in that section ("section:*" = All Packages)
//   package:<id>     a package's page, in the source of the route (the newest version for All Sources/Search)
//   author:<name>    every package whose Author or Maintainer is <name>
// e.g. #/sources/deb%3Ahttps%3A%2F%2Frepo.chariz.com%2F%3A.%2F/section%3ATweaks/package%3Acom.example.tweak
//
// Lists come from the catalog in the parse worker (catalog.js); long ones are virtualised (nav/vlist.js).
import { grouped } from "../nav/ui.js";
import { createVList, withLetterHeaders } from "../nav/vlist.js";
import { showSheet } from "../nav/sheet.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog, ALL } from "../catalog.js";
import { NO_SECTION, indexLetter, parseAuthor, simpleSection } from "../core/catalog.js";
import { description, parseRelations } from "../core/apt.js";
import { displayName, releaseDepiction } from "../core/sources.js";
import { renderSileo, mediaUrl } from "./depiction.js";
import { settings, createSwitch } from "./settings.js";

export const ROW_HEIGHT = 58;
export const SECTION_ROW_HEIGHT = 46;

// Section Visibility (F24): the hidden sections live on the device (core/settings.js hiddenSections) and reach
// the worker's catalog before its next answer, so every list, Search and Changes leave them out.
catalog.setHidden(settings.hiddenSections.list());
settings.onChange((key, value) => { if (key === "hiddenSections") catalog.setHidden(value); });

export function parseToken(seg) {
  const s = String(seg ?? "");
  const i = s.indexOf(":");
  const kind = i > 0 ? s.slice(0, i) : "";
  return ["section", "package", "author"].includes(kind) ? { kind, value: s.slice(i + 1) } : { kind: "unknown", value: s };
}

export const token = (kind, value) => `${kind}:${value}`;

// Names seen in lists, so a package page's title (and the next page's back button) is ready before the worker
// answers. A deep link falls back to the id.
const names = new Map();
export const rememberNames = (rows) => { for (const r of rows) names.set(r.id, r.name); };

// What a route below the tab's own root shows: { key, page: "sections" | token kind, value }.
export function pageOf(route) {
  if (route.tab === "sources") {
    const key = route.path[0];
    if (route.path.length === 1) return { key, page: "sections" };
    const t = parseToken(route.path.at(-1));
    return { key, page: t.kind, value: t.value };
  }
  const t = parseToken(route.path.at(-1));
  return { key: ALL, page: t.kind, value: t.value };
}

export function nav(route, sourceName = () => null) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": return {
      title: p.key === ALL ? "Sections" : sourceName(p.key) || "Sections", style: "plain",
      right: { label: "Edit", onClick: (e) => toggleVisibility(route, e.currentTarget) },
    };
    case "section": return { title: p.value === ALL ? "All Packages" : p.value, style: "plain" };
    case "author": return { title: p.value || "Author", style: "plain" };
    case "package": return { title: names.get(p.value) || p.value };
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": return renderSections(body, route, p.key);
    case "section": return renderList(body, route, () => catalog.list(p.key, p.value), true);
    case "author": return renderList(body, route, () => catalog.author(p.value), true);
    case "package": return renderPackage(body, route, p.key, p.value, ctx);
    default:
      body.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing here." }));
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function spinner(text = "Loading Packages") {
  const p = el("div", "loading");
  p.append(el("span", "loading-spinner"), el("span", null, text));
  return p;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

// ---- Sections (Cydia's SectionsController): "All Packages", then every section with its count -----------

// Sections pages on screen, by route, so their nav bar's Edit can find them: { body, route, key, editing, title }.
const sectionPages = new Map();

function renderSections(body, route, key) {
  for (const [k, p] of sectionPages) if (!p.body.isConnected) sectionPages.delete(k);
  const page = { body, route, key, editing: false, title: null, draw: 0 };
  sectionPages.set(format(route), page);
  return drawSections(page);
}

async function drawSections(page) {
  const { body, route, key, editing } = page;
  const turn = ++page.draw; // an Edit tapped while the worker answers: only the last draw lands
  body.replaceChildren(spinner());
  let data;
  try {
    await catalog.ensure();
    data = await catalog.sections(key, editing ? { hidden: true } : undefined);
  } catch (e) {
    if (turn === page.draw) body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  if (turn !== page.draw) return;
  const status = key === ALL ? null : catalog.status(key);
  const ul = el("ul", "table plain sections");
  if (editing) {
    // Cydia's edit mode: every section, hidden ones too, each with a switch (on = shown); no All Packages row.
    ul.classList.add("visibility");
    for (const s of data.sections) ul.append(visibilityRow(s));
  } else {
    ul.append(sectionRow("All Packages", data.total, deeper(route, token("section", ALL))));
    for (const s of data.sections) ul.append(sectionRow(s.name, s.count, deeper(route, token("section", s.name))));
  }
  body.replaceChildren(ul);
  if (status?.error) body.append(el("p", "empty", status.error));
  else if (editing ? !data.sections.length : !data.total) {
    body.append(el("p", "empty", data.sections.length ? "Every section is hidden. Tap Edit to show them." : "No packages for this device."));
  }
}

// Edit <-> Done: the title becomes "Section Visibility" (Cydia's SECTION_VISIBILITY) and the rows turn into switches.
function toggleVisibility(route, button) {
  const page = sectionPages.get(format(route));
  if (!page || !page.body.isConnected) return;
  page.editing = !page.editing;
  button.textContent = page.editing ? "Done" : "Edit";
  button.classList.toggle("done", page.editing);
  const h1 = button.closest(".nav-item")?.querySelector(".nav-title");
  if (h1) {
    if (page.editing) { page.title = h1.textContent; h1.textContent = "Section Visibility"; }
    else if (page.title != null) h1.textContent = page.title;
  }
  drawSections(page);
}

function visibilityRow(s) {
  const li = el("li", "cell section-row");
  const inner = el("div", "cell-inner has-switch");
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", s.count > 9999 ? `${Math.floor(s.count / 1000)}k` : String(s.count)));
  inner.append(folder, el("span", "cell-label", s.name), createSwitch({
    label: `Show ${s.name}`, checked: !s.hidden,
    onToggle: (on) => settings.hiddenSections.set(s.name, !on),
  }));
  li.append(inner);
  return li;
}

function sectionRow(name, count, href) {
  const li = el("li", "cell section-row");
  const a = el("a", "cell-inner chevron");
  a.href = href;
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", count > 9999 ? `${Math.floor(count / 1000)}k` : String(count)));
  a.append(folder, el("span", "cell-label", name));
  li.append(a);
  return li;
}

// ---- package lists ---------------------------------------------------------------------------------------

const iconOk = new Set();  // icon URLs that loaded once: shown at once when their row comes back
const iconBad = new Set(); // and those that failed: never asked again

// A letter tile until the icon loads (Cydia: the section icon, then unknown.png; those are Cydia's artwork).
const TINTS = ["#8c99b3", "#7a9a8c", "#a38c7a", "#8c7aa3", "#7a8ca3", "#a37a8c", "#909090"];
function tint(section) {
  let h = 0;
  for (const c of simpleSection(section)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

function createRow() {
  const row = el("div", "pkg-row");
  const a = el("a", "cell-inner pkg");
  const icon = el("span", "pkg-icon");
  const letter = el("span", "pkg-letter");
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.onload = () => { iconOk.add(img.dataset.url); img.classList.add("loaded"); };
  img.onerror = () => { iconBad.add(img.dataset.url); img.removeAttribute("src"); };
  icon.append(letter, img);
  const text = el("span", "pkg-text");
  const top = el("span", "pkg-top");
  top.append(el("span", "pkg-name"), el("span", "pkg-version"));
  text.append(top, el("span", "pkg-desc"));
  a.append(icon, text);
  row.append(a);
  row._ = { a, icon, letter, img, name: top.firstChild, version: top.lastChild, desc: text.lastChild };
  return row;
}

function iconSrc(item) {
  if (!item.icon || iconBad.has(item.icon)) return null;
  return mediaUrl(item.icon);
}

function bindRow(row, item, route) {
  const r = row._;
  r.a.href = deeper(route, token("package", item.id));
  r.name.textContent = item.name;
  r.version.textContent = item.version;
  r.desc.textContent = item.short;
  r.letter.textContent = indexLetter(item.name) === "#" ? item.name.charAt(0) : indexLetter(item.name);
  r.icon.style.background = tint(item.section);
  const src = iconSrc(item);
  // Icons only load once scrolling stops (idle), unless this one already loaded: a fling starts no fetches.
  if (src && iconOk.has(item.icon)) {
    if (r.img.dataset.url !== item.icon) { r.img.dataset.url = item.icon; r.img.src = src; }
    r.img.classList.add("loaded");
  } else {
    r.img.classList.remove("loaded");
    if (r.img.dataset.url) { r.img.removeAttribute("src"); delete r.img.dataset.url; }
  }
}

function loadIcon(row, item) {
  const src = iconSrc(item);
  if (!src || row._.img.dataset.url === item.icon) return;
  row._.img.dataset.url = item.icon;
  row._.img.src = src;
}

// A virtualised package list. `letters`: Cydia's A–Z headers (lists sorted by name; search results aren't).
// `rows` may hold { header } items of their own when `letters` is off. `decorate(row, item)` runs after each bind.
export function packageList(body, route, rows, { letters = true, decorate = null } = {}) {
  rememberNames(rows.filter((r) => r.id));
  const items = letters ? withLetterHeaders(rows, (r) => indexLetter(r.name)) : rows;
  const list = createVList(body, {
    items, rowHeight: ROW_HEIGHT, headerHeight: 23,
    createRow,
    bindRow: (row, item) => { bindRow(row, item, route); decorate?.(row, item); },
    idle: loadIcon,
  });
  return list;
}

async function renderList(body, route, fetchRows, letters) {
  body.append(spinner());
  let rows;
  try {
    await catalog.ensure();
    rows = await fetchRows();
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  body.replaceChildren();
  if (!rows.length) { body.append(el("p", "empty", "No packages.")); return; }
  const list = packageList(body, route, rows, { letters });
  body.append(list.el);
}

// ---- the package page --------------------------------------------------------------------------------------

export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const httpUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

async function renderPackage(body, route, key, id, ctx) {
  body.append(spinner("Loading"));
  let pkg, sources;
  try {
    await catalog.ensure();
    [pkg, sources] = await Promise.all([catalog.package(id, key), getBackend().sources()]);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  if (!pkg) {
    body.replaceChildren(grouped([{ rows: [{ label: "Package not found" }], footer: id }]));
    return;
  }
  const st = pkg.stanza;
  const sourceOf = (k) => sources.find((s) => s.key === k);
  const source = sourceOf(pkg.key);
  const sourceName = source ? displayName(source) : "";
  const desc = description(st);
  const name = st.name || st.package;
  names.set(id, name);
  setTitle(body, name);
  const groups = [];

  // Header: icon, name, version, size.
  const head = el("div", "pkg-head");
  const icon = el("span", "pkg-icon large");
  icon.style.background = tint(pkg.row.section);
  icon.append(el("span", "pkg-letter", name.charAt(0).toUpperCase()));
  const src = st.iconUrl && mediaUrl(st.iconUrl);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    icon.append(img);
  }
  const ht = el("div", "pkg-head-text");
  ht.append(el("span", "pkg-head-name", name), el("span", "pkg-head-version", st.version ?? ""));
  const size = formatSize(st.size);
  head.append(icon, ht);
  if (size) head.append(el("span", "pkg-head-size", size));
  const headGroup = el("div", "group");
  const headTable = el("div", "table grouped pkg-head-table");
  headTable.append(head);
  headGroup.append(headTable);

  // Author and Maintainer: each opens everything by that person.
  const people = [];
  const author = parseAuthor(st.author);
  const maint = parseAuthor(st.maintainer);
  if (author) people.push({ label: "Author", detail: author.name, href: deeper(route, token("author", author.name)) });
  if (maint && maint.name.toLowerCase() !== author?.name.toLowerCase()) {
    people.push({ label: author ? "Maintainer" : "Contact", detail: maint.name, href: deeper(route, token("author", maint.name)) });
  }
  if (people.length) groups.push({ rows: people });

  // Depiction: Sileo JSON drawn natively below; else an HTML depiction in a sheet, and the description. A package
  // with no Depiction: of its own gets the source's Release template (Cydia's fallback; an own non-http one
  // still counts as having one, so it gets neither).
  const sileo = httpUrl(st.sileodepiction);
  const html = st.depiction?.trim() ? httpUrl(st.depiction) : releaseDepiction(source, st.package || id);
  const depictionSlot = el("div", "depiction-slot");
  const more = [];
  if (html) more.push({ label: "Depiction", onClick: () => openHtmlDepiction(html, name) });
  const homepage = httpUrl(st.homepage);
  if (homepage) more.push({ label: "More Information", subtitle: homepage, onClick: () => window.open(homepage, "_blank", "noopener") });
  const descText = desc.long || desc.short;

  // Details.
  const details = [{ label: "Version", detail: st.version ?? "" }];
  if (size) details.push({ label: "Size", detail: size });
  const inst = Number(st["installed-size"]);
  if (inst > 0) details.push({ label: "Installed Size", detail: formatSize(inst * 1024) });
  details.push({ label: "Section", detail: pkg.row.section === NO_SECTION ? "—" : pkg.row.section });
  details.push({ label: "Identifier", detail: st.package });
  if (st.architecture) details.push({ label: "Architecture", detail: st.architecture });

  // Depends (and Pre-Depends): each line links to the first alternative we carry.
  const rels = [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)];
  const known = new Set(rels.length ? await catalog.has([...new Set(rels.flat().map((r) => r.name))]) : []);
  const depRows = rels.map((group) => {
    const text = group.map((r) => r.name + (r.op ? ` (${r.op} ${r.version})` : "")).join(" | ");
    const target = group.find((r) => known.has(r.name));
    return target ? { label: text, href: deeper(route, token("package", target.name)) } : { label: text, chevron: false };
  });
  const conflicts = parseRelations(st.conflicts).map((g) => ({ label: g.map((r) => r.name + (r.op ? ` (${r.op} ${r.version})` : "")).join(" | ") }));

  // Source, other versions, and (on the site) the .deb through the proxy.
  const srcRows = [{ label: sourceName || "Unknown Source", subtitle: source?.uri }];
  for (const o of pkg.others) {
    if (o.key === pkg.key) continue;
    const s = sourceOf(o.key);
    srcRows.push({ label: s ? displayName(s) : o.key, detail: o.version,
      href: format({ tab: "sources", path: [o.key, token("package", id)] }) });
  }

  body.replaceChildren(headGroup);
  const later = [];
  if (groups.length) later.push(...groups);
  body.append(grouped(later));
  body.append(depictionSlot);
  if (!sileo && descText) {
    const g = el("div", "group");
    const t = el("div", "table grouped pkg-description");
    t.textContent = descText;
    g.append(t);
    body.append(g);
  }
  if (more.length) body.append(grouped([{ rows: more.map((r) => ({ ...r, chevron: true })) }]));
  body.append(grouped([{ header: "Details", rows: details }]));
  if (depRows.length) body.append(grouped([{ header: "Depends", rows: depRows }]));
  if (conflicts.length) body.append(grouped([{ header: "Conflicts", rows: conflicts }]));
  body.append(grouped([{ header: pkg.others.length > 1 ? "Sources" : "Source", rows: srcRows }]));
  if (st.debUrl && getBackend().kind === "http") {
    // Paid packages (cydia::commercial) only download for a buyer's device: the repo refuses the proxy.
    if (/(^|,)\s*cydia::commercial\s*(,|$)/.test(st.tag ?? "")) body.append(grouped([{ footer: "A paid package: buy and install it from a package manager on the phone." }]));
    else body.append(downloadGroup(st));
  }
  body.append(grouped([{ footer: `${st.package}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));

  if (sileo) loadSileo(depictionSlot, sileo, { fallback: descText });
}

// A deep link titles the page with the id until the package loads; then its name goes in the nav bar. app.js
// keeps each tab's pages and nav items in step, so the item has the page's index.
function setTitle(body, title) {
  const page = body.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const item = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i];
  const h1 = item?.querySelector(".nav-title");
  if (h1 && h1.textContent !== title) h1.textContent = title;
}

function downloadGroup(st) {
  const url = st.debUrl;
  const file = decodeURIComponent(url.split("/").pop() || `${st.package}.deb`);
  const g = grouped([{ rows: [{ label: "Download .deb", subtitle: file, href: getBackend().assetUrl(url), chevron: false }],
    footer: "Fetched through this site, for installing by hand." }]);
  const a = g.querySelector("a.cell-inner");
  a.setAttribute("download", file.endsWith(".deb") ? file : `${file}.deb`);
  a.classList.add("download");
  return g;
}

async function loadSileo(slot, url, { fallback }) {
  slot.append(spinner("Loading Depiction"));
  try {
    const json = JSON.parse(await getBackend().text(url));
    const dep = renderSileo(json, { open: (u, title) => openSileoSheet(u, title) });
    const g = el("div", "group");
    const t = el("div", "table grouped dep-card");
    t.append(dep);
    g.append(t);
    slot.replaceChildren(g);
  } catch {
    // A dead or broken JSON depiction: show the description instead, as if there were none.
    slot.replaceChildren();
    if (fallback) {
      const g = el("div", "group");
      const t = el("div", "table grouped pkg-description");
      t.textContent = fallback;
      g.append(t);
      slot.append(g);
    }
  }
}

function openSileoSheet(url, title) {
  const box = el("div", "sheet-scroll grouped page-body");
  box.append(spinner("Loading Depiction"));
  showSheet({ title: title || "Depiction", body: box });
  getBackend().text(url).then((t) => {
    const g = el("div", "group");
    const card = el("div", "table grouped dep-card");
    card.append(renderSileo(JSON.parse(t), { open: openSileoSheet }));
    g.append(card);
    box.replaceChildren(g);
  }).catch((e) => box.replaceChildren(el("p", "empty", e.message)));
}

// HTML depictions open in a sheet, in a sandboxed iframe with no bridge to us (docs/cydia.md). An http
// depiction on the https site would be blocked as mixed content, so it comes through the proxy instead, as
// srcdoc with scripts off; everything else loads directly from its own origin.
export function openHtmlDepiction(url, title) {
  const frame = document.createElement("iframe");
  frame.className = "depiction-frame";
  frame.title = title;
  frame.referrerPolicy = "no-referrer";
  const mixed = globalThis.location?.protocol === "https:" && /^http:/i.test(url) && getBackend().kind === "http";
  if (mixed) {
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    getBackend().text(url).then((html) => { frame.srcdoc = withBase(html, url); })
      .catch((e) => { frame.srcdoc = `<p style="font:17px Helvetica Neue,sans-serif;text-align:center;margin-top:40px">${escapeHtml(e.message)}</p>`; });
  } else {
    frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
    frame.src = url;
  }
  return showSheet({ title, body: frame });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Relative links and images in a proxied depiction resolve against its real URL; links open outside the sheet.
export function withBase(html, url) {
  const base = `<base href="${escapeHtml(url)}" target="_blank">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
}
