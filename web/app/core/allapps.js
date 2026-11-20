// Sources' "All Apps" row: one list of every app from every AltStore source, at the top of Sources (where All
// Sources sits). Its route is the Sources tab's `[ALL_APPS]` (a key no source can have), and the pages under it
// (`[ALL_APPS, "package:<id>"]`) read the catalog's merged list ("*"), so an app opens with its newest version, as
// its own source shows it. Pure, for screens/sources.js and screens/browse.js.
import { isAltKey } from "./altstore.js";
import { compareVersions } from "./apt.js";

export const ALL_APPS = "*apps";

export const ALL_APPS_LABEL = "All Apps";
export const ALL_APPS_SUBTITLE = "combined app list for the AltStore sources below";

// The catalog's merged rows ("*", already one per id, newest version) -> the AltStore apps only, one per bundle ID:
// a source may list one bundle ID under several ids (`<bundle>~<n>`), and the newest version wins (the first row
// on a tie). The rows' order (by name) is kept.
export function allAppsRows(rows) {
  const best = new Map();
  for (const r of rows ?? []) {
    if (!r || !isAltKey(r.key)) continue;
    const bundle = String(r.id ?? "").split("~")[0];
    const cur = best.get(bundle);
    if (!cur || compareVersions(String(cur.version ?? ""), String(r.version ?? "")) < 0) best.set(bundle, r);
  }
  const keep = new Set(best.values());
  return rows.filter((r) => keep.has(r));
}

// Which combined rows top the Sources list. `appsOnly`: the device type shows AltStore sources only (Not
// Jailbroken, the sideload build), where All Apps takes All Sources' place. Otherwise All Sources stays for APT and
// All Apps joins it once an AltStore source is added. Neither while a search is on.
export function topRowsOf({ appsOnly = false, hasAlt = false, searching = false } = {}) {
  if (searching) return { allSources: false, allApps: false };
  return { allSources: !appsOnly, allApps: appsOnly || hasAlt };
}
