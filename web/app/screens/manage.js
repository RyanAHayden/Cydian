// Sources > Manage (F45), a grouped page after Cydia's Manage tab: three rows, each its own page.
//
//   #/sources/manage                     Sources, Import & Export, Recommended
//   #/sources/manage/sources             the edit list: Add, the red minus and Delete, drag the grabber to reorder
//   #/sources/manage/io                  Export (share text, save a file, QR code) and Import (file or pasted text)
//   #/sources/manage/io/paste            a text box for a pasted list; Next checks it
//   #/sources/manage/io[/paste]/review   what an import found: new ones (ticked), already listed, can't add; Add
//   #/sources/manage/recommended         core/recommended.js: sources as Sources draws them, a round Add on each
//   #/sources/manage/recommended/<key>   one not added yet, read from its URL: its apps (F52) or packages (F54), and Add
//
// Source keys always hold a ':' (deb:..., alt:...), so "manage" can't be one. The parsing, export text and order
// live in core/sourcelist.js; the QR code in core/qr.js. A change here (add, delete, reorder) tells sources.js
// through onSourcesChanged, so the tab's list is right when the user goes back.
import { grouped, plain, collapse } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showSheet } from "../nav/sheet.js";
import { format } from "../router.js";
import { getBackend, getParser, getArch } from "../backend.js";
import { repoLayout } from "../core/apt.js";
import { packageList } from "./browse.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor } from "../core/sources.js";
import { altRecord, parseSource } from "../core/altstore.js";
import {
  exportText, clipboardText, parseImport, reviewImport, orderSources, loadOrder, saveOrder, recommendedRows, recommendedSeed,
  packagePreview, EXPORT_FILENAME,
} from "../core/sourcelist.js";
import { qrSvg } from "../core/qr.js";
import { sourceWarning, warningAlert } from "../core/warnings.js";
import {
  RECOMMENDED_SOURCES, JAILBREAKS, jailbreakName, detectJailbreak, recommendedFor, savedJailbreak, saveJailbreak,
  markRecommendedSeen,
} from "../core/recommended.js";
import { copyText } from "../nav/menu.js";
import { settings } from "./settings.js";

export const SEGMENT = "manage";
export const isManage = (route) => route.path[0] === SEGMENT;

const listeners = new Set();
export const onSourcesChanged = (f) => listeners.add(f);
const changed = () => { for (const f of listeners) f(); };

let pending = null; // the import under review: [entry with status and `pick`]

const here = (...path) => format({ tab: "sources", path: [SEGMENT, ...path] });

function page(route) {
  const p = route.path.slice(1);
  if (!p.length) return "root";
  if (p[0] === "sources" && p.length === 1) return "sources";
  if (p[0] === "recommended" && p.length === 1) return "recommended";
  if (p[0] === "recommended" && p.length === 2) return "preview";
  if (p[0] === "io") {
    if (p.length === 1) return "io";
    if (p.at(-1) === "review") return "review";
    if (p[1] === "paste" && p.length === 2) return "paste";
  }
  return "missing";
}

