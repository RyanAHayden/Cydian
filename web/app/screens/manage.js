// Sources > Manage (F45), a grouped page after Cydia's Manage tab: three rows, each its own page.
//
//   #/sources/manage                     Sources, Import & Export, Recommended
//   #/sources/manage/sources             the edit list: Add, the red minus and Delete, drag the grabber to reorder
//   #/sources/manage/io                  Export (share text, save a file, QR code) and Import (file or pasted text)
//   #/sources/manage/io/paste            a text box for a pasted list; Next checks it
//   #/sources/manage/io[/paste]/review   what an import found: new ones (ticked), already listed, can't add; Add
//   #/sources/manage/recommended         core/recommended.js: sources and games, one tap to add
//
// Source keys always hold a ':' (deb:..., alt:...), so "manage" can't be one. The parsing, export text and order
// live in core/sourcelist.js; the QR code in core/qr.js. A change here (add, delete, reorder) tells sources.js
// through onSourcesChanged, so the tab's list is right when the user goes back.
import { grouped, plain, collapse } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showSheet } from "../nav/sheet.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor } from "../core/sources.js";
import { altKey, normalizeAltUrl } from "../core/altstore.js";
import {
  exportText, parseImport, reviewImport, orderSources, loadOrder, saveOrder, altLink, EXPORT_FILENAME,
} from "../core/sourcelist.js";
import { qrSvg } from "../core/qr.js";
import { RECOMMENDED_SOURCES, RECOMMENDED_GAMES } from "../core/recommended.js";
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
  if (p[0] === "io") {
    if (p.length === 1) return "io";
    if (p.at(-1) === "review") return "review";
    if (p[1] === "paste" && p.length === 2) return "paste";
  }
  return "missing";
}

export function nav(route, ctx) {
  switch (page(route)) {
    case "root": return { title: "Manage" };
    case "sources": return { title: "Sources", style: "plain", right: { label: "Add", onClick: () => addSource(ctx) } };
    case "io": return { title: "Import & Export" };
    case "paste": return { title: "Paste List", right: { label: "Next", onClick: () => pasteNext(route, ctx) } };
    case "review": return { title: "Import", right: { label: "Add", onClick: () => addPicked(ctx) } };
    case "recommended": return { title: "Recommended" };
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
async function addSource(ctx) {
  const { index, value } = await showAlert({
    title: "Enter APT URL",
    message: "Or an AltStore source (.json) for apps.",
    input: { placeholder: "https://", value: "https://", type: "url" },
    buttons: ["Cancel", "Add Source"],
    cancel: 0,
  });
  if (index !== 1) return;
  const hide = ctx.showHUD("Verifying URL");
  let error = null;
  try {
    await getBackend().addSource(value);
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
  pending = reviewImport(entries, have).map((e) => ({ ...e, pick: e.status === "new" }));
  ctx.go({ tab: "sources", path: [...route.path, "review"] });
}

function renderReview(body) {
  if (!pending) {
    body.replaceChildren(el("p", "empty", "Nothing to import. Go back and pick a file or paste a list."));
    return;
  }
  const row = (e) => ({ label: e.uri.replace(/^https?:\/\//, ""), subtitle: e.dist && e.dist !== "./" ? `${e.dist} ${e.components.join(" ")}` : undefined });
  const fresh = pending.filter((e) => e.status === "new");
  const listed = pending.filter((e) => e.status === "listed");
  const unsupported = pending.filter((e) => e.status === "unsupported");
  const sections = [];
  if (fresh.length) {
    sections.push({ header: `New (${fresh.length})`, rows: fresh.map((e) => ({ ...row(e), checked: e.pick, onClick: (ev) => {
      e.pick = !e.pick;
      const inner = ev.currentTarget;
      inner.querySelector(".cell-check")?.remove();
      if (e.pick) inner.append(el("span", "cell-check"));
    } })), footer: "Tap a source to leave it out." });
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

// ---- Recommended -----------------------------------------------------------------------------------------------

const recKey = (r) => (r.jailbreak ? null : altKey(normalizeAltUrl(r.url)));
const recInput = (r) => (r.jailbreak ? r.url : altLink(r.url));
const listedFor = (r, keys) => {
  if (r.jailbreak) return reviewImport(parseImport(r.url).entries, [...keys].map((key) => ({ key })))[0]?.status === "listed";
  return keys.has(recKey(r));
};

async function addRecommended(r, ctx) {
  const hide = ctx.showHUD("Verifying URL");
  try {
    await getBackend().addSource(recInput(r));
    changed();
    return true;
  } catch (e) {
    hide();
    await showAlert({ title: e.title || "Verification Error", message: e.message, buttons: ["OK"] });
    return false;
  } finally {
    hide();
  }
}

async function renderRecommended(body, ctx) {
  const keys = new Set((await getBackend().sources().catch(() => [])).map((s) => s.key));
  const jailbroken = settings.deviceType() !== "none";
  const sources = RECOMMENDED_SOURCES.filter((r) => jailbroken || !r.jailbreak);
  const sourceRow = (r) => {
    const added = listedFor(r, keys);
    return { label: r.name, subtitle: r.why, detail: added ? "Added" : "Add", chevron: false,
      onClick: added ? undefined : async () => { if (await addRecommended(r, ctx)) renderRecommended(body, ctx); } };
  };
  const gameRow = (g) => ({ label: g.name, subtitle: g.why, href: undefined, chevron: true, onClick: async () => {
    if (!keys.has(recKey(g)) && !(await addRecommended(g, ctx))) return;
    ctx.go({ tab: "sources", path: [recKey(g), `package:${g.bundleId}`] });
  } });
  body.replaceChildren(grouped([
    { header: "Sources", rows: sources.map(sourceRow),
      footer: jailbroken ? "" : "Tweak repos show here once Settings > Device says this iPhone is jailbroken." },
    { header: "Games", rows: RECOMMENDED_GAMES.map(gameRow), footer: "A game's source is added with it, then its page opens." },
  ]));
  body.classList.add("manage-why");
}
