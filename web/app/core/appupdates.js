// I3: updates to the apps iFizBox remembers (core/installed.js, F30), where there's no dpkg to ask (the site and the
// sideload app). Tapping Install on an app page records the version it installs; when a source later lists a newer
// one, it shows in Changes under Available Upgrades beside dpkg's (so the tab badge and, in the app, the icon badge
// count it), and the sideload app's shell checks for it in the background (native/Sources/BackgroundCheck.swift,
// with the same rules in native/sign/Updates.swift).
//
//   rememberedUpgrades(records, candidateOf, holds) -> { available, ignored }: findUpgrades' row shape, the source's
//       row with `installed` = the remembered version; Settings' Ignored Upgrades (holds) go to ignored
//   mergeUpgrades(a, b)        -> one { available, ignored }, each id once (a's row wins), sorted by name
//   watchList(records)         -> [{ id, name, version, source }] the shell's background check follows
//   upgradeKeys(rows)          -> ["<id> <version>"]: the upgrades already counted on screen (the shell's "known")
//   updatesTitle(n)            -> "1 Update" | "<n> Updates" (the notification's title; Updates.swift title(_:))
// SPDX-License-Identifier: GPL-3.0-or-later
import { compareVersions } from "./apt.js";

export const SELF_ID = "com.ryha.ifizbox"; // core/installed.js SELF_ID: iFizBox's own row is essential.js's

const byName = (a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), undefined, { sensitivity: "base" }) ||
  String(a.id).localeCompare(String(b.id));

// `candidateOf(id)`: the source's row for the app ({ id, name, version, key, icon, ... }) or null.
export function rememberedUpgrades(records, candidateOf, holds = []) {
  const ignoredIds = new Set(holds);
  const available = [];
  const ignored = [];
  for (const rec of records ?? []) {
    if (!rec?.id || rec.self || rec.id === SELF_ID || !rec.version) continue;
    const cand = candidateOf(rec.id);
    if (!cand?.version || compareVersions(cand.version, rec.version) <= 0) continue;
    const row = { ...cand, id: rec.id, name: cand.name || rec.name, icon: cand.icon ?? rec.icon ?? null, installed: rec.version, remembered: true };
    (ignoredIds.has(rec.id) ? ignored : available).push(row);
  }
  return { available: available.sort(byName), ignored: ignored.sort(byName) };
}

export function mergeUpgrades(a, b) {
  const merge = (x = [], y = [], skip = new Set()) => {
    const seen = new Set(skip);
    const out = [];
    for (const r of [...x, ...y]) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  };
  // An id ignored on either side stays ignored; essential.js puts iFizBox's own row first, and it stays first.
  const ignored = merge(a?.ignored, b?.ignored).sort(byName);
  const ignoredIds = new Set(ignored.map((r) => r.id));
  const available = merge(a?.available, b?.available, ignoredIds);
  const self = available.filter((r) => r.id === SELF_ID);
  return { available: [...self, ...available.filter((r) => r.id !== SELF_ID).sort(byName)], ignored };
}

const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

export function watchList(records) {
  const out = [];
  for (const r of records ?? []) {
    const source = httpUrl(r?.source);
    if (!r?.id || r.self || r.id === SELF_ID || !r.version || !source) continue;
    out.push({ id: String(r.id), name: String(r.name || r.id), version: String(r.version), source });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const upgradeKeys = (rows) => (rows ?? []).filter((r) => r?.id && r.version).map((r) => `${r.id} ${r.version}`).sort();

export const updatesTitle = (n) => (n === 1 ? "1 Update" : `${n} Updates`);
