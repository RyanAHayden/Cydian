// Source Warning (F19): Cydia asked saurik's server (api/repotag, docs/cydia.md "Adding a source") whether a repo
// was a known piracy source and showed "Source Warning" with Cancel / Add Anyway. Cydian keeps its own list, here,
// with a reason and a link for every entry, and asks nobody: the check runs before Add Source fetches anything.
//
//   sourceWarning(input)  -> the matching entry { host, reason, link }, or null. `input` is what Add Source gets: a
//                            URL, a bare host, a sideloader link (altstore://source?url=...), or { uri, dist }.
//   SOURCE_WARNINGS       -> the list
//
// Matching is on the host (lower case, a leading "www." dropped), exact: a warning names one repo, not everyone
// else on its domain (several entries are on shared hosts).
//
// Where the entries come from: Canister's piracy list (github.com/cnstr/manifests, configs/piracy-list, MIT), the
// "List of blacklisted repositories that power Canister's piracy API", read 2026-11-17. Only well-known repos are
// copied: the ones whose piracy is the reason they are known (cracked tweaks, cracked App Store apps). To add one,
// give the host, a one-line reason in plain words, and a public link that backs it up.

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

const BY_HOST = new Map(SOURCE_WARNINGS.map((e) => [e.host, e]));

// The host a source input names, or null.
export function inputHost(input) {
  let s = input && typeof input === "object" ? input.uri : input;
  s = String(s ?? "").trim();
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
  return (host && BY_HOST.get(host)) || null;
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
