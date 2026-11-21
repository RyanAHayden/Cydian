// SPDX-License-Identifier: GPL-3.0-or-later
// The tweak lists the Add Tweaks flow shows (Browse Tweak Sources, Search All Repos, a repo's Tweaks for Sideloaded
// Apps): plain iOS 6 list rows, as Cydia's package list draws them: a 29pt icon (the package's Icon, over its
// section's icon, or the unknown-section icon), the name, and a subtitle with its version and author. A package's
// Icon is drawn inside the 29pt box, cropped to it: a big logo or a depiction header never spills over the rows.
// Styles: tweaks.css (.tw-list-row).
//
//   tweakListRow(r, { onClick, repo })   li.cell for r ({ name, id, version, author, short, section, icon, repo })
//   tweakSubtitle(r, { repo })           "1.2 · Spark" (+ " · <repo name>" with repo: true, for results from
//                                        several repos); the description when there's no version or author
import { el } from "../nav/ui.js";
import { loadStyle } from "../nav/motion.js";
import { getBackend } from "../backend.js";
import { packageIcon } from "../core/sectionicons.js";
import { encodeUrl } from "../core/urlencode.js";

export function tweakSubtitle(r, { repo = false } = {}) {
  const parts = [r?.version, r?.author].filter(Boolean);
  if (!parts.length && r?.short) parts.push(r.short);
  if (repo && r?.repo?.name && r.repo.name !== r?.author) parts.push(r.repo.name);
  return parts.join(" · ");
}

// An icon URL the page can load (screens/depiction.js mediaUrl's rule): https and data: as they are, http through
// the backend (the site's proxy), anything else none.
function iconUrl(u) {
  const s = encodeUrl(String(u ?? ""));
  if (/^https:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) { try { const b = getBackend(); return b.assetUrl ? b.assetUrl(s) : s; } catch { return s; } }
  return null;
}

export function tweakIcon(r) {
  const look = packageIcon(r);
  const box = el("span", "cell-icon tw-icon");
  box.style.backgroundImage = `url("${look.fallback}")`;
  const src = iconUrl(look.src);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    box.append(img);
  }
  return box;
}

export function tweakListRow(r, { onClick = null, repo = false, chevron = true } = {}) {
  loadStyle("tweaks.css");
  const li = el("li", "cell tw-list-row");
  const b = el(onClick ? "button" : "div", `cell-inner${onClick && chevron ? " chevron" : ""}`);
  if (onClick) { b.type = "button"; b.addEventListener("click", onClick); }
  const t = el("span", "cell-text");
  t.append(el("span", "cell-label", r?.name || r?.id || ""));
  const sub = tweakSubtitle(r, { repo });
  if (sub) t.append(el("span", "cell-subtitle", sub));
  b.append(tweakIcon(r), t);
  li.append(b);
  return li;
}
