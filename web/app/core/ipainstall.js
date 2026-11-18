// F67: the jailbreak build's Install IPA flow, the pure part (screens/ipa-install.js draws it, ipa-install.js calls
// the bridge). The shell's ipa.install {url, stream} (native/Sources/Apt.swift IPAInstall, F59) downloads the IPA and
// runs `ifizbox-helper install-ipa` on it: installd takes it as it is when AppSync Unified is there, else the helper ad
// hoc signs it with ldid first. The sideload build never comes here: it keeps signing.install (signing-client.js).
//
//   ipaUrl(text)              -> the http(s) URL typed or pasted ("example.com/a.ipa" gets https://), or null
//   looksLikeIpa(url)         -> true when a link's path ends in .ipa (a tapped link offers Install IPA)
//   ipaName(url)              -> the file's name without .ipa, for the console's title ("App" when there's none)
//   ipaStatus(line)           -> { text, percent } for one status-fd line (dlstatus / pmstatus / pmerror), or null
//   ipaError(err, name)       -> { code, title, message, detail: the shell's own words, lines: [help lines] } for an ipa.install error
//   IPA_FOOTER, NO_ADHOC_HELP  the words the screens show
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME } from "../brand.js";

export function ipaUrl(text) {
  let s = String(text ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname || !u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href;
}

export function looksLikeIpa(url) {
  try {
    const u = new URL(String(url ?? ""));
    return (u.protocol === "https:" || u.protocol === "http:") && /\.ipa$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function ipaName(url) {
  try {
    const file = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    return file.replace(/\.ipa$/i, "").trim() || "App";
  } catch {
    return "App";
  }
}

// The status fd while ipa.install runs: "dlstatus:ipa:0:Downloading" (the shell, before the download), then the
// helper's "pmstatus:<bundle id>:<percent>:<text>" lines (installd's progress) and "pmerror:" ones. The download is
// the first fifth of the bar, installd's percent the rest.
export function ipaStatus(line) {
  const m = String(line ?? "").match(/^(dlstatus|pmstatus|pmerror):([^:]*):([0-9.]+):(.*)$/);
  if (!m) return null;
  const [, kind, , pct, text] = m;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (kind === "pmerror") return { text: text.trim(), percent: null, error: true };
  return { text: text.trim() || (kind === "dlstatus" ? "Downloading" : "Installing"), percent: kind === "dlstatus" ? p / 5 : 20 + p * 0.8 };
}

export const NO_ADHOC_HELP = [
  "This jailbreak can't install an app that isn't signed for this iPhone on its own. Any one of these fixes it:",
  "• Install AppSync Unified (from its repo, cydia.akemi.ai), then install the IPA again.",
  `• Or install ldid (Procursus and most jailbreaks' default repos have it): ${NAME} then signs the app ad hoc before installing it.`,
  "• Or sign the IPA for this iPhone first (with your own certificate or a sideloader) and install that copy.",
];

export const IPA_FOOTER = "Downloads the IPA and installs it with the jailbreak: as it is when AppSync Unified is "
  + "installed, else signed ad hoc with ldid first.";

const TITLES = {
  no_adhoc: "Needs AppSync Unified",
  bad_url: "Not an IPA Link",
  not_found: "Download Failed",
  network: "Download Failed",
  timeout: "Download Failed",
  bad_ipa: "Not an IPA",
  install: "Install Failed",
  helper: "Install Failed",
  sideload: "Not Available",
};

// err: what ipa.install rejected with, "<code>: <message>" (bridge.js also puts the code on err.code).
export function ipaError(err, name = "") {
  const raw = String(err?.message ?? err ?? "");
  const m = raw.match(/^([a-z_]+): ([\s\S]*)$/);
  const code = err?.code && TITLES[err.code] ? err.code : m && TITLES[m[1]] ? m[1] : "install";
  const said = (m && TITLES[m[1]] ? m[2] : raw).trim();
  const app = name || "the app";
  let message;
  let lines = [];
  switch (code) {
    case "no_adhoc":
      message = `${said ? `${said}\n\n` : ""}${NO_ADHOC_HELP.join("\n")}`;
      lines = NO_ADHOC_HELP;
      break;
    case "bad_url": message = `${NAME} installs IPAs from http or https links. ${said}`.trim(); break;
    case "not_found": message = `The server doesn't have ${app}'s IPA (${said}). The link may be old: try the source again later.`; break;
    case "timeout": message = `The download of ${app} took too long. Check the connection and try again.`; break;
    case "network": message = `${NAME} couldn't download ${app}: ${said || "no connection"}.`; break;
    case "bad_ipa": message = `What the link gave isn't an iOS app (${said}).`; break;
    case "helper": message = `${NAME}'s helper couldn't run (${said}). Reinstall ${NAME} from your package manager.`; break;
    case "sideload": message = `Installing IPAs this way needs the jailbreak build of ${NAME}.`; break;
    default: message = `iOS didn't install ${app}${said ? `: ${said}` : "."}`;
  }
  return { code, title: TITLES[code], message, detail: said, lines };
}
