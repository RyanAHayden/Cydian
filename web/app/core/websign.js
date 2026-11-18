// F93: signing on the website, in the browser: the rules the old server signer (web/signer/, gone in 9905b05) went
// by, as pure JS for websign-job.js, which runs zsign (web/app/vendor/zsign, WebAssembly) in a Web Worker.
//
//   profileInfo(bytes)                      { appId, teamId, entitlements } from a .mobileprovision
//   targetBundleId(appId, bundleId)         the ID the app is signed as (a com.you.* profile signs any app)
//   appEntitlements(info, bundleId)         the profile's entitlements narrowed to that app (Xcode's way)
//   plistXml(value)                         an XML plist (dict, array, string, integer, real, bool, data, date)
//   identityPlist({ p12, password, profile })   iFizBox's own IPA's ifizbox-identity.plist (native BundledIdentity)
//   zsignArgs({ ... })                      zsign's command line in the worker's in-memory files
//   zsignError(lines)                       the line of zsign's output that says what went wrong
//   appInfo(plist)                          { bundleId, name, version } from an app's Info.plist (as JSON)
//   isZip(bytes)                            starts with PK (an IPA is a zip)
// SPDX-License-Identifier: GPL-3.0-or-later
import { parsePlist } from "./signing.js";

export const IPA_MAX = 512 * 1024 * 1024; // the Worker's own cap (worker/src/index.js MAX_UPLOAD)
export const IFIZBOX_ID = "com.ryha.ifizbox";
export const IDENTITY_FILE = "ifizbox-identity.plist";
export const TRANSFER_FILE = "web/transfer.link";

const utf8 = (b) => new TextDecoder().decode(b);

function find(b, text, from = 0, back = false) {
  const n = new TextEncoder().encode(text);
  for (let i = back ? b.length - n.length : from; back ? i >= 0 : i <= b.length - n.length; i += back ? -1 : 1) {
    let j = 0;
    while (j < n.length && b[i + j] === n[j]) j++;
    if (j === n.length) return i;
  }
  return -1;
}

export function profileInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const start = find(b, "<?xml"), end = find(b, "</plist>", 0, true);
  if (start < 0 || end < start) throw new Error("That file is not a provisioning profile (.mobileprovision).");
  const p = parsePlist(utf8(b.subarray(start, end + 8)));
  const ent = p.Entitlements && typeof p.Entitlements === "object" ? p.Entitlements : {};
  const teamId = (p.TeamIdentifier ?? [])[0] ?? ent["com.apple.developer.team-identifier"] ?? null;
  const full = String(ent["application-identifier"] ?? "");
  const prefix = [...(p.ApplicationIdentifierPrefix ?? []), teamId].find((x) => x && full.startsWith(x + "."));
  return { appId: prefix ? full.slice(prefix.length + 1) : full, teamId, entitlements: ent };
}

// A full wildcard ("*") keeps the app's own ID. A prefix wildcard (com.you.*) keeps it if it fits, and otherwise
// signs the app under the profile's prefix with the last part of its own ID (io.github.fizl0.openmx ->
// com.you.openmx), so a personal profile signs any app; the same app always gets the same ID, so updates replace
// it. An explicit profile signs it as the profile's ID.
export function targetBundleId(appId, bundleId) {
  if (appId === "*") return bundleId;
  if (appId.endsWith(".*")) {
    const prefix = appId.slice(0, -1);
    return bundleId.startsWith(prefix) ? bundleId : prefix + bundleId.split(".").pop();
  }
  if (!appId) throw Object.assign(new Error("The provisioning profile has no app ID."), { code: "bad_profile" });
  return appId;
}

// zsign would otherwise copy a wildcard profile's application-identifier (TEAM.com.you.*) and keychain group into
// the app verbatim, and iOS then refuses it ("Unable to Install"). Never debuggable (get-task-allow false).
export function appEntitlements({ entitlements = {}, teamId = null }, bundleId) {
  const ents = { ...entitlements };
  const team = ents["com.apple.developer.team-identifier"] || teamId;
  if (team) {
    ents["application-identifier"] = `${team}.${bundleId}`;
    if ("keychain-access-groups" in ents) ents["keychain-access-groups"] = [`${team}.${bundleId}`];
  }
  ents["get-task-allow"] = false;
  return ents;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function plistValue(v) {
  if (v instanceof Uint8Array) return `<data>${b64(v)}</data>`;
  if (v instanceof Date) return `<date>${v.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (Array.isArray(v)) return `<array>${v.map(plistValue).join("")}</array>`;
  if (v === true || v === false) return `<${v}/>`;
  if (typeof v === "number") return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  if (v && typeof v === "object") return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${plistValue(x)}`).join("")}</dict>`;
  return `<string>${esc(v ?? "")}</string>`;
}
export function plistXml(value) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>\n`;
}

export const identityPlist = ({ p12, password, profile }) => plistXml({ p12: new Uint8Array(p12), password: password ?? "", profile: new Uint8Array(profile) });

export function zsignArgs({ p12, password, profile, entitlements, bundleId = null, input, output, temp }) {
  // -z 1: fast deflate. Level 6 took most of the time for a 40 MB app in WebAssembly on a phone (user 2026-11-18).
  const a = ["-f", "-k", p12, "-p", password ?? "", "-m", profile, "-t", temp, "-z", "1", "-o", output];
  if (bundleId) a.push("-b", bundleId);
  if (entitlements) a.push("-e", entitlements);
  a.push(input);
  return a;
}

// zsign prints ">>> ..." lines (not with -q, which hides its errors too) (red ones on failure) and OpenSSL's error queue: the last ">>>" line with a failure in
// it, without colours, is the one to show.
const ANSI = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex
export function zsignError(lines) {
  const clean = lines.map((l) => String(l).replace(ANSI, "").trim()).filter(Boolean);
  const said = clean.filter((l) => l.startsWith(">>>")).map((l) => l.replace(/^>+\s*/, ""));
  const why = [...said].reverse().find((l) => /fail|invalid|can't|cannot|error|not /i.test(l)) ?? said.at(-1) ?? clean.at(-1) ?? "";
  if (/Can't load p12/i.test(why)) {
    // OpenSSL's queue says which: a MAC that doesn't verify is the wrong password (the file itself read fine).
    return clean.some((l) => /mac verify failure/i.test(l)) ? "The certificate's password is wrong: it doesn't open this .p12."
      : "The certificate's password doesn't open it, or the .p12 is damaged.";
  }
  return why ? `zsign: ${why.replace(/[.!]+$/, "")}.` : "zsign stopped without saying why.";
}

export function appInfo(plist) {
  const p = plist && typeof plist === "object" ? plist : {};
  const bundleId = String(p.CFBundleIdentifier ?? "");
  if (!bundleId) throw Object.assign(new Error("That IPA's app has no bundle ID (CFBundleIdentifier)."), { code: "bad_ipa" });
  return { bundleId, name: String(p.CFBundleDisplayName || p.CFBundleName || bundleId), version: String(p.CFBundleShortVersionString || p.CFBundleVersion || "1.0") };
}

export const isZip = (b) => b?.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
