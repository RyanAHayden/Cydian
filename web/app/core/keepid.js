// F237: Keep Bundle IDs (R25's verdict, journal/2026-11-18-r25-keep-bundle-id). On by default: a signed app keeps its
// own bundle ID in Info.plist and only its entitlements (application-identifier, keychain group) carry the
// profile's App ID, so it replaces the original rather than sitting beside it, and with an Ad Hoc profile that has
// Push it gets its own notifications. Off: the old way, the app becomes a separate copy under the user's ID.
// Pure: the settings row (core/settings.js keepBundleId), Custom Install (signing-sheet.js), signing-client.js and
// the guide (screens/guides.js "keep-bundle-id") read it.
//
//   keepOn(get)                              the global setting from settings.get (absent: on)
//   storedKeep(storage) / withKeep(params)   the same from localStorage; bridge params with keepBundleId: false
//                                            added when it's off (a job's own choice wins)
//   profileFacts(p)                          { appId, push, kind, wildcard } from signing.status's profile, a
//                                            signing.inspect answer, or the website's parseProfile + profileInfo
//   keepPlan(profile, bundleId, { keep })    { keep, bundleId (Info.plist), entitlementsId, notes: [note] }
//   profileNotes(profile, { keep, name })    what the profile can't do the new way, or the old way's warning
//   originalNote(name, { installed, ours })  the original (same ID) is on the phone and would be replaced
//   OLD_WAY_ALERT                            the alert that turning Keep Bundle IDs off shows first
// A note: { id, text, guide } (guide: link to the guide, GUIDE_ROUTE).
// SPDX-License-Identifier: GPL-3.0-or-later
import { targetBundleId } from "./websign.js";

export const KEEP_KEY = "keepBundleId";
export const GUIDE_ID = "keep-bundle-id";
export const GUIDE_ROUTE = ["guides", GUIDE_ID];
export const GUIDE_LINK = "How to Get Notifications";

export const keepOn = (get) => {
  try { return (typeof get === "function" ? get(KEEP_KEY) : undefined) !== false; } catch { return true; }
};

// The same setting straight from storage (core/settings.js keeps it at ifizbox.keepBundleId as "true"/"false"), for
// signing-client.js, which has no settings object.
export const storedKeep = (storage = globalThis.localStorage) => {
  try { return storage?.getItem?.(`ifizbox.${KEEP_KEY}`) !== "false"; } catch { return true; }
};

// Bridge params with Keep Bundle IDs: the job's own choice (Custom Install's switch) wins, else the global setting.
// Only false is sent: the signers keep the ID when the key is absent.
export function withKeep(params, keep = storedKeep()) {
  const p = { ...(params ?? {}) };
  if (typeof p[KEEP_KEY] === "boolean") return p;
  if (keep === false) p[KEEP_KEY] = false;
  return p;
}

const wildcardId =(appId) => appId === "*" || String(appId ?? "").endsWith(".*");

export function profileFacts(p) {
  if (!p || typeof p !== "object") return null;
  const appId = String(p.appId ?? p.profileAppId ?? ""); // signing.inspect: profileAppId
  const push = typeof p.push === "string" && p.push ? p.push : null;
  // signing.status / signing.inspect send kind or profileKind; the website's parseProfile has getTaskAllow
  const kind = p.kind || p.profileKind || (p.allDevices ? "Enterprise" : p.getTaskAllow ? "Development" : p.devices ? "Ad Hoc" : null);
  return { appId, push, kind: kind || null, wildcard: typeof p.wildcard === "boolean" ? p.wildcard : wildcardId(appId) };
}

const appName = (name) => String(name ?? "").trim() || "The app";

export const OLD_WAY_TEXT = (name, as) => `${appName(name)} becomes a separate copy under your ID${as ? ` (${as})` : ""}, beside the original. `
  + "Its notifications won't work, and sign-in, iCloud or data it shares with its other apps may not.";

