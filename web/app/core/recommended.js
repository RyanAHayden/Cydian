// Recommended (F45, Sources > Manage > Recommended): the curated sources and games, one tap to add. This is the
// one place the list lives: add, drop or reword an entry here and nothing else changes. Every entry says why it
// is on the list. Each URL answered with a working source on 2026-11-17 (checked with curl).
//
//   source: { kind: "source", url, name, why, jailbreak? }   jailbreak: an APT repo (hidden on Not Jailbroken)
//   game:   { kind: "game", url, bundleId, name, why }        url: the AltStore source that lists it

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
  { kind: "source", name: "Havoc", url: "https://havoc.app/", jailbreak: true,
    why: "A large, actively maintained tweak store with rootless builds." },
  { kind: "source", name: "Chariz", url: "https://repo.chariz.com/", jailbreak: true,
    why: "A long-running tweak store with rootless builds of most of its packages." },
  { kind: "source", name: "ElleKit", url: "https://ellekit.space/", jailbreak: true,
    why: "The tweak injection library rootless jailbreaks use, from its own repo." },
  { kind: "source", name: "palera1n", url: "https://repo.palera.in/", jailbreak: true,
    why: "palera1n's official repo, for phones jailbroken with it." },
];

export const RECOMMENDED_GAMES = [
  { kind: "game", name: "openMX", bundleId: "io.github.fizl0.openmx", url: "https://fizl0.github.io/apps/source.json",
    why: "A motocross game, from the FIZL0 source." },
  { kind: "game", name: "OpenTennis", bundleId: "io.github.fizl0.hst", url: "https://fizl0.github.io/apps/source.json",
    why: "A tennis game, from the FIZL0 source." },
  { kind: "game", name: "Party Board", bundleId: "com.mariopartyrd.partyboard", url: "https://fizl0.github.io/apps/source.json",
    why: "A party board game, from the FIZL0 source." },
  { kind: "game", name: "Delta", bundleId: "com.rileytestut.Delta", url: "https://apps.altstore.io/",
    why: "The best-known classic console emulator for iPhone." },
  { kind: "game", name: "PPSSPP", bundleId: "org.ppsspp.ppsspp", url: "https://community-apps.sidestore.io/sidecommunity.json",
    why: "The PSP emulator, mature and fast." },
  { kind: "game", name: "RetroArch", bundleId: "com.libretro.RetroArchiOS11", url: "https://community-apps.sidestore.io/sidecommunity.json",
    why: "Many emulators (cores) behind one front end." },
];
