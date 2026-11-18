// "Open in" (F8): a grouped section on a source's page and a package's page with one row per package manager that
// takes that format (core/handoff.js builds the links), and a QR code of Cydian's /add link for adding the source
// from another device. Since F76 only an APT package's page keeps the group; a source's page and an app's page
// have Share in the nav bar instead (shareItems below). In the jailbreak app the real install queue takes this
// place (N4).
import { grouped } from "../nav/ui.js";
import { showSheet } from "../nav/sheet.js";
import { qrSvg } from "../core/qr.js";
import { sourceLinks, packageLinks, addLink, siteOrigin, formatOf, isIpaFormat } from "../core/handoff.js";
import { settings } from "./settings.js";
import { showShareSheet, setShare } from "../nav/sharesheet.js";
import { showHUD } from "../nav/hud.js";
import { appIcon, loadAppIcons } from "../app-icons.js";

// pkg: an id for a package's page; leave it out on a source's page.
// Only the visitor's format: APT managers run on jailbroken iPhones, so a phone set to Not Jailbroken (Settings >
// Device, F37) sees just the add link for an APT source; IPA sources (AltStore, ESign, Scarlet, GBox: F50) show the
// apps that read their format to everyone.
export function openInGroup(source, { pkg = null, jailbroken = settings.jailbroken() } = {}) {
  const apt = formatOf(source) === "apt";
  // An app's page has no Open In group: its Install group installs it (the user's certificate in the sideload app;
  // on the website, Install with the certificate alert until F93, F92) or Download IPA keeps the file (user 2026-11-17).
  const appPage = pkg && isIpaFormat(formatOf(source));
  const links = appPage || (apt && !jailbroken) ? [] : pkg ? packageLinks(pkg, source) : sourceLinks(source);
  const add = addLink(source, siteOrigin(globalThis.location));
  if (!links.length && !add) return document.createDocumentFragment();
  const rows = links.map((l) => ({ label: `Open in ${l.app}`, onClick: () => { location.href = l.url; } }));
  if (add) rows.push({ label: "Add on Another Device", onClick: () => showAddQR(add) });
  return grouped([{ header: "Open In", rows, footer: footerFor(source, pkg, links.length) }]);
}

function footerFor(source, pkg, shown) {
  if (!shown) return undefined; // F144: no hint pointing at Settings > Device
  if (isIpaFormat(formatOf(source))) {
    return pkg ? "Adds this app's source to that app, where it can install it." : "Adds this source to that app.";
  }
  const flat = !source.dist || String(source.dist).endsWith("/");
  if (pkg) {
    return flat ? "Sileo and Irisin open the package once its source is added there. Cydia and Zebra add the source on the way."
      : "Each opens the package once its source is added there.";
  }
  return flat ? "Adds this source to that app." : "Only Irisin takes a source with a suite; the others add flat repos only.";
}

function showAddQR(link) {
  let svg;
  try {
    svg = qrSvg(link, { ecc: "M" });
  } catch {
    return; // a source URL is far under a QR code's limit; nothing to show if it isn't
  }
  const box = document.createElement("div");
  box.className = "sheet-scroll page-body grouped manage-qr handoff-qr"; // manage.css draws the code
  const img = new Image();
  img.alt = "QR code of the add link";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const note = document.createElement("p");
  note.className = "group-footer";
  note.textContent = "Scan it with the other phone's Camera: Cydian opens with Add Source filled in.";
  const url = document.createElement("p");
  url.className = "group-footer handoff-link";
  url.textContent = link;
  box.append(img, note, url);
  showSheet({ title: "Add Source", body: box });
}

// ---- Share (F76): the nav bar's Share button on a source's page and an app's page ---------------------------------
//
// The iOS 6 share sheet (nav/sharesheet.js) takes the Open In group's place there: Copy Link (the source's URL), Add
// on Another Device (the QR code of the /add link), then the apps that take the source (core/handoff.js
// sourceLinks), under the same rule as openInGroup: APT managers only for a phone set to Jailbroken. An app's page
// lists them too: they add its source to that app (Cydian's own Install stays the way to install it here).