export function nav(route, ctx) {
  switch (page(route)) {
    case "root": return { title: "Manage", right: { label: "Add", onClick: () => addSource(ctx) } }; // F52
    case "sources": return { title: "Sources", style: "plain", right: { label: "Add", onClick: () => addSource(ctx) } };
    case "io": return { title: "Import & Export" };
    case "paste": return { title: "Paste List", right: { label: "Next", onClick: () => pasteNext(route, ctx) } };
    case "review": return { title: "Import", right: { label: "Add", onClick: () => addPicked(ctx) } };
    case "recommended": return { title: "Recommended", style: "plain" };
    case "preview": return { title: RECOMMENDED_SOURCES.find((r) => recommendedSeed(r).key === route.path[2])?.name || "Source",
      right: { label: "Add", onClick: () => addFromPreview(route, ctx) } };
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  switch (page(route)) {
    case "root": return renderRoot(body);
    case "sources": return renderSources(body);
    case "io": return renderIO(body, route, ctx);
    case "paste": return renderPaste(body);
    case "review": return renderReview(body);
    case "recommended": return renderRecommended(body, ctx);
    case "preview": return renderPreview(body, route);
    default: body.append(el("p", "empty", "Nothing here."));
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// The list in the user's order, as the Sources tab shows it (Not Jailbroken: AltStore sources only).
async function shownSources() {
  const all = orderSources(await getBackend().sources(), loadOrder());
  return { all, ...sourcesFor(all, settings.deviceType()) };
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---- Manage --------------------------------------------------------------------------------------------------

function renderRoot(body) {
  const rows = [
    { label: "Sources", href: here("sources") },
    { label: "Import & Export", href: here("io") },
    { label: "Recommended", href: here("recommended") },
  ];
  body.replaceChildren(grouped([{ rows, footer: "Add, delete and reorder your sources; move them to another phone or "
    + "package manager; or pick from a short list of sources worth having." }]));
  getBackend().sources().then((list) => {
    const n = sourcesFor(list, settings.deviceType()).shown.length;
    const detail = body.querySelector(".cell .cell-inner");
    if (detail && !detail.querySelector(".cell-detail")) detail.insertBefore(el("span", "cell-detail", String(n)), detail.querySelector(".cell-check"));
  }).catch(() => {});
}

// ---- Sources: the edit list ------------------------------------------------------------------------------------

async function renderSources(body) {
  let list;
  let hidden = 0;
  try {
    ({ shown: list, hidden } = await shownSources());
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  const backend = getBackend();
  const ul = plain([{ rows: list.map((s) => ({ label: displayName(s), subtitle: sourceSubtitle(s),
    icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" } })) }]);
  ul.classList.add("editing", "manage-list");
  const cells = [...ul.querySelectorAll(":scope > .cell")];
  list.forEach((s, i) => editRow(cells[i], s, backend, body));
  attachReorder(ul, body);
  body.replaceChildren(ul);
  if (!list.length) body.append(el("p", "empty", "No sources. Tap Add."));
  const foot = el("div", "manage-foot");
  if (list.length > 1) {
    const sort = el("button", "manage-link", "Sort by Name");
    sort.type = "button";
    sort.addEventListener("click", () => { saveOrder(null); changed(); renderSources(body); });
    foot.append(sort);
  }
  foot.append(el("p", "group-footer", (hidden ? `${plural(hidden, "APT source")} hidden (Not Jailbroken). ` : "")
    + "Drag ≡ to reorder; the Sources tab keeps this order."));
  body.append(foot);
}

function editRow(li, source, backend, body) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  if (source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  const urls = sourceIcons(source).map((u) => (backend.assetUrl ? backend.assetUrl(u) : u));
  img.onerror = () => (urls.length ? (img.src = urls.shift()) : img.remove());
  if (urls.length) img.src = urls.shift();
  li.querySelector(".cell-icon").append(img);

  const toggle = el("button", "del-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Delete " + displayName(source));
  toggle.addEventListener("click", () => {
    const on = !li.classList.contains("armed");
    for (const o of li.parentNode.querySelectorAll(".source-row.armed")) o.classList.remove("armed");
    li.classList.toggle("armed", on);
  });
  const confirm = el("button", "del-confirm", "Delete");
  confirm.type = "button";
  confirm.addEventListener("click", () => removeRow(li, source, body));
  const grab = el("span", "reorder");
  grab.setAttribute("aria-label", "Reorder " + displayName(source));
  li.append(toggle, confirm, grab);
}

async function removeRow(li, source, body) {
  li.classList.add("removing");
  try {
    await getBackend().removeSource(source.key);
  } catch (e) {
    li.classList.remove("removing");
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    return;
  }
  changed();
  setTimeout(() => {
    if (li.parentNode.querySelectorAll(".source-row").length > 1) collapse(li); // the rows below slide up
    else { li.remove(); renderSources(body); }
  }, 200);
}

// Drag a row by its grabber: it follows the finger (transform only) and the rows it passes slide out of its way;
// on release the order is saved. Rows are one height (Cydia's 53pt), so the slot is the offset over that height.
function attachReorder(ul, body) {
  let drag = null;
  ul.addEventListener("pointerdown", (e) => {
    const grab = e.target.closest(".reorder");
    if (!grab) return;
    e.preventDefault();
    const li = grab.closest(".source-row");
    const rows = [...ul.querySelectorAll(":scope > .source-row")];
    drag = { li, rows, from: rows.indexOf(li), to: rows.indexOf(li), y: e.clientY, h: li.offsetHeight, id: e.pointerId };
    grab.setPointerCapture?.(e.pointerId);
    li.classList.add("dragging");
    ul.classList.add("is-reordering");
  });
  ul.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const { rows, from, h } = drag;
    const to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
    drag.to = to;
    drag.li.style.transform = `translateY(${Math.max(-from * h, Math.min((rows.length - 1 - from) * h, dy))}px)`;
    rows.forEach((r, i) => {
      if (r === drag.li) return;
      const shift = from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { li, rows, from, to } = drag;
    drag = null;
    for (const r of rows) r.style.transform = "";
    li.classList.remove("dragging");
    ul.classList.remove("is-reordering");
    if (from === to) return;
    rows.splice(to, 0, ...rows.splice(from, 1));
    for (const r of rows) ul.append(r);
    saveFullOrder(rows.map((r) => r.dataset.key));
  };
  ul.addEventListener("pointerup", end);
  ul.addEventListener("pointercancel", end);
}

// The shown rows' new order, with sources hidden on this device kept where they were relative to the rest.
async function saveFullOrder(shownKeys) {
  const all = orderSources(await getBackend().sources(), loadOrder()).map((s) => s.key);
  const shown = new Set(shownKeys);
  let i = 0;
  saveOrder(all.map((k) => (shown.has(k) ? shownKeys[i++] : k)));
  changed();
}

// Add Source, as the Sources tab's Edit mode had it (docs/cydia.md "Sources tab").
// F8: `prefill` ({ url, dist?, components? }, from a /add?url= link, core/handoff.js parseAddLink) fills the field;
// a dist repo's suite and components are named in the message and go along while the URL is left as it was.
export async function addSource(ctx, prefill = null) {
  const dist = prefill?.dist ? `Suite ${prefill.dist}${prefill.components?.length ? `, ${prefill.components.join(" ")}` : ""}.` : "";
  const { index, value } = await showAlert({
    title: "Enter APT URL",
    message: dist || "Or an app source (.json): AltStore, ESign, Scarlet or GBox.",
    input: { placeholder: "https://", value: prefill?.url || "https://", type: "url" },
    buttons: ["Cancel", "Add Source"],
    cancel: 0,
  });
  if (index !== 1) return;
  const input = dist && value.trim() === prefill.url ? { uri: prefill.url, dist: prefill.dist, components: prefill.components } : value;
  if (!(await confirmWarning(input))) return;
  const hide = ctx.showHUD("Verifying URL");
  let error = null;
  try {
    await getBackend().addSource(input);
  } catch (e) {
    error = e;
  } finally {
    hide();
  }
  if (error) {
    await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    return;
  }
  changed();
  const body = document.querySelector(".page.is-top .manage-list")?.closest(".page-body");
  if (body) renderSources(body);
}

// F19: Cydia's Source Warning, from our own list (core/warnings.js), before anything is fetched. Resolves true to
// go on: the source isn't listed, or the user tapped Add Anyway.
export async function confirmWarning(input) {
  const w = sourceWarning(input);
  if (!w) return true;
  return (await showAlert(warningAlert(w))).index === 1;
}

// ---- Import & Export -------------------------------------------------------------------------------------------

function renderIO(body, route, ctx) {
  const file = Object.assign(document.createElement("input"), { type: "file", hidden: true,
    accept: ".txt,.list,.sources,.json,text/plain,application/json" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      await startReview(await f.text(), route, ctx);
    } catch (e) {
      await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    }
  });
  body.replaceChildren(grouped([
    { header: "Export", rows: [
      { label: "Share List", onClick: () => shareList() },
      { label: "Copy to Clipboard", onClick: () => copyList() },
      { label: "Save as File", onClick: () => saveFile() },
      { label: "Show QR Code", onClick: () => showQR() },
    ], footer: "Every source's URL, one per line. Another phone's Cydian reads it back (Import), and so do most "
      + "package managers, one URL at a time." },
    { header: "Import", rows: [
      { label: "From File", onClick: () => file.click() },
      { label: "From Pasted Text", href: here("io", "paste") },
    ], footer: "Reads Cydian's export, a list of URLs, AltStore, SideStore and Feather source lists (JSON), "
      + "Sileo's .sources and Cydia's .list. You see which are new before anything is added." },
  ]), file);
}

async function exportNow() {
  const { all } = await shownSources();
  return { text: exportText(all), count: all.length };
}

// F52: the URLs alone, one per line (no header comment), for pasting anywhere.
async function copyList() {
  const { all } = await shownSources();
  await copyText(clipboardText(all));
  await showAlert({ title: "Copied", message: `${plural(all.length, "source")} on the clipboard, one URL per line.`, buttons: ["OK"] });
}

async function shareList() {
  const { text } = await exportNow();
  if (navigator.share) {
    try { await navigator.share({ title: "Cydian Sources", text }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    await showAlert({ title: "Copied", message: "The source list is on the clipboard.", buttons: ["OK"] });
  } catch {
    await showAlert({ title: "Can't Share", message: "This browser has no share sheet or clipboard. Use Save as File.", buttons: ["OK"] });
  }
}

// A file through the share sheet where it takes files (iOS: Save to Files, AirDrop), else a download.
async function saveFile() {
  const { text } = await exportNow();
  const blob = new Blob([text], { type: "text/plain" });
  const f = typeof File === "function" ? new File([blob], EXPORT_FILENAME, { type: "text/plain" }) : null;
  if (f && navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: "Cydian Sources" }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: EXPORT_FILENAME });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function showQR() {
  const { text, count } = await exportNow();
  let svg;
  try {
    svg = qrSvg(text, { ecc: text.length > 1200 ? "L" : "M" });
  } catch {
    await showAlert({ title: "Too Many Sources", message: `${plural(count, "source")} won't fit in one QR code. Use Share List or Save as File.`, buttons: ["OK"] });
    return;
  }
  const box = el("div", "sheet-scroll page-body grouped manage-qr"); // page-body: clears the sheet's nav bar
  const img = new Image();
  img.alt = `QR code of ${plural(count, "source")}`;
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  box.append(img, el("p", "group-footer", `${plural(count, "source")}. Scan it with the other phone's Camera, `
    + "copy the text it shows, then Import > From Pasted Text."));
  showSheet({ title: "QR Code", body: box });
}

function renderPaste(body) {
  const area = Object.assign(document.createElement("textarea"), { className: "manage-paste",
    placeholder: "Paste URLs, a sources list or a JSON file here", spellcheck: false });
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocorrect", "off");
  area.setAttribute("aria-label", "Source list");
  const g = el("div", "group");
  g.append(area, el("p", "group-footer", "Tap Next to see which sources are new."));
  body.replaceChildren(g);
}

async function pasteNext(route, ctx) {
  const text = document.querySelector(".page.is-top textarea.manage-paste")?.value ?? "";
  await startReview(text, route, ctx);
}

async function startReview(text, route, ctx) {
  const { entries } = parseImport(text);
  if (!entries.length) {
    await showAlert({ title: "No Sources Found", message: "There are no source URLs in that text.", buttons: ["OK"] });
    return;
  }
  const have = await getBackend().sources().catch(() => []);
  pending = reviewImport(entries, have).map((e) => ({ ...e, pick: e.status === "new" && !e.warning }));
  ctx.go({ tab: "sources", path: [...route.path, "review"] });
}

function renderReview(body) {
  if (!pending) {
    body.replaceChildren(el("p", "empty", "Nothing to import. Go back and pick a file or paste a list."));
    return;
  }
  const row = (e) => ({ label: e.uri.replace(/^https?:\/\//, ""), subtitle: e.dist && e.dist !== "./" ? `${e.dist} ${e.components.join(" ")}` : undefined });
  const fresh = pending.filter((e) => e.status === "new" && !e.warning);
  const warned = pending.filter((e) => e.status === "new" && e.warning); // F19: Source Warning, unticked
  const listed = pending.filter((e) => e.status === "listed");
  const unsupported = pending.filter((e) => e.status === "unsupported");
  const sections = [];
  const toggle = (e) => (ev) => {
    e.pick = !e.pick;
    const inner = ev.currentTarget;
    inner.querySelector(".cell-check")?.remove();
    if (e.pick) inner.append(el("span", "cell-check"));
  };
  if (fresh.length) {
    sections.push({ header: `New (${fresh.length})`, rows: fresh.map((e) => ({ ...row(e), checked: e.pick, onClick: toggle(e) })),
      footer: "Tap a source to leave it out." });
  }
  if (warned.length) {
    sections.push({ header: `Source Warning (${warned.length})`,
      rows: warned.map((e) => ({ ...row(e), subtitle: e.warning.reason, checked: e.pick, onClick: toggle(e) })),
      footer: "These are on Cydian's list of piracy sources. "
        + "Tap one to add it anyway." });
  }
  if (listed.length) sections.push({ header: `Already Listed (${listed.length})`, rows: listed.map(row) });
  if (unsupported.length) {
    sections.push({ header: `Can't Add (${unsupported.length})`, rows: unsupported.map(row),
      footer: "These lines name no source Cydian can add." });
  }
  body.replaceChildren(grouped(sections));
  body.classList.add("manage-review");
}

async function addPicked(ctx) {
  const picks = (pending ?? []).filter((e) => e.status === "new" && e.pick);
  if (!picks.length) {
    await showAlert({ title: "Nothing to Add", message: "No new sources are ticked.", buttons: ["OK"] });
    return;
  }
  const hide = ctx.showHUD("Adding Sources");
  const failed = [];
  for (const e of picks) {
    try { await getBackend().addSource(e.input); e.status = "listed"; } catch (err) { failed.push(`${e.uri}: ${err.message}`); }
  }
  hide();
  changed();
  const ok = picks.length - failed.length;
  await showAlert({ title: failed.length ? "Some Sources Failed" : "Sources Added",
    message: [`Added ${plural(ok, "source")}.`, ...failed].join("\n\n"), buttons: ["OK"] });
  pending = null;
  ctx.go({ tab: "sources", path: [SEGMENT, "sources"] });
}

// ---- Recommended (F52) ----------------------------------------------------------------------------------------
// Rows as the Sources tab draws them (icon, name, URL, app count once loaded; core/sourcelist.js recommendedRows),
// with a round Get-style Add on the right instead of Delete. A row opens the source: an added one its real page,
// one not added yet a preview here (#/sources/manage/recommended/<key>) read straight from its URL. No Games: this
// page lists sources; a game is a package and belongs on Home.

const previews = new Map(); // key -> { record fields read before adding (name, iconURL, count), apps }

// F19: which jailbreak Recommended is for: the user's pick, else what apt's source files say (the jailbreak app;
// core/recommended.js detectJailbreak), else null (every tweak repo, as before). { id, detected }.
let detectedJailbreak; // a promise, asked once per session
export async function currentJailbreak() {
  const saved = savedJailbreak();
  if (saved) return { id: saved, detected: false };
  const backend = getBackend();
  detectedJailbreak ??= backend.aptSourceFiles
    ? backend.aptSourceFiles().then(detectJailbreak, () => null)
    : Promise.resolve(null);
  const id = await detectedJailbreak;
  return { id, detected: Boolean(id) };
}

const recRows = async () => {
  const sources = await getBackend().sources().catch(() => []);
  const jailbroken = settings.deviceType() !== "none";
  const recs = jailbroken ? recommendedFor(RECOMMENDED_SOURCES, (await currentJailbreak()).id) : RECOMMENDED_SOURCES;
  return recommendedRows(recs, sources, { jailbroken, previews });
};

// F19: the Jailbreak row's picker: one button per jailbreak, then Cancel.
async function pickJailbreak(body, ctx) {
  const buttons = [...JAILBREAKS.map((j) => j.name), "Cancel"];
  const { index } = await showAlert({ title: "Jailbreak", message: "Recommended lists the sources that suit it.",
    buttons, cancel: buttons.length - 1 });
  if (index >= JAILBREAKS.length) return;
  saveJailbreak(JAILBREAKS[index].id);
  renderRecommended(body, ctx);
}

function jailbreakRow(jb, body, ctx) {
  const ul = plain([{ rows: [{
    label: "Jailbreak",
    subtitle: jb.id ? `${jailbreakName(jb.id)}${jb.detected ? " (found on this iPhone)" : ""}` : "Not set: every tweak repo is listed",
    onClick: () => pickJailbreak(body, ctx), chevron: true,
  }] }]);
  ul.classList.add("rec-jailbreak");
  return ul;
}

// An AltStore source's JSON, read once per visit, so its row gets a name, icon and count and its preview its apps.
async function loadPreview(row) {
  if (row.rec.jailbreak) return null;
  if (previews.has(row.key)) return previews.get(row.key);
  const text = await getBackend().text(row.record.uri);
  const parsed = parseSource("altstore", text);
  const p = { ...altRecord(row.record.uri, parsed), updated: null, apps: parsed.apps };
  previews.set(row.key, p);
  return p;
}

async function addRecommended(row, ctx) {
  const hide = ctx.showHUD("Verifying URL");
  let error = null;
  try {
    await getBackend().addSource(row.input);
  } catch (e) {
    error = e;
  } finally {
    hide();
  }
  if (error) {
    await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    return false;
  }
  changed();
  return true;
}

// sidedrop's GET look: a white pill with blue text, blue while held; "Added", greyed, once the source is listed.
function getButton(row, onAdd) {
  const b = el("button", "rec-get" + (row.added ? " added" : ""), row.added ? "Added" : "Add");
  b.type = "button";
  b.disabled = row.added;
  b.setAttribute("aria-label", (row.added ? "Added: " : "Add ") + row.label);
  const up = () => b.classList.remove("is-pressed");
  b.addEventListener("pointerdown", () => { if (!b.disabled) b.classList.add("is-pressed"); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(t, up);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!b.disabled) onAdd(b);
  });
  return b;
}

function recIcon(li, row) {
  const backend = getBackend();
  li.querySelector(".cell-icon img")?.remove();
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  const urls = row.icons.map((u) => (backend.assetUrl ? backend.assetUrl(u) : u));
  img.onerror = () => (urls.length ? (img.src = urls.shift()) : img.remove());
  if (urls.length) img.src = urls.shift();
  li.querySelector(".cell-icon").append(img);
}

const recHref = (row) => (row.added ? format({ tab: "sources", path: [row.key] }) : here("recommended", row.key));

async function renderRecommended(body, ctx) {
  const rows = await recRows();
  const ul = plain([{ rows: rows.map((r) => ({
    label: r.label, subtitle: r.subtitle, icon: { text: r.label[0]?.toUpperCase() ?? "?" },
    badge: r.count != null ? r.count.toLocaleString() : undefined, href: recHref(r), chevron: false,
  })) }]);
  ul.classList.add("rec-list");
  markRecommendedSeen(); // F19: the Sources tab's first-run row has done its job
  const cells = [...ul.querySelectorAll(":scope > .cell")];
  rows.forEach((r, i) => {
    const li = cells[i];
    li.classList.add("source-row", "rec-row");
    li.dataset.key = r.key;
    recIcon(li, r);
    li.append(getButton(r, async () => { if (await addRecommended(r, ctx)) renderRecommended(body, ctx); }));
  });
  body.replaceChildren(ul);
  if (settings.deviceType() !== "none") body.prepend(jailbreakRow(await currentJailbreak(), body, ctx));
  if (settings.deviceType() === "none") {
    body.append(el("p", "group-footer", "Tweak repos show here once Settings > Device says this iPhone is jailbroken."));
  }
  // Fill in icons and app counts as each AltStore source answers: those not added, and added ones nothing has been
  // read from yet (a default the Sources tab hasn't loaded). Tweak repos wait for Refresh (their Packages is big).
  rows.forEach((r, i) => {
    if (r.rec.jailbreak || r.count != null) return;
    loadPreview(r).then((p) => {
      const li = cells[i];
      if (!p || !li.isConnected) return;
      const record = { ...r.record, iconURL: r.record.iconURL || p.iconURL };
      const next = { ...r, record, icons: sourceIcons(record), count: p.count };
      recIcon(li, next);
      const inner = li.querySelector(".cell-inner");
      if (!inner.querySelector(".cell-count")) inner.append(el("span", "cell-count", p.count.toLocaleString()));
    }).catch(() => {});
  });
}

// A recommended source before it is added: its apps as read from its URL (an AltStore source), or its packages
// by section (a tweak repo, F54: its Packages parsed in the worker). Add in the nav bar adds it and opens
// its real page.
async function previewRow(route) {
  const key = route.path[2];
  return (await recRows()).find((r) => r.key === key) ?? null;
}

async function addFromPreview(route, ctx) {
  const row = await previewRow(route);
  if (!row) return;
  if (!row.added && !(await addRecommended(row, ctx))) return;
  ctx.go({ tab: "sources", path: [row.key] });
}

async function renderPreview(body, route) {
  const row = await previewRow(route);
  if (!row) {
    body.replaceChildren(el("p", "empty", "Nothing here."));
    return;
  }
  const head = { header: row.label, rows: [{ label: row.subtitle, subtitle: row.rec.why }],
    footer: row.added ? "This source is in your list." : "Tap Add to put it in your Sources." };
  if (row.rec.jailbreak) return renderRepoPreview(body, route, row, head);
  body.replaceChildren(el("p", "empty", "Loading Source"));
  let p;
  try {
    p = await loadPreview(row);
  } catch (e) {
    body.replaceChildren(grouped([head]), el("p", "empty", e.message));
    body.classList.add("manage-why");
    return;
  }
  const apps = p.apps.map((a) => ({ label: a.name, subtitle: a.subtitle || a.developerName || a.id,
    icon: { text: a.name?.[0]?.toUpperCase() ?? "?" }, iconURL: a.iconURL }));
  body.replaceChildren(grouped([head]));
  const ul = plain([{ header: `${plural(apps.length, "App")}`, rows: apps }]);
  ul.classList.add("rec-apps");
  const backend = getBackend();
  [...ul.querySelectorAll(":scope > .cell")].forEach((li, i) => {
    const url = apps[i].iconURL;
    if (!url) return;
    li.classList.add("source-row");
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = backend.assetUrl ? backend.assetUrl(url) : url;
    li.querySelector(".cell-icon").append(img);
  });
  body.append(ul);
  body.classList.add("manage-why");
}

// ---- A tweak repo's preview (F54) -----------------------------------------------------------------------------
// Its Packages, fetched as Refresh fetches it (backend.packages: .xz, .bz2, .gz or plain, decompressed off the page)
// and parsed in the worker (core/parser.js), summed up by core/sourcelist.js packagePreview: the packages for this
// iPhone's arch under Cydia's section names, in a virtualised list (nav/vlist.js via browse.js packageList), as
// the Sources tab shows them once added. Rows don't open a package page: that needs the repo in the catalog, so
// Add first. Read once per visit, like the AltStore previews.

const repoPreviews = new Map(); // key -> Promise<{ total, sections }>

async function loadRepoPreview(row) {
  const arch = getArch();
  const id = `${row.key} ${arch}`;
  if (!repoPreviews.has(id)) {
    const p = (async () => {
      const layout = repoLayout(row.record, arch);
      const stanzas = [];
      let firstError = null;
      for (const file of layout.packages) {
        try {
          const { text } = await getBackend().packages(file.slice(0, -"Packages".length));
          stanzas.push(...(await getParser().packages(text, layout.root)));
        } catch (e) {
          firstError ??= e;
        }
      }
      if (!stanzas.length && firstError) throw firstError;
      return packagePreview(stanzas, arch);
    })();
    repoPreviews.set(id, p);
    p.catch(() => repoPreviews.delete(id)); // a failed read is tried again next visit
  }
  return repoPreviews.get(id);
}

async function renderRepoPreview(body, route, row, head) {
  body.classList.add("manage-why");
  body.replaceChildren(grouped([head]), el("p", "empty", "Loading Packages"));
  let preview;
  try {
    preview = await loadRepoPreview(row);
  } catch (e) {
    body.replaceChildren(grouped([head]), el("p", "empty", e?.message || String(e)));
    return;
  }
  if (!body.isConnected) return;
  const summary = { rows: [], footer: `${plural(preview.total, "package")} in ${plural(preview.sections.length, "section")}`
    + (row.added ? "." : ". Add it to install them; its packages then show under Sources.") };
  body.replaceChildren(grouped([head, summary]));
  if (!preview.total) {
    body.append(el("p", "empty", "No packages for this iPhone."));
    return;
  }
  const items = preview.sections.flatMap((s) => [{ header: `${s.name} (${s.packages.length.toLocaleString()})` },
    ...s.packages.map((p) => ({ ...p, version: "", section: s.name, key: row.key }))]);
  const list = packageList(body, route, items, {
    letters: false,
    // Not in the catalog yet, so no package page to open.
    decorate: (r) => { r._.a.removeAttribute("href"); r._.a.setAttribute("aria-disabled", "true"); },
  });
  list.el.classList.add("rec-packages");
  body.append(list.el);
}
