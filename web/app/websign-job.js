// F93: one signing job on the website, inside the Web Worker (signing-worker.js): zsign (vendor/zsign, WebAssembly)
// signs an IPA with the user's certificate, all in the worker's memory. Nothing here touches the network.
//
//   await runSignJob(createZsign, { ipa, p12, password, profile, bring }, { progress })
//     -> { ipa: Uint8Array (signed), bundleId (signed as), originalId, name, version }
//   Throws Error with .code: bad_ipa (not an IPA, no app inside), bad_profile, sign_failed (zsign's own reason).
//
// `createZsign` is the module factory (vendor/zsign/zsign.js; a fake in the tests): it takes { print, printErr }
// and resolves a module with FS, ccall and callMain. A fresh module per job: zsign's main() keeps globals.
// bring (iFizBox's own IPA only, com.ryha.cydian): { identity: true } puts the .p12, password and profile inside the
// app as cydian-identity.plist (the app imports it on first launch, native BundledIdentity) and { transfer: link }
// writes the website's cydian://import link as web/transfer.link (app.js imports it once); both before zsign seals
// the bundle, as the old server signer did.
// SPDX-License-Identifier: GPL-3.0-or-later
import { isZip, profileInfo, targetBundleId, appEntitlements, plistXml, identityPlist, zsignArgs, zsignError, appInfo,
  CYDIAN_ID, IDENTITY_FILE, TRANSFER_FILE } from "./core/websign.js";

const fail = (code, message) => Object.assign(new Error(message), { code });

// rm -r inside emscripten's FS; nothing there is fine.
export function removeTree(FS, path) {
  let st;
  try { st = FS.stat(path); } catch { return; }
  if (FS.isDir(st.mode)) {
    for (const n of FS.readdir(path)) if (n !== "." && n !== "..") removeTree(FS, `${path}/${n}`);
    FS.rmdir(path);
  } else FS.unlink(path);
}

export async function runSignJob(createZsign, { ipa, p12, password = "", profile, bring = null }, { progress = () => {} } = {}) {
  const bytes = ipa instanceof Uint8Array ? ipa : new Uint8Array(ipa);
  if (!isZip(bytes)) throw fail("bad_ipa", "That file isn't an IPA (a zip archive).");
  let prof;
  try { prof = profileInfo(profile); } catch (e) { throw fail("bad_profile", e.message); }
  const log = [];
  const zs = await createZsign({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const { FS } = zs;
  progress("Signing");
  FS.mkdir("/w");
  FS.writeFile("/w/in.ipa", bytes);
  if (zs.ccall("cydian_unzip", "number", ["string", "string"], ["/w/in.ipa", "/w/app"]) !== 0) {
    throw fail("bad_ipa", "That IPA couldn't be unpacked.");
  }
  FS.unlink("/w/in.ipa"); // the browser's memory is the limit: the zip goes once it's unpacked
  let apps = [];
  try { apps = FS.readdir("/w/app/Payload").filter((n) => n.endsWith(".app")); } catch { /* no Payload */ }
  if (apps.length !== 1) throw fail("bad_ipa", "That file is not an IPA: it has no Payload/<App>.app.");
  const appDir = `/w/app/Payload/${apps[0]}`;
  let plist = null;
  try { plist = JSON.parse(zs.ccall("cydian_plist_json", "string", ["string"], [`${appDir}/Info.plist`]) || "null"); } catch { /* below */ }
  if (!plist) throw fail("bad_ipa", "That IPA's app has no readable Info.plist.");
  const info = appInfo(plist);
  const bundleId = targetBundleId(prof.appId, info.bundleId);
  // App extensions (PlugIns, a Watch app) come out: zsign gives every binary the app's own entitlements, which don't
  // match an extension's bundle ID, and iOS then refuses the app ("its integrity could not be verified", user
  // 2026-11-18, iFizBox's Share and Widget). The app's own Sign Options do the same with Remove App Extensions.
  for (const dir of ["PlugIns", "Extensions", "Watch"]) removeTree(FS, `${appDir}/${dir}`);

  FS.writeFile("/w/key.p12", new Uint8Array(p12));
  FS.writeFile("/w/app.mobileprovision", new Uint8Array(profile));
  FS.writeFile("/w/ents.plist", plistXml(appEntitlements(prof, bundleId)));
  if (bring && info.bundleId === CYDIAN_ID) {
    if (bring.identity) FS.writeFile(`${appDir}/${IDENTITY_FILE}`, identityPlist({ p12, password, profile }));
    if (typeof bring.transfer === "string" && bring.transfer.startsWith("cydian://import?")) {
      try { FS.mkdir(`${appDir}/web`); } catch { /* there already */ }
      FS.writeFile(`${appDir}/${TRANSFER_FILE}`, bring.transfer);
    }
  }
  FS.mkdir("/w/tmp");
  const args = zsignArgs({ p12: "/w/key.p12", password, profile: "/w/app.mobileprovision", entitlements: "/w/ents.plist",
    bundleId: bundleId !== info.bundleId ? bundleId : null, input: appDir, output: "/w/out.ipa", temp: "/w/tmp" });
  let code;
  try { code = zs.callMain(args); } catch (e) {
    if (typeof e?.status !== "number") throw fail("sign_failed", `zsign stopped: ${e?.message ?? e}. The app may be too big for this browser.`);
    code = e.status; // exit(): emscripten's ExitStatus
  }
  let out = null;
  try { out = code === 0 ? FS.readFile("/w/out.ipa") : null; } catch { /* no output */ }
  if (!out?.length) throw fail("sign_failed", zsignError(log));
  return { ipa: out, bundleId, originalId: info.bundleId, name: info.name, version: info.version };
}
