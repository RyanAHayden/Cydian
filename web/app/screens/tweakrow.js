// SPDX-License-Identifier: GPL-3.0-or-later
// The tweak lists the Add Tweaks flow shows (Browse Tweak Sources, Search All Repos, a repo's Tweaks for Sideloaded
// Apps): plain iOS 6 list rows, as Cydia's package list draws them: a 29pt icon (the package's Icon, over its
// section's icon, or the unknown-section icon), the name, and a subtitle with its version and author. A package's
// Icon is drawn inside the 29pt box, cropped to it: a big logo or a depiction header never spills over the rows.
// Styles: tweaks.css (.tw-list-row).
//
//   tweakListRow(r, { onClick, repo, right })  li.cell for r ({ name, id, version, author, short, section, icon,
//                                        repo }); right: a node at the row's end (Add Tweaks' ADD button)
//   tweakSubtitle(r, { repo })           "1.2 · Spark" (+ " · <repo name>" with repo: true, for results from
//                                        several repos); the description when there's no version or author
import { el } from "../nav/ui.js";
import { loadStyle } from "../nav/motion.js";
import { getBackend } from "../backend.js";
import { packageIcon } from "../core/sectionicons.js";
import { encodeUrl } from "../core/urlencode.js";

export function tweakSubtitle(r, { repo = false } = {}) {
  const parts = [r?.version, r?.author].filter(Boolean);
  const desc = r?.short || r?.description; // the catalog's short description, Canister's description
  if (!parts.length && desc) parts.push(desc);
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

// Wider or taller than 4:3: a header or banner, not an icon.
export const isBanner = (w, h) => w > 0 && h > 0 && Math.max(w / h, h / w) > 4 / 3;

export function tweakIcon(r) {
  const look = packageIcon(r);
  const box = el("span", "cell-icon tw-icon");
  box.style.backgroundImage = `url("${look.fallback}")`;
  const src = iconUrl(look.src);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    // a banner (a depiction header or featured art given as the icon) isn't an icon: the section icon stays
    img.onload = () => { if (isBanner(img.naturalWidth, img.naturalHeight)) img.remove(); else img.classList.add("loaded"); };
    img.onerror = () => img.remove();
    img.src = src;
    box.append(img);
  }
  return box;
}

export function tweakListRow(r, { onClick = null, repo = false, chevron = true, right = null } = {}) {
  loadStyle("tweaks.css");
  const li = el("li", "cell tw-list-row");
  const b = el(onClick ? "button" : "div", `cell-inner${onClick && chevron ? " chevron" : ""}`);
  if (onClick) { b.type = "button"; b.addEventListener("click", onClick); }
  const t = el("span", "cell-text");
  t.append(el("span", "cell-label", r?.name || r?.id || ""));
  const sub = tweakSubtitle(r, { repo });
  if (sub) t.append(el("span", "cell-subtitle", sub));
  b.append(tweakIcon(r), t);
  if (right) b.append(right);
  li.append(b);
  return li;
}
