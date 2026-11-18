// F77: My IPAs, under Installed (#/installed/myipas): the user's own IPAs, signed with their certificate.
//
//   #/installed/myipas                      the library: a plain list, icon, name, version, size and state;
//                                           Add (nav bar) -> action sheet Browse / From URL
//   #/installed/myipas/ipa:<file>           an IPA's page, like a package page: header, Install (nav bar), Sign
//                                           Options, Sign Now, Save Signed IPA, details, Delete
//   #/installed/myipas/ipa:<file>/options   Sign Options: name, bundle ID, icon, extensions, arm64e fix-up
//
// In the sideload app the files live in Cydian's Documents (Files > On My iPhone > Cydian) and the shell signs them
// (signing-client.js libraryCall, native/Sources/MyIPAs.swift). On the website there is no signer on the phone:
// Add is From URL only, the list is links kept on this device, and Install signs through the Signing Server.
// Rules and labels: core/myipas.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, plain } from "../nav/ui.js";
import { format } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showHUD } from "../nav/hud.js";
import { cleanSourceUrl } from "../core/sources.js";
import { detectMode } from "../core/settings.js";
import { deviceError, phaseLabel, isCgBI, fromBase64 } from "../core/signing.js";
import { apps, recordInstall } from "../core/installed.js";
import { MYIPAS, libraryRows, stateOf, formatBytes, ipaToken, fileOfToken, optionsParams, siteEntries, addSiteUrl, removeSiteUrl,
  STATE_LABELS } from "../core/myipas.js";
import { localSigning, libraryCall, installFromLibrary, signAndInstall } from "../signing-client.js";

export { MYIPAS };

const view = { body: null, route: null, seq: 0 };
const known = new Map(); // file -> the last entry seen (titles, the page before its list call answers)

// Which My IPAs page a route under Installed is: "list", "ipa", "options", or null (not one of ours).
export function pageOf(route) {
  if (route.path[0] !== MYIPAS) return null;
  if (route.path.length === 1) return { page: "list" };
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
    case "list": return { title: "My IPAs", style: "plain", right: { label: "Add", onClick: () => addMenu() } };
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
    view.body = body;
    view.route = route;
    body.append(note("Loading"));
    load();
    return;
  }
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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
  const ul = plain([{ rows: rows.map((r) => ({
    label: r.title, subtitle: r.subtitle, icon: { text: r.title.charAt(0).toUpperCase() },
    href: format({ tab: "installed", path: ipaPath(r.file) }),
  })) }]);
  const cells = ul.querySelectorAll(":scope > .cell");
  rows.forEach((r, i) => {
    cells[i].classList.add("myipa-row", `is-${r.state.kind}`);
    putIcon(cells[i].querySelector(".cell-icon"), r.icon);
  });
  body.replaceChildren(ul);
  if (!rows.length) {
    body.prepend(note(site()
      ? "No IPAs yet. Tap Add to keep a link to an IPA here: the Signing Server signs it with your certificate when you install it."
      : "No IPAs yet. Tap Add to choose one in Files or download one, or put IPAs in Files under On My iPhone > Cydian."));
  }
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

async function addMenu() {
  if (site()) return addFromUrl();
  const i = await showActionSheet({ buttons: ["Browse", "From URL"] });
  if (i === 0) return browse();
  if (i === 1) return addFromUrl();
}

async function browse() {
  let r;
  try { r = await libraryCall("pick", {}); } catch (e) {
    await showAlert({ title: "Couldn't Add", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  remember(r?.ipas);
  if (view.body?.isConnected) draw(r?.ipas ?? []);
  if (r?.files?.length === 1) go(ipaPath(r.files[0]));
}

// The Add alert as Sources has it: a URL field with Paste, cleaned up by cleanSourceUrl.
async function addFromUrl() {
  const { index, value } = await showAlert({
    title: "Enter IPA URL",
    message: site() ? "A link to an .ipa. The Signing Server downloads and signs it when you install." : "A link to an .ipa: Cydian downloads it into My IPAs.",
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
  body.append(note("Loading"));
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
  if (site()) {
    body.append(grouped([
      { header: "Link", rows: [{ label: entry.url, chevron: false }],
        footer: "Install sends this link with your certificate to the Signing Server (Settings > Signing), which signs the IPA and hands it to iOS." },
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
    if (why.open === "signing") location.hash = format({ tab: "settings", path: ["signing"] }).replace(/^#/, "");
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
  const i = await showActionSheet({ title: site() ? "" : "The IPA and its signed copy are deleted from this iPhone.", buttons: ["Delete IPA"], destructive: 0 });
  if (i !== 0) return;
  try {
    if (site()) removeSiteUrl(globalThis.localStorage, entry.file);
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
    await signAndInstall({ url: entry.url, name: entry.name, onInstalled: (b) => {
      const id = b?.bundleId || b?.bundleID;
      if (id) record(id, b?.name || entry.name, b?.version || "", null);
    } });
    return;
  }
  const name = entry?.options?.name || entry?.name || file.replace(/\.ipa$/i, "");
  await installFromLibrary({ file, name, onInstalled: (r) => {
    if (r?.bundleId) record(r.bundleId, r.name || name, r.version || entry?.version || "", entry?.options?.icon || entry?.icon);
  } });
  refresh();
  const body = [...document.querySelectorAll(".page.is-top .page-body")].find((b) => b.isConnected);
  if (body) {
    const route = { tab: "installed", path: ipaPath(file) };
    if (location.hash === format(route)) rerender(body, route);
  }
}

// ---- Sign Options -----------------------------------------------------------------------------------------------

const edits = new Map(); // file -> the options page's edits until Save

async function renderOptions(body, route, file) {
  body.append(note("Loading"));
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
      await showAlert({ title: "Can't Use This Image", message: "Cydian couldn't read it. Choose a PNG or JPEG.", buttons: ["OK"] });
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
    const body = [...document.querySelectorAll(".page.is-top .page-body")].at(-1);
    const route = { tab: "installed", path: ipaPath(file) };
    if (body && location.hash === format(route)) rerender(body, route);
    refresh();
  }, 400);
}

export { STATE_LABELS };
