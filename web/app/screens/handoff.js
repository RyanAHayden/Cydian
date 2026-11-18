// "Open in" (F8): a grouped section on a source's page and a package's page with one row per package manager that
// takes that format (core/handoff.js builds the links), and a QR code of Cydian's /add link for adding the source
// from another device. Used by browse.js (APT) and altstore.js (AltStore). In the jailbreak app the real install
// queue takes this place (N4).
import { grouped } from "../nav/ui.js";
import { showSheet } from "../nav/sheet.js";
import { qrSvg } from "../core/qr.js";
import { sourceLinks, packageLinks, addLink, siteOrigin, formatOf, isIpaFormat } from "../core/handoff.js";
import { settings } from "./settings.js";

// pkg: an id for a package's page; leave it out on a source's page.
// Only the visitor's format: APT managers run on jailbroken iPhones, so a phone set to Not Jailbroken (Settings >
// Device, F37) sees just the add link for an APT source; IPA sources (AltStore, ESign, Scarlet, GBox: F50) show the
// apps that read their format to everyone.
export function openInGroup(source, { pkg = null, jailbroken = settings.jailbroken() } = {}) {
  const apt = formatOf(source) === "apt";
  const links = apt && !jailbroken ? [] : pkg ? packageLinks(pkg, source) : sourceLinks(source);
  const add = addLink(source, siteOrigin(globalThis.location));
  if (!links.length && !add) return document.createDocumentFragment();
  const rows = links.map((l) => ({ label: `Open in ${l.app}`, onClick: () => { location.href = l.url; } }));
  if (add) rows.push({ label: "Add on Another Device", onClick: () => showAddQR(add) });
  return grouped([{ header: "Open In", rows, footer: footerFor(source, pkg, links.length) }]);
}

function footerFor(source, pkg, shown) {
  if (!shown) return "Cydia, Sileo, Zebra and Irisin run on jailbroken iPhones. Jailbroken? Settings > Device.";
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

export function showAddQR(link) {
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
