// I3: the remembered apps' updates in Changes (core/appupdates.js), and the sideload app's background check fed.
//
//   upgrades = await withAppUpgrades(upgrades, holds);   // screens/changes.js, after catalog.upgrades
//
// Where there's no dpkg (the site, the sideload app), each app recorded by Install or Mark as Installed is matched
// against the newest version any loaded source offers this phone; a newer one joins Available Upgrades, so the tab
// badge counts it, and in the app the icon badge too (settings.js createUpgradeNotices). The jailbreak app is left
// as it was: dpkg's status file is what's installed there (I4 reads real app versions).
//
// F87: the jailbreak app does count the remembered apps now, at the version on the phone: rememberedApps() runs the
// records through backend.installedApps (I4, backend-native.js withRealVersions), so an app updated outside iFizBox
// is compared at its real version, and one no longer installed (`actual` null) is left out. dpkg's rows win where
// both list an id. Where the real versions can't be read (an older helper) the remembered ones stand, as in the
// sideload app. The Installed tab's Apps page and the app page show the record's `note` (screens/installed.js,
// screens/browse.js).
//
// The sideload app then hands its shell what to follow while iFizBox isn't open (BackgroundCheck.swift):
//   updates.watch { apps: [{ id, name, version, source }], known: ["<id> <version>"] } -> { scheduled }
// `known` are the upgrades already counted on screen: the background check only notifies about ones beyond them.
// iFizBox itself is followed through its own source (essential.js SELF_ALT_URL). Sent again only when it changes.
// SPDX-License-Identifier: GPL-3.0-or-later
import { catalog } from "./catalog.js";
import { getBackend } from "./backend.js";
import { apps } from "./core/installed.js";
import { detectMode } from "./core/settings.js";
import { SELF_ALT_URL } from "./core/essential.js";
import { rememberedUpgrades, mergeUpgrades, watchList, upgradeKeys, altSourceOf, SELF_ID } from "./core/appupdates.js";
import { NAME } from "./brand.js";

let lastSent = null;

// The source's row for each remembered app, as screens/installed.js candidates() finds it. B47: `failed` counts the
// lookups that threw (the catalog not there), so a watch list isn't built from a half answer.
async function candidates(records, lookup = (id) => catalog.package(id)) {
  const out = new Map();
  let failed = 0;
  await Promise.all(records.filter((r) => r?.id && !r.self).map(async (r) => {
    const p = await Promise.resolve().then(() => lookup(r.id)).catch(() => { failed++; return null; });
    if (p?.key && p.stanza?.version) out.set(r.id, { ...(p.row ?? {}), id: r.id, version: p.stanza.version, key: p.key });
  }));
  return { cands: out, failed };
}

// What the shell follows: the watch list, plus iFizBox itself at the version it runs.
// B47: with `cands` (the Changes rows candidates() found), each app is followed at the AltStore source Changes reads
// it from, and only then: an app whose source was removed, or that no source lists, has no row in Changes, so the
// background check must not count it either (it used to fetch the record's own source and badge an update Changes
// never showed). `ignored`: Changes' Ignored Upgrades (holds, blocked), never followed. Without `cands` (old callers)
// the record's own source.
export function shellWatch(records, available, { cands = null, ignored = [] } = {}) {
  const sourceOf = cands ? (id) => altSourceOf(cands.get(id)?.key) : null;
  const list = watchList(records, { sourceOf, ignored });
  const me = (records ?? []).find((r) => r?.self && r.id === SELF_ID && r.version);
  if (me) list.unshift({ id: SELF_ID, name: NAME, version: String(me.version), source: SELF_ALT_URL });
  return { apps: list, known: upgradeKeys(available) };
}

// F87: the remembered apps (core/installed.js records); in the jailbreak app with the real versions and notes of
// backend.installedApps (I4), as they are where it can't say. Rejects only when the store can't be opened.
export async function rememberedApps({ mode = detectMode(), backend = null, store = apps } = {}) {
  const records = await (await store()).all();
  if (mode !== "jailbreak" || !records.length) return records;
  const b = backend ?? getBackend();
  if (typeof b?.installedApps !== "function") return records;
  try { return (await b.installedApps(records)) ?? records; } catch { return records; }
}

export async function withAppUpgrades(upgrades, holds = [], { mode = detectMode(), native = globalThis.ifizboxNative, store = apps,
  backend = null, lookup } = {}) {
  if (mode === "jailbreak") {
    let records;
    try { records = (await rememberedApps({ mode, backend, store })).filter((r) => r?.actual !== null); } catch { return upgrades; }
    if (!records.some((r) => r?.id && !r.self)) return upgrades;
    const { cands } = await candidates(records, lookup);
    return mergeUpgrades(upgrades, rememberedUpgrades(records, (id) => cands.get(id) ?? null, holds));
  }
  let records = [];
  try { records = await (await store()).all(); } catch { return upgrades; }
  const { cands, failed } = records.length ? await candidates(records, lookup) : { cands: new Map(), failed: 0 };
  const merged = mergeUpgrades(upgrades, rememberedUpgrades(records, (id) => cands.get(id) ?? null, holds));
  // B47: a lookup that threw leaves the shell's last list as it is, rather than dropping apps Changes would count.
  if (mode === "sideload" && native?.call && !failed) {
    const ignored = [...new Set([...(holds ?? []), ...merged.ignored.map((r) => r.id)])];
    const watch = shellWatch(records, merged.available, { cands, ignored });
    const json = JSON.stringify(watch);
    if (json !== lastSent) {
      lastSent = json;
      Promise.resolve().then(() => native.call("updates.watch", watch)).catch(() => { lastSent = null; });
    }
  }
  return merged;
}