export const OLD_WAY_ALERT = {
  title: "Use Your Own Bundle ID?",
  message: "Each app you sign becomes a separate copy under your ID, beside the original. Its notifications won't work, "
    + "and sign-in, iCloud or data shared with its other apps may not. Apps you signed before keep the way they were signed.",
  buttons: ["Cancel", "Use My ID"],
};

// What this profile can't do when the ID is kept; the old way's warning when it isn't. R25: every kind still installs
// with the ID kept (iOS's installer never compares application-identifier with the bundle ID), so none falls back.
export function profileNotes(profile, { keep = true, name = "", as = "" } = {}) {
  const f = profileFacts(profile);
  if (!keep) return [{ id: "old-way", text: OLD_WAY_TEXT(name, as), guide: false }];
  if (!f) return [];
  const who = String(name ?? "").trim() || "the app";
  if (f.wildcard) {
    return [{ id: "wildcard", guide: true,
      text: `Your profile is a wildcard (${f.appId || "*"}), which Apple won't give Push: ${who} keeps its ID but won't get notifications.` }];
  }
  const notes = [];
  if (f.kind === "Development" || f.push === "development") {
    notes.push({ id: "development", guide: true,
      text: "Your profile is a development one: notifications come only from Apple's test servers, which apps' own servers don't use. An Ad Hoc profile gets the real ones." });
  } else if (!f.push) {
    notes.push({ id: "no-push", guide: true,
      text: `Your profile's App ID (${f.appId}) doesn't have Push Notifications: ${who} keeps its ID but won't get notifications.` });
  }
  notes.push({ id: "one-app", guide: false,
    text: `Your profile is for one App ID (${f.appId}): use it for one app. Two apps signed with it share their keychain, so their sign-ins mix.` });
  return notes;
}

// The original app, under the same ID, is on the phone. `ours`: iFizBox signed that copy (a signed-apps record), so
// this is an update and nothing to warn about. R25: iOS refuses to put a signed app over an App Store one.
export function originalNote(name, { installed = false, ours = false } = {}) {
  if (!installed || ours) return null;
  return { id: "original", guide: false,
    text: `${appName(name)} is already on this iPhone under its own ID, and this replaces it. iOS won't put a signed app over the App Store copy: delete that one first (its data goes with it).` };
}

// Custom Install's Keep Bundle ID group (signing-sheet.js) for a signing.inspect answer: { notes, guide } with the
// original-app note while the ID is kept (the old way installs a copy beside it, replacing nothing).
export function sheetNotes(info, { keep = true, installed = false, ours = false, name = "" } = {}) {
  const who = name || info?.app?.name || "";
  const notes = profileNotes(info, { keep, name: who, as: info?.appIdAs || "" });
  const orig = keep ? originalNote(who, { installed, ours }) : null;
  if (orig) notes.unshift(orig);
  return { notes, guide: notes.some((n) => n.guide) };
}

// Whether the original (the app's own ID) is on the phone, and whether iFizBox signed that copy: apps.isInstalled
// {bundleIds} and signing.installed's records. Unknown counts as not installed.
export async function originalState(native, bundleId) {
  if (!bundleId || typeof native?.call !== "function") return { installed: false, ours: false };
  let installed = false, ours = false;
  try { installed = Boolean((await native.call("apps.isInstalled", { bundleIds: [bundleId] }))?.installed?.[bundleId]); } catch { /* unknown */ }
  if (installed) {
    try { ours = ((await native.call("signing.installed", {}))?.apps ?? []).some((a) => a?.bundleId === bundleId); } catch { /* unknown */ }
  }
  return { installed, ours };
}

// The IDs and the notes for one app: Info.plist's ID, the entitlements' ID (the profile's App ID, a wildcard
// narrowed), and what to say. Throws as targetBundleId does for a profile without an App ID.
export function keepPlan(profile, bundleId, { keep = true, name = "" } = {}) {
  const f = profileFacts(profile) ?? { appId: "*" };
  const entitlementsId = targetBundleId(f.appId || "*", bundleId);
  const id = keep ? bundleId : entitlementsId;
  return { keep, bundleId: id, entitlementsId, notes: profileNotes(profile, { keep, name, as: entitlementsId }) };
}
