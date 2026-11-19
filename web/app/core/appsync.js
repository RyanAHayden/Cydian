// F189: AppSync Unified for the jailbreak build's IPA installs, the pure part (screens/ipa-install.js ensureAppSync
// runs the steps). A rootless jailbreak's installd refuses an app that isn't signed for the iPhone (ad hoc too, on
// palera1n); AppSync Unified's installd hook lets it in. So the first IPA install with AppSync missing adds akemi's
// source (only ever that one: a third-party copy from Canister may not refresh, user 2026-11-18), refreshes it and
// queues AppSync Unified as a dependency of the install: the Confirm sheet lists it under Install, and the IPA goes
// in once apt has installed it.
//
//   APPSYNC_ID, APPSYNC_NAME, APPSYNC_SOURCE, APPSYNC_HOST, APPSYNC_PAGE   what and where
//   appSyncInstalled(statusText) -> true when dpkg's status file has AppSync Unified installed (by its id, or a
//                                   package that Provides it, as 116.0 provides appsync)
//   sameSource(uri)              -> true for akemi's source, however it was typed (http, www, no slash)
//   appSyncFailure(step)         -> { title, message, buttons } for the short fallback alert: what failed in one plain
//                                   sentence (never apt's raw error), with Try Again, Open Source and OK
//   FALLBACK_BUTTONS, TRY_AGAIN, OPEN_SOURCE                               its buttons' indexes
//   afterAppSyncNote(name)       -> the Confirm sheet's footer under Modifications while an IPA waits on it
//
// SPDX-License-Identifier: GPL-3.0-or-later

export const APPSYNC_ID = "ai.akemi.appsyncunified";
export const APPSYNC_NAME = "AppSync Unified";
export const APPSYNC_SOURCE = "https://cydia.akemi.ai/";
export const APPSYNC_HOST = "cydia.akemi.ai";
export const APPSYNC_PAGE = "https://cydia.akemi.ai/?page/ai.akemi.appsyncunified";
const PROVIDED = new Set([APPSYNC_ID, "appsync", "net.angelxwind.appsyncunified"]);

export function appSyncInstalled(statusText) {
  for (const stanza of String(statusText ?? "").split(/\n\s*\n/)) {
    const field = (name) => stanza.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "mi"))?.[1]?.trim() ?? "";
    if (!/\binstall ok installed\b/.test(field("Status"))) continue;
    if (field("Package") === APPSYNC_ID) return true;
    const provides = field("Provides").split(",").map((p) => p.trim().split(/[\s(]/)[0]).filter(Boolean);
    if (provides.some((p) => PROVIDED.has(p))) return true;
  }
  return false;
}

export function sameSource(uri) {
  try {
    const u = new URL(/^[a-z]+:/i.test(String(uri ?? "")) ? String(uri) : `https://${uri}`);
    return u.hostname.replace(/^www\./, "") === APPSYNC_HOST && /^\/?$/.test(u.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export const FALLBACK_BUTTONS = ["Try Again", "Open Source", "OK"];
export const TRY_AGAIN = 0;
export const OPEN_SOURCE = 1;

const SENTENCES = {
  add: `Couldn't add ${APPSYNC_HOST}.`,
  refresh: `Couldn't refresh ${APPSYNC_HOST}.`,
  missing: `${APPSYNC_HOST} doesn't list ${APPSYNC_NAME} for this iPhone.`,
  install: `Couldn't install ${APPSYNC_NAME}.`,
  refused: `iOS refused the app even though ${APPSYNC_NAME} is installed.`,
  absent: `This app needs ${APPSYNC_NAME}, which isn't installed.`,
};

// step: add | refresh | missing | install (the auto-install's steps) | refused | absent (installd's no_adhoc after it)
export function appSyncFailure(step) {
  return { title: step === "refused" ? "Install Failed" : `Needs ${APPSYNC_NAME}`, message: SENTENCES[step] ?? SENTENCES.install,
    buttons: FALLBACK_BUTTONS };
}

export function afterAppSyncNote(name) {
  return `${APPSYNC_NAME} lets this jailbreak install apps that aren't signed for this iPhone. ${name || "The IPA"} installs right after it.`;
}
