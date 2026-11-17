// Recommended (F45, Sources > Manage > Recommended): the curated sources, one tap to add. F52 dropped the games: this
// page lists sources; a recommended game is a package and belongs on Home's Browse/Featured. This is the
// one place the list lives: add, drop or reword an entry here and nothing else changes. Every entry says why it
// is on the list. Each URL answered with a working source on 2026-11-17 (checked with curl).
//
//   source: { kind: "source", url, name, why, jailbreak?, for? }   jailbreak: an APT repo (hidden on Not Jailbroken);
//                                                                 for: the jailbreaks it suits (F19)

export const RECOMMENDED_SOURCES = [
  { kind: "source", name: "FIZL0", url: "https://fizl0.github.io/apps/source.json",
    why: "openMX, OpenTennis and Party Board in one source: the games Cydian's default list is built around." },
  { kind: "source", name: "AltStore", url: "https://apps.altstore.io/",
    why: "The official AltStore source: AltStore, Delta and Clip, by Riley Testut." },
  { kind: "source", name: "SideStore Team Picks", url: "https://community-apps.sidestore.io/sidecommunity.json",
    why: "SideStore's hand-picked list of emulators and tools that sideload cleanly." },
  { kind: "source", name: "Provenance", url: "https://provenance-emu.com/apps.json",
    why: "The Provenance multi-system emulator, from its own developers." },
  { kind: "source", name: "Feather", url: "https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json",
    why: "Feather, the on-device signer Cydian's sideload installs go through." },
  { kind: "source", name: "Havoc", url: "https://havoc.app/", jailbreak: true, for: ["dopamine", "palera1n", "nathanlr"],
    why: "A large, actively maintained tweak store with rootless builds." },
  { kind: "source", name: "Chariz", url: "https://repo.chariz.com/", jailbreak: true, for: ["dopamine", "palera1n", "nathanlr"],
    why: "A long-running tweak store with rootless builds of most of its packages." },
  { kind: "source", name: "ElleKit", url: "https://ellekit.space/", jailbreak: true, for: ["dopamine", "palera1n"],
    why: "The tweak injection library rootless jailbreaks use, from its own repo." },
  { kind: "source", name: "palera1n", url: "https://repo.palera.in/", jailbreak: true, for: ["palera1n"],
    why: "palera1n's official repo, for phones jailbroken with it." },
];

// ---- F19: recommended for the jailbreak ------------------------------------------------------------------------
// An APT entry's `for` names the jailbreaks it suits. Where each list comes from (read 2026-11-17):
//   dopamine  Dopamine's own default.sources (opa334/Dopamine DOBootstrapper.m): Chariz, Havoc, BigBoss, ElleKit.
//             BigBoss is a dist repo (stable/main), which Recommended can't add yet, so it is left out here.
//   palera1n  palera1n's loader config (palera.in/loader.json, "repositories"): repo.palera.in and ElleKit; Havoc
//             and Chariz for tweaks, since its bootstrap adds no store.
//   nathanlr  a semi-jailbreak (verygenericname/nathanlr) whose app writes no apt sources: the rootless stores.
// `other` (no jailbreak picked or found) gets every APT entry, as before F19.

export const JAILBREAKS = [
  { id: "dopamine", name: "Dopamine" },
  { id: "palera1n", name: "palera1n" },
  { id: "nathanlr", name: "nathanlr" },
  { id: "other", name: "Other" },
];

export const jailbreakName = (id) => JAILBREAKS.find((j) => j.id === id)?.name ?? "Other";

// Which jailbreak set up apt, from its source files ([{ path, text }], backend-native aptSourceFiles): palera1n's
// loader writes sources.list.d/palera1n.sources, Dopamine writes sources.list.d/default.sources holding its four
// repos. null when neither is there (nathanlr, an older jailbreak, the site).
export function detectJailbreak(files) {
  const list = Array.isArray(files) ? files : [];
  const name = (f) => String(f?.path ?? "").split("/").pop();
  if (list.some((f) => name(f) === "palera1n.sources")) return "palera1n";
  const dopamine = ["repo.chariz.com", "havoc.app", "ellekit.space"];
  if (list.some((f) => name(f) === "default.sources" && dopamine.every((h) => String(f?.text ?? "").includes(h)))) return "dopamine";
  return null;
}

// The entries for a jailbreak, its own first: AltStore sources stay (they suit any phone); an APT entry shows when
// its `for` names the jailbreak, or always for "other"/null.
export function recommendedFor(recs, jailbreak) {
  const all = Array.isArray(recs) ? recs : [];
  if (!jailbreak || jailbreak === "other") return all;
  const apt = all.filter((r) => r.jailbreak && (!r.for || r.for.includes(jailbreak)));
  return [...apt, ...all.filter((r) => !r.jailbreak)];
}

// The user's pick on Recommended (localStorage), else what was detected.
export const JAILBREAK_KEY = "cydian.jailbreakName";
export function savedJailbreak(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(JAILBREAK_KEY);
    return JAILBREAKS.some((j) => j.id === v) ? v : null;
  } catch { return null; }
}
export function saveJailbreak(id, storage = globalThis.localStorage) {
  try { if (id) storage?.setItem(JAILBREAK_KEY, id); else storage?.removeItem(JAILBREAK_KEY); } catch { /* private mode */ }
}

// F19 first run: the Sources tab shows a "Recommended for <jailbreak>" row until Recommended has been opened once.
export const FIRST_RUN_KEY = "cydian.recommendedSeen";
export function recommendedSeen(storage = globalThis.localStorage) {
  try { return storage?.getItem(FIRST_RUN_KEY) === "1"; } catch { return true; }
}
export function markRecommendedSeen(storage = globalThis.localStorage) {
  try { storage?.setItem(FIRST_RUN_KEY, "1"); } catch { /* private mode */ }
}