// Each app's tile: its real icon once app-icons.js has fetched it, until then (and for apps without one) its initial on
// a colour close to its icon's.
export const APP_TILES = {
  Cydia: { letter: "C", color: "#8b5a2b" },
  Sileo: { letter: "S", color: "#5e5ce6" },
  Zebra: { letter: "Z", color: "#2b2b2e" },
  Irisin: { letter: "I", color: "#7d4fd0" },
  "AltStore Classic": { letter: "A", color: "#0f8c78" },
  AltStore: { letter: "A", color: "#1cc0a0" },
  SideStore: { letter: "S", color: "#8445e8" },
  Feather: { letter: "F", color: "#e2547c" },
  LiveContainer: { letter: "L", color: "#2f7cf6" },
  StikStore: { letter: "S", color: "#f08a24" },
  TrollApps: { letter: "T", color: "#d63f8c" },
  Scarlet: { letter: "S", color: "#c8102e" },
  ESign: { letter: "E", color: "#2a6be0" },
  GBox: { letter: "G", color: "#22a45d" },
};
const tileOf = (app) => APP_TILES[app] ?? { letter: app.charAt(0).toUpperCase(), color: "#5a6270" };

// The source's own URL, the one a person would paste into Add Source.
export function sourceUrlOf(source) {
  const u = isIpaFormat(formatOf(source)) ? source?.uri || String(source?.key ?? "").replace(/^alt:/, "") : source?.uri;
  return /^https?:\/\/\S+$/i.test(String(u ?? "")) ? String(u) : null;
}

// Pure: what the sheet lists. [{ kind: "copy", label, text } | { kind: "qr", label, link } | { kind: "open", label,
// url, letter, color }]. app: true on an app's page.
export function shareItems(source, { app = false, jailbroken = settings.jailbroken(), origin = siteOrigin(globalThis.location) } = {}) {
  if (!source) return [];
  const items = [];
  const url = sourceUrlOf(source);
  if (url) items.push({ kind: "copy", label: "Copy Link", text: url });
  const add = addLink(source, origin);
  if (add) items.push({ kind: "qr", label: "Add on Another Device", link: add });
  // An app's page lists them too (user 2026-11-17): they add the app's source to that app.
  const apt = formatOf(source) === "apt";
  if (apt && !jailbroken) return items;
  for (const l of sourceLinks(source)) items.push({ kind: "open", label: l.app, url: l.url, ...tileOf(l.app) });
  return items;
}

function showShareFor(source, opts) {
  const items = shareItems(source, opts).map((it) => {
    if (it.kind === "copy") return { label: it.label, glyph: "copy", onSelect: () => copyText(it.text) };
    if (it.kind === "qr") return { label: it.label, glyph: "qr", onSelect: () => showAddQR(it.link) };
    return { label: it.label, letter: it.letter, color: it.color, image: appIcon(it.label), onSelect: () => { location.href = it.url; } };
  });
  return showShareSheet({ items });
}

// From a page's render: shows the nav bar's Share button (screens' nav() puts nav/sharesheet.js shareButton there)
// once there is something to share.
export function setSourceShare(body, source, opts) {
  const items = source ? shareItems(source, opts) : [];
  setShare(body, items.length ? () => showShareFor(source, opts) : null);
  // The apps' icons, fetched now so they're there by the time Share is tapped (cached after the first time).
  loadAppIcons(items.filter((it) => it.kind === "open").map((it) => it.label));
}

function copyText(text) {
  const ok = () => showHUD("Copying").done("Copied");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) ok();
}

function legacyCopy(text) {
  const t = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  t.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* not allowed */ }
  t.remove();
  return ok;
}
