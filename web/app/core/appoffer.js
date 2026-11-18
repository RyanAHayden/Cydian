// I7: the website offers the Cydian app itself. Pure: no DOM, no network; screens/home.js and screens/settings.js
// draw what these answer, and core/appoffer.test.js covers every case.
//
// Where the offer shows (the website only: nothing inside the app, which is already installed):
//   Home, the Install Cydian App tile
//     Not Jailbroken, certificate set     signs the sideload IPA (the release's Cydian.ipa) through the signing
//                                         server with the user's certificate and installs it
//     Not Jailbroken, no certificate      opens Settings > Signing, where the certificate goes first
//     jailbroken (rootless, ...)          downloads the release's .deb for that architecture, to open in Sileo or
//                                         Filza; an architecture with no .deb yet is told so
//   Settings > Signing, a green Install Cydian App row once the certificate works, and one alert right after an
//   import that made it work ("Your certificate works. ...", Not Now / Install).
//   Cydian's own package page: its AltStore source (web/app/source.json, first in DEFAULT_ALT_SOURCES).

export const REPO_URL = "https://github.com/RyanAHayden/Cydian";
// The release assets native/build.sh makes (tools/release.sh uploads them): latest/download always names the newest.
export const APP_IPA_URL = `${REPO_URL}/releases/latest/download/Cydian.ipa`;
export const APP_DEB_URL = `${REPO_URL}/releases/latest/download/Cydian.deb`; // rootless, iphoneos-arm64
// Cydian's own AltStore source, kept current with native/VERSION by test_release.py.
export const APP_SOURCE_URL = "https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json";
export const APP_NAME = "Cydian";
export const APP_LABEL = "Install Cydian App";

const NOT_JAILBROKEN = "none";

// What the certificate on the Signing page amounts to: a .p12 and a profile, and a password that isn't known to be
// wrong (null: this browser couldn't check it; the server will). `id` is signing-client.js loadIdentity().
export function certificateWorks(id) {
  return Boolean(id?.p12 && id?.profile && id.passwordOk !== false);
}

// Home's tile: null (no tile), or { action, href? }:
//   "install"  sign the IPA and install it (certificate set)
//   "signing"  go to Settings > Signing (href)
//   "deb"      download the .deb for `deviceType` (an APT arch)
// mode: core/settings.js detectMode(); deviceType: settings.deviceType() ("none" or an arch); certificate: whether
// one is set (signing-client.js signingReady()).
export function homeOffer({ mode = "site", deviceType = NOT_JAILBROKEN, certificate = false } = {}) {
  if (mode !== "site") return null;
  if (deviceType && deviceType !== NOT_JAILBROKEN) return { action: "deb", arch: deviceType };
  return certificate ? { action: "install" } : { action: "signing", href: "#/settings/signing" };
}

// The Signing page's green row: on the website once the certificate works.
export function signingRowShows({ mode = "site", identity = null } = {}) {
  return mode === "site" && certificateWorks(identity);
}

// The alert after an import: only when this change made the certificate work (before: not, after: yes). A later
// change to a certificate that already worked (a new server, the same files again) doesn't ask again.
export function offerAfterImport({ mode = "site", before = null, after = null } = {}) {
  return mode === "site" && !certificateWorks(before) && certificateWorks(after);
}

export const IMPORT_ALERT = {
  title: "Install Cydian?",
  message: "Your certificate works. Install the Cydian app: it signs on your iPhone, smoother scrolling at 120Hz. Already have it? Open it and tap Import from Safari in Settings > Signing.",
  buttons: ["Not Now", "Install"],
  cancel: 0,
};

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
