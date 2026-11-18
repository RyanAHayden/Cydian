// I3: the remembered apps' updates in Changes (core/appupdates.js), and the sideload app's background check fed.
//
//   upgrades = await withAppUpgrades(upgrades, holds);   // screens/changes.js, after catalog.upgrades
//
// Where there's no dpkg (the site, the sideload app), each app recorded by Install or Mark as Installed is matched
// against the newest version any loaded source offers this phone; a newer one joins Available Upgrades, so the tab
// badge counts it, and in the app the icon badge too (settings.js createUpgradeNotices). The jailbreak app is left
// as it was: dpkg's status file is what's installed there (I4 reads real app versions).
//
// The sideload app then hands its shell what to follow while Cydian isn't open (BackgroundCheck.swift):
//   updates.watch { apps: [{ id, name, version, source }], known: ["<id> <version>"] } -> { scheduled }
// `known` are the upgrades already counted on screen: the background check only notifies about ones beyond them.
// Cydian itself is followed through its own source (essential.js SELF_ALT_URL). Sent again only when it changes.
// SPDX-License-Identifier: GPL-3.0-or-later
import { catalog } from "./catalog.js";
import { apps } from "./core/installed.js";
import { detectMode } from "./core/settings.js";
import { SELF_ALT_URL } from "./core/essential.js";
import { rememberedUpgrades, mergeUpgrades, watchList, upgradeKeys, SELF_ID } from "./core/appupdates.js";

let lastSent = null;

// The source's row for each remembered app, as screens/installed.js candidates() finds it.
async function candidates(records) {
  const out = new Map();
  await Promise.all(records.filter((r) => r?.id && !r.self).map(async (r) => {
    const p = await catalog.package(r.id).catch(() => null);
    if (p?.key && p.stanza?.version) out.set(r.id, { ...(p.row ?? {}), id: r.id, version: p.stanza.version, key: p.key });
  }));
  return out;
}

// What the shell follows: the watch list, plus Cydian itself at the version it runs.
export function shellWatch(records, available) {
  const list = watchList(records);
  const me = (records ?? []).find((r) => r?.self && r.id === SELF_ID && r.version);
  if (me) list.unshift({ id: SELF_ID, name: "Cydian", version: String(me.version), source: SELF_ALT_URL });
  return { apps: list, known: upgradeKeys(available) };
}

export async function withAppUpgrades(upgrades, holds = [], { mode = detectMode(), native = globalThis.cydianNative, store = apps } = {}) {
  if (mode === "jailbreak") return upgrades;
  let records = [];
  try { records = await (await store()).all(); } catch { return upgrades; }
  const cands = records.length ? await candidates(records) : new Map();
  const merged = mergeUpgrades(upgrades, rememberedUpgrades(records, (id) => cands.get(id) ?? null, holds));
  if (mode === "sideload" && native?.call) {
    const watch = shellWatch(records, merged.available);
    const json = JSON.stringify(watch);
    if (json !== lastSent) {
      lastSent = json;
      Promise.resolve().then(() => native.call("updates.watch", watch)).catch(() => { lastSent = null; });
    }
  }
  return merged;
}
