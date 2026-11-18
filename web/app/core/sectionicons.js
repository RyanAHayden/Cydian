// Package icons like Cydia's (F126): PackageCell in Cydia's MobileCydia.mm (Package -icon, l.2863, and the purpose
// badge, l.5393). The artwork in web/app/icons/sections/ is Cydia's own (Jay Freeman (saurik), GPLv3, from
// git.saurik.com/cydia.git MobileCydia.app/Sections, Purposes and unknown.png). Pure JS, no DOM.
//
//   sectionIconName(section)   -> "Tweaks" | null      the Cydia section icon a section name maps to
//   sectionIconUrl(section)    -> "icons/sections/Tweaks.png" | null
//   purposeBadgeUrl(purpose)   -> "icons/sections/purposes/extension.png" | null (Cydia's 7 purposes only)
//   packageIcon(row)           -> { src, fallback, badge, badgeKind }  what a list row or package page draws:
//     src       the package's own icon URL (http(s)/data), or null
//     fallback  what shows without it, or when it fails: the section's icon, else UNKNOWN_ICON (Cydia's order;
//               Cydia's file:/// Icon and the source's Default-Icon don't exist on the web)
//     badge     the small icon in the bottom-right corner, or null:
//               1. Cydia: the package's primary purpose (its first `purpose::` tag) -> Purposes/<x>.png;
//               2. F126's brief: a package with its own icon and no purpose badge gets its section's icon, so the
//                  type still shows. Drop it (badgeKind "section") when the own icon fails: the fallback is then
//                  that same section icon.
//     badgeKind "purpose" | "section" | null
//
// Section names are matched the way Cydia does it, then more loosely: `_` -> space and Sections.plist's fixes
// (catalog.js sectionName), Simplify() ("Themes (SpringBoard)" -> "Themes"), case-insensitive, then common aliases
// ("Tweak", "Theme", "Utility", "eBooks"...), then the part in brackets ("Apps (Games)", AltStore's -> Games).

import { sectionName, simpleSection } from "./catalog.js";

export const SECTION_ICONS = [
  "Addons", "Administration", "Archiving", "Books", "Carrier Bundles", "Data Storage", "Development", "Dictionaries",
  "Education", "Entertainment", "Fonts", "Games", "Health and Fitness", "Java", "Keyboards", "Localization",
  "Messaging", "Multimedia", "Navigation", "Networking", "Packaging", "Productivity", "Repositories", "Ringtones",
  "Scripting", "Security", "Site-Specific Apps", "Social", "Soundboards", "System", "Terminal Support",
  "Text Editors", "Themes", "Toys", "Tweaks", "Utilities", "Wallpaper", "Widgets", "X Window",
];

export const PURPOSES = ["commercial", "console", "daemon", "extension", "library", "uikit", "x"];

const ICON_DIR = "icons/sections/";
export const UNKNOWN_ICON = `${ICON_DIR}unknown.png`;

// Lower-cased names a repo uses for one of the sections above (Sections.plist's own, lower-cased, and common ones).
const ALIASES = {
  tweak: "Tweaks", "system tweaks": "Tweaks", theme: "Themes", theming: "Themes", winterboard: "Themes",
  utility: "Utilities", utilites: "Utilities", util: "Utilities", utils: "Utilities", tools: "Utilities",
  developer: "Development", dev: "Development", "developer tools": "Development", "development tools": "Development",
  "site-specific": "Site-Specific Apps", "site specific apps": "Site-Specific Apps",
  wallpapers: "Wallpaper", ringtone: "Ringtones", ebooks: "Books", ebook: "Books", book: "Books",
  game: "Games", widget: "Widgets", keyboard: "Keyboards", font: "Fonts",
  addon: "Addons", "add-ons": "Addons", "add-on": "Addons", "add ons": "Addons", "app addons": "Addons",
  dictionary: "Dictionaries", "hunspell dictionaries": "Dictionaries",
  repository: "Repositories", repo: "Repositories", repos: "Repositories",
  terminal: "Terminal Support", "text editor": "Text Editors", editors: "Text Editors",
  network: "Networking", "health & fitness": "Health and Fitness", health: "Health and Fitness",
  "carrier bundle": "Carrier Bundles", carrier: "Carrier Bundles", "x11": "X Window", "x windows": "X Window",
  toy: "Toys", "social networking": "Social", media: "Multimedia", music: "Multimedia", video: "Multimedia",
  storage: "Data Storage", archive: "Archiving", archives: "Archiving", admin: "Administration",
  script: "Scripting", scripts: "Scripting", localisation: "Localization", "language": "Localization",
};

const BY_LOWER = new Map(SECTION_ICONS.map((n) => [n.toLowerCase(), n]));
const find = (s) => {
  const k = String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return k ? BY_LOWER.get(k) ?? ALIASES[k] ?? null : null;
};

export function sectionIconName(section) {
  const raw = String(section ?? "").replace(/_/g, " ").trim();
  if (!raw) return null;
  const mapped = sectionName(raw); // Sections.plist (exact case, as Cydia)
  const simple = simpleSection(mapped);
  const hit = find(simple) ?? find(sectionName(simple));
  if (hit) return hit;
  const inner = mapped.match(/\(([^()]*)\)\s*$/); // "Apps (Games)" -> Games
  return inner ? find(inner[1]) : null;
}

export function sectionIconUrl(section) {
  const n = sectionIconName(section);
  return n ? `${ICON_DIR}${n.replace(/ /g, "_")}.png` : null;
}

export function purposeBadgeUrl(purpose) {
  const p = String(purpose ?? "").trim().toLowerCase();
  return PURPOSES.includes(p) ? `${ICON_DIR}purposes/${p}.png` : null;
}

// Cydia's primaryPurpose: the first `purpose::` tag of a Tag field ("purpose::extension, role::enduser").
export function primaryPurpose(tag) {
  for (const t of String(tag ?? "").split(",")) {
    const s = t.trim();
    if (s.startsWith("purpose::")) return s.slice(9) || null;
  }
  return null;
}

export function packageIcon(row) {
  const own = String(row?.icon ?? row?.iconUrl ?? "").trim();
  const src = /^(https?:\/\/|data:image\/)/i.test(own) ? own : null;
  const section = sectionIconUrl(row?.section);
  const purpose = purposeBadgeUrl(row?.purpose);
  const badge = purpose ?? (src && section) ?? null;
  return { src, fallback: section ?? UNKNOWN_ICON, badge, badgeKind: purpose ? "purpose" : badge ? "section" : null };
}
