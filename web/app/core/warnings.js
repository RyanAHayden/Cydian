// Source Warning (F19): Cydia asked saurik's server (api/repotag, docs/cydia.md "Adding a source") whether a repo
// was a known piracy source and showed "Source Warning" with Cancel / Add Anyway. iFizBox keeps its own list, here,
// with a reason and a link for every entry, and asks nobody: the check runs before Add Source fetches anything.
//
//   sourceWarning(input)  -> the matching entry { host, reason, link }, or null. `input` is what Add Source gets: a
//                            URL, a bare host, a sideloader link (altstore://source?url=...), or { uri, dist }.
//   SOURCE_WARNINGS       -> the list
//
// Matching is on the host (lower case, a leading "www." dropped): the host itself or any subdomain of it, as
// Canister's repository/safety API does (F228, R23: x.repo.hackyouriphone.org matches repo.hackyouriphone.org).
// Never the other way: a parent domain (xarold.com, github.io) matches nothing unless it is listed itself, so a
// warning names one repo, not everyone else on its domain (several entries are on shared hosts).
//
// F228: after these hand-written entries (which win), Canister's whole piracy list, copied at build time by
// tools/sync-piracy-list.py into core/piracy-list.js (145 hosts; four developers' pages left out, see the script).
// Those carry a generic reason and a link to their manifest file. Nothing is asked at runtime.
//
// Where the entries come from: Canister's piracy list (github.com/cnstr/manifests, configs/piracy-list, MIT), the
// "List of blacklisted repositories that power Canister's piracy API", read 2026-11-17. Only well-known repos are
// copied: the ones whose piracy is the reason they are known (cracked tweaks, cracked App Store apps). To add one,
// give the host, a one-line reason in plain words, and a public link that backs it up.

import { PIRACY_HOSTS } from "./piracy-list.js";

const CANISTER = (host) => `https://github.com/cnstr/manifests/blob/main/configs/piracy-list/${host}`;
const TWEAKS = "Hands out paid tweaks without their developers' consent (piracy).";
const APPS = "Hands out cracked App Store apps (piracy).";

export const SOURCE_WARNINGS = [
  { host: "repo.hackyouriphone.org", reason: TWEAKS },
  { host: "julio.hackyouriphone.org", reason: TWEAKS },
  { host: "repo.xarold.com", reason: TWEAKS },
  { host: "cydia.xarold.com", reason: TWEAKS },
  { host: "julio.xarold.com", reason: TWEAKS },
  { host: "cydia.kiiimo.org", reason: TWEAKS },
  { host: "cydia.xsellize.com", reason: TWEAKS },
  { host: "repo.biteyourapple.net", reason: TWEAKS },
  { host: "repo.insanelyi.com", reason: TWEAKS },
  { host: "sinfuliphonerepo.com", reason: TWEAKS },
  { host: "ihacksrepo.com", reason: TWEAKS },
  { host: "mainrepo.org", reason: TWEAKS },
  { host: "repo.cydiafire.com", reason: TWEAKS },
  { host: "cydia.iphonecake.com", reason: APPS },
  { host: "cydia.hackulo.us", reason: APPS },
  { host: "appaddict.com", reason: APPS },
  { host: "appaddict.org", reason: APPS },
  { host: "apt.tongbu.com", reason: APPS },
].map((e) => ({ ...e, link: e.link ?? CANISTER(e.host) }));

export const LISTED_REASON = "Listed as a piracy source by Canister.";

// F228: Canister's list (core/piracy-list.js), for the hosts the hand-written entries don't cover.
export const PIRACY_WARNINGS = PIRACY_HOSTS.filter((h) => !SOURCE_WARNINGS.some((e) => e.host === h))
  .map((host) => ({ host, reason: LISTED_REASON, link: CANISTER(host) }));

const BY_HOST = new Map([...PIRACY_WARNINGS, ...SOURCE_WARNINGS].map((e) => [e.host, e]));

// The entry for a host or the nearest listed parent of it (a.b.host -> b.host -> host), or null. Stops before
// the last label: a bare top-level domain is never a match.
export function hostWarning(host) {
  let h = String(host ?? "").toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  while (h.includes(".")) {
    const e = BY_HOST.get(h);
    if (e) return e;
    h = h.slice(h.indexOf(".") + 1);
  }
  return null;
}

// The host a source input names, or null.
export function inputHost(input) {
  let s = input && typeof input === "object" ? input.uri : input;
  s = String(s ?? "").trim();
  // F228: a catalog source key (core/sources.js sourceKey: deb:<uri>:<dist>), as Installed's rows carry.
  // An AltStore source's key is alt:<url> (core/altstore.js altKey).
  const key = /^deb:(.+):[^:]*$/.exec(s) || /^alt:(.+)$/.exec(s);
  if (key) s = key[1];
  if (!s) return null;
  // A sideloader link carries the source in its url= parameter.
  const link = /^[a-z][a-z0-9+.-]*:\/\/[^?]*\?(?:.*&)?url=([^&]+)/i.exec(s);
  if (link && !/^https?:/i.test(s)) {
    try { s = decodeURIComponent(link[1]); } catch { return null; }
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try {
    const h = new URL(s).hostname.toLowerCase().replace(/\.$/, "");
    return h ? h.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function sourceWarning(input) {
  const host = inputHost(input);
  return host ? hostWarning(host) : null;
}

// F228: Installed's check. A package (or app) row's source, by its catalog key (or its source URL), when that source is
// on the list: the entry, else null. The key is the source the catalog has the package from; dpkg doesn't record
// where an installed package came from, so this is the best guess the page has.
export const PIRACY_SUBTITLE = "From a piracy source";
export function packageWarning(row) {
  return sourceWarning(row?.key || row?.source || "") || null;
}

// The rows with a flagged source marked: `piracy` the entry, the description replaced by PIRACY_SUBTITLE.
export function flagPiracy(rows) {
  return rows.map((r) => {
    const w = r && !r.header ? packageWarning(r) : null;
    return w ? { ...r, piracy: w, short: PIRACY_SUBTITLE } : r;
  });
}

// The alert's text, Cydia's title and buttons (SOURCE_WARNING; Cancel / Add Anyway).
export function warningAlert(entry) {
  return {
    title: "Source Warning",
    message: `${entry.host}\n\n${entry.reason}\n\nListed at ${entry.link}`,
    buttons: ["Cancel", "Add Anyway"],
    cancel: 0,
  };
}
