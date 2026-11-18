import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCatalog } from "./catalog.js";
import {
  SECTION_ICONS, PURPOSES, UNKNOWN_ICON, sectionIconName, sectionIconUrl, purposeBadgeUrl, primaryPurpose, packageIcon,
} from "./sectionicons.js";

const APP = fileURLToPath(new URL("../", import.meta.url));

test("every section icon, purpose badge and unknown.png is in icons/sections/", () => {
  assert.equal(SECTION_ICONS.length, 39);
  for (const n of SECTION_ICONS) assert.ok(existsSync(APP + sectionIconUrl(n)), n);
  for (const p of PURPOSES) assert.ok(existsSync(APP + purposeBadgeUrl(p)), p);
  assert.ok(existsSync(APP + UNKNOWN_ICON));
  assert.ok(existsSync(APP + "icons/sections/README.md"), "the artwork's credit and licence");
});

test("sections map by name as Cydia does: _ to space, Sections.plist, Simplify()", () => {
  assert.equal(sectionIconName("Tweaks"), "Tweaks");
  assert.equal(sectionIconName("Themes (SpringBoard)"), "Themes");
  assert.equal(sectionIconName("Addons (SBSettings)"), "Addons");
  assert.equal(sectionIconName("Terminal_Support"), "Terminal Support");
  assert.equal(sectionIconName("Site-Specific"), "Site-Specific Apps"); // Sections.plist
  assert.equal(sectionIconName("Utilites"), "Utilities");               // Sections.plist's typo fix
  assert.equal(sectionIconName("SBSettings Addons"), "Addons");          // -> Addons (SBSettings) -> Addons
  assert.equal(sectionIconName("[Tweaks]"), "Tweaks");
  assert.equal(sectionIconName("Wallpapers"), "Wallpaper");
  assert.equal(sectionIconUrl("Site-Specific Apps"), "icons/sections/Site-Specific_Apps.png");
  assert.equal(sectionIconUrl("Health and Fitness"), "icons/sections/Health_and_Fitness.png");
});

test("case-insensitive, with common aliases and the bracketed part last", () => {
  assert.equal(sectionIconName("tweaks"), "Tweaks");
  assert.equal(sectionIconName("TWEAK"), "Tweaks");
  assert.equal(sectionIconName("utility"), "Utilities");
  assert.equal(sectionIconName("theme"), "Themes");
  assert.equal(sectionIconName("  text   editors "), "Text Editors");
  assert.equal(sectionIconName("Developer Tools"), "Development");
  assert.equal(sectionIconName("eBooks"), "Books");
  assert.equal(sectionIconName("Apps (Games)"), "Games"); // AltStore's category
  assert.equal(sectionIconName("Libraries"), null);       // Cydia has no icon for it: unknown.png
  assert.equal(sectionIconName("(No Section)"), null);
  assert.equal(sectionIconName(""), null);
  assert.equal(sectionIconName(undefined), null);
});

test("purpose badges: Cydia's first purpose:: tag, its seven only", () => {
  assert.equal(primaryPurpose("role::enduser, purpose::extension, purpose::uikit"), "extension");
  assert.equal(primaryPurpose("role::enduser"), null);
  assert.equal(purposeBadgeUrl("extension"), "icons/sections/purposes/extension.png");
  assert.equal(purposeBadgeUrl("UIKit"), "icons/sections/purposes/uikit.png");
  assert.equal(purposeBadgeUrl("nonsense"), null);
  assert.equal(purposeBadgeUrl(null), null);
});

test("the badge rule: no own icon -> the section icon, no badge; own icon -> the section icon as badge", () => {
  assert.deepEqual(packageIcon({ section: "Tweaks", icon: null }),
    { src: null, fallback: "icons/sections/Tweaks.png", badge: null, badgeKind: null });
  assert.deepEqual(packageIcon({ section: "Tweaks", icon: "https://r.test/i.png" }),
    { src: "https://r.test/i.png", fallback: "icons/sections/Tweaks.png", badge: "icons/sections/Tweaks.png", badgeKind: "section" });
  // A section with no icon: unknown.png, and nothing to badge an own icon with.
  assert.deepEqual(packageIcon({ section: "Libraries", icon: "https://r.test/i.png" }),
    { src: "https://r.test/i.png", fallback: UNKNOWN_ICON, badge: null, badgeKind: null });
  assert.deepEqual(packageIcon({ section: "Libraries" }), { src: null, fallback: UNKNOWN_ICON, badge: null, badgeKind: null });
  // Cydia's purpose badge wins, own icon or not (PackageCell draws it over whatever icon it has).
  assert.equal(packageIcon({ section: "Tweaks", purpose: "extension" }).badge, "icons/sections/purposes/extension.png");
  assert.equal(packageIcon({ section: "Tweaks", purpose: "extension", icon: "https://r.test/i.png" }).badgeKind, "purpose");
  // file:/// and relative icons aren't loadable on the web: treated as none.
  assert.equal(packageIcon({ section: "Tweaks", icon: "file:///Applications/X.app/icon.png" }).src, null);
  assert.equal(packageIcon({ section: "Tweaks", iconUrl: "https://r.test/s.png" }).src, "https://r.test/s.png"); // a stanza
});

test("catalog rows carry the purpose tag for the badge", () => {
  const c = createCatalog();
  c.load("k", [
    "Package: a.tweak\nName: A\nVersion: 1\nSection: Tweaks\nArchitecture: iphoneos-arm64\nTag: role::enduser, purpose::extension\n",
    "Package: b.plain\nName: B\nVersion: 1\nSection: Utilities\nArchitecture: iphoneos-arm64\n",
  ].join("\n"), "https://r.test/", "iphoneos-arm64");
  const rows = c.list("k", "*");
  assert.equal(rows.find((r) => r.id === "a.tweak").purpose, "extension");
  assert.equal(rows.find((r) => r.id === "b.plain").purpose, null);
});
