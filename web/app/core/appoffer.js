// I7: the website offers the Cydian app itself. Pure: no DOM, no network; screens/home.js draws what these answer,
// and core/appoffer.test.js covers every case.
//
// Where the offer shows (the website only: nothing inside the app, which is already installed):
//   Home, the Install Cydian App tile
//     Not Jailbroken                      F93: Cydian's IPA signed in the browser with the user's certificate and
//                                         installed (screens/home.js installApp), or Settings > Signing first
//     jailbroken (rootless, ...)          downloads the release's .deb for that architecture, to open in Sileo or
//                                         Filza; an architecture with no .deb yet is told so
//   Cydian's own package page: its AltStore source (web/app/source.json, first in DEFAULT_ALT_SOURCES).

export const REPO_URL = "https://github.com/RyanAHayden/Cydian";
// The release assets native/build.sh makes (tools/release.sh uploads them): latest/download always names the newest.
export const APP_IPA_URL = `${REPO_URL}/releases/latest/download/Cydian.ipa`;
export const APP_DEB_URL = `${REPO_URL}/releases/latest/download/Cydian.deb`; // rootless, iphoneos-arm64
// Cydian's own AltStore source, kept current with native/VERSION by test_release.py.
export const APP_SOURCE_URL = "https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json";
export const APP_NAME = "Cydian";
export const APP_LABEL = "Install App"; // half of Home's split button: Install App | Send Settings

const NOT_JAILBROKEN = "none";

// Home's tile: null (no tile), or { action }:
//   "sideloaders"  Not Jailbroken: sign Cydian in the browser and install it (F93; the name is F89's)
//   "deb"          download the .deb for `deviceType` (an APT arch): { action: "deb", arch }
// mode: core/settings.js detectMode(); deviceType: settings.deviceType() ("none" or an arch).
export function homeOffer({ mode = "site", deviceType = NOT_JAILBROKEN } = {}) {
  if (mode !== "site") return null;
  if (deviceType && deviceType !== NOT_JAILBROKEN) return { action: "deb", arch: deviceType };
  return { action: "sideloaders" };
}

// The .deb for an architecture: from the latest release (core/selfupdate.js parseRelease + debFor) when GitHub
// answered, else the plain Cydian.deb, which is the rootless build. Null when no build fits the arch.
export function debUrl(arch, { release = null, debFor = null } = {}) {
  if (release && debFor) {
    const u = debFor(release, arch);
    if (u) return u;
  }
  return !arch || arch === "iphoneos-arm64" ? APP_DEB_URL : null;
}

const ARCH_NAMES = { "iphoneos-arm64": "rootless", "iphoneos-arm": "rootful", "iphoneos-arm64e": "roothide" };

// The alert before the .deb downloads (Cancel / Download), or the one saying there's no build for this arch (OK).
export function debAlert(arch, url) {
  const kind = ARCH_NAMES[arch] ?? arch;
  if (!url) {
    return { title: "No Build Yet", message: `Cydian is built for rootless jailbreaks so far, not ${kind}. Set Settings > Device if your phone is rootless.`, buttons: ["OK"], cancel: 0 };
  }
  return {
    title: "Install Cydian",
    message: `Cydian's ${kind} .deb downloads to Files. Open it there in Sileo or Filza to install it.`,
    buttons: ["Cancel", "Download"],
    cancel: 0,
  };
}
