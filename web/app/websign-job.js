// F93: one signing job on the website, inside the Web Worker (signing-worker.js): zsign (vendor/zsign, WebAssembly)
// signs an IPA with the user's certificate, all in the worker's memory. Nothing here touches the network.
//
//   await runSignJob(createZsign, { ipa, p12, password, profile, bring, appBundleId, keepBundleId }, { progress })
//     -> { ipa: Uint8Array (signed), bundleId (signed as), originalId, name, version }
//   Throws Error with .code: bad_ipa (not an IPA, no app inside), bad_profile, sign_failed (zsign's own reason).
//
// `createZsign` is the module factory (vendor/zsign/zsign.js; a fake in the tests): it takes { print, printErr }
// and resolves a module with FS, ccall and callMain. A fresh module per job: zsign's main() keeps globals.
// bring (iFizBox's own IPA only, com.ryha.ifizbox): { identity: true } puts the .p12, password and profile inside the
// app as ifizbox-identity.plist (the app imports it on first launch, native BundledIdentity) and { transfer: link }
// writes the website's ifizbox://import link as web/transfer.link (app.js imports it once); both before zsign seals
// the bundle, as the old server signer did.
// SPDX-License-Identifier: GPL-3.0-or-later
import { isZip, profileInfo, signingIds, appEntitlements, plistXml, identityPlist, zsignArgs, zsignError, appInfo,
  IFIZBOX_ID, IDENTITY_FILE, TRANSFER_FILE } from "./core/websign.js";
import { injectInto } from "./core/tweaks.js";

const fail = (code, message) => Object.assign(new Error(message), { code });

// What zsign threw when main() didn't exit, in words. The browser's memory running out shows as a RangeError (an
// ArrayBuffer that couldn't grow), a WebAssembly.RuntimeError or an emscripten abort, and sometimes as a bare object
// with no message (seen on an iPhone 7, a second 100 MB IPA in one tab): all "Out of memory", never [object Object].
export function zsignCrash(e) {
  const msg = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : "";
  const name = typeof e?.name === "string" ? e.name : "";
  const wasmError = typeof WebAssembly !== "undefined" && WebAssembly.RuntimeError && e instanceof WebAssembly.RuntimeError;
  if (e instanceof RangeError || name === "RangeError" || wasmError || name === "RuntimeError"
    || /abort|out of memory|memory|alloc/i.test(msg) || !msg.trim()) return "Out of memory";
  return msg.trim();
}

// rm -r inside emscripten's FS; nothing there is fine.
export function removeTree(FS, path) {
  let st;
  try { st = FS.stat(path); } catch { return; }
  if (FS.isDir(st.mode)) {
    for (const n of FS.readdir(path)) if (n !== "." && n !== "..") removeTree(FS, `${path}/${n}`);
    FS.rmdir(path);
  } else FS.unlink(path);
}

export async function runSignJob(createZsign, { ipa, p12, password = "", profile, bring = null, appBundleId = null, keepBundleId = true, tweaks = null }, { progress = () => {} } = {}) {
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
  if (zs.ccall("ifizbox_unzip", "number", ["string", "string"], ["/w/in.ipa", "/w/app"]) !== 0) {
    throw fail("bad_ipa", "That IPA couldn't be unpacked.");
  }
  FS.unlink("/w/in.ipa"); // the browser's memory is the limit: the zip goes once it's unpacked
  let apps = [];
  try { apps = FS.readdir("/w/app/Payload").filter((n) => n.endsWith(".app")); } catch { /* no Payload */ }
  if (apps.length !== 1) throw fail("bad_ipa", "That file is not an IPA: it has no Payload/<App>.app.");
  const appDir = `/w/app/Payload/${apps[0]}`;
  let plist = null;
  try { plist = JSON.parse(zs.ccall("ifizbox_plist_json", "string", ["string"], [`${appDir}/Info.plist`]) || "null"); } catch { /* below */ }
  if (!plist) throw fail("bad_ipa", "That IPA's app has no readable Info.plist.");
  const info = appInfo(plist);
  // appBundleId: the app's own ID as the website knows it (iFizBox's, or the source's), over the IPA's: the early
  // install link was opened for it, and an IPA under an older ID (0.9.3's) left iOS waiting on a link
  // nothing filled, then a second prompt from Ready to Install (user 2026-11-18).
  const own = appBundleId || info.bundleId;
  // F237: Keep Bundle IDs (keepBundleId, on unless the user turned it off). F280: iFizBox's own IPA keeps its ID too:
  // APNs delivers by the Info.plist ID, so only a copy that kept it gets push notifications. One installed earlier
  // under the profile's ID stays beside it (the app says so once, core/push.js renamedUpdateNotice).
  const { bundleId, entitlementsId } = signingIds(prof.appId, own, { keep: keepBundleId !== false });
  // App extensions (PlugIns, a Watch app) come out: zsign gives every binary the app's own entitlements, which don't
  // match an extension's bundle ID, and iOS then refuses the app ("its integrity could not be verified", user
  // 2026-11-18, iFizBox's Share and Widget). The app's own Sign Options do the same with Remove App Extensions.
  for (const dir of ["PlugIns", "Extensions", "Watch"]) removeTree(FS, `${appDir}/${dir}`);

  FS.writeFile("/w/key.p12", new Uint8Array(p12));
  FS.writeFile("/w/app.mobileprovision", new Uint8Array(profile));
  FS.writeFile("/w/ents.plist", plistXml(appEntitlements(prof, entitlementsId)));
  if (bring && own === IFIZBOX_ID) {
    if (bring.identity) FS.writeFile(`${appDir}/${IDENTITY_FILE}`, identityPlist({ p12, password, profile }));
    if (typeof bring.transfer === "string" && bring.transfer.startsWith("ifizbox://import?")) {
      try { FS.mkdir(`${appDir}/web`); } catch { /* there already */ }
      FS.writeFile(`${appDir}/${TRANSFER_FILE}`, bring.transfer);
    }
  }
  // F288: tweaks (core/tweaks.js prepareTweaks, done on the page): their files into the app, and the weak load commands
  // into the main executable, before zsign signs it all (it signs Frameworks/' dylibs and frameworks as any other).
  const injected = tweaks?.files?.length ? putTweaks(FS, appDir, plist, tweaks) : [];
  FS.mkdir("/w/tmp");
  const args = zsignArgs({ p12: "/w/key.p12", password, profile: "/w/app.mobileprovision", entitlements: "/w/ents.plist",
    bundleId: bundleId !== info.bundleId ? bundleId : null, input: appDir, output: "/w/out.ipa", temp: "/w/tmp" });
  let code;
  try { code = zs.callMain(args); } catch (e) {
    if (typeof e?.status !== "number") throw fail("sign_failed", `zsign stopped: ${zsignCrash(e)}. The app may be too big for this browser.`);
    code = e.status; // exit(): emscripten's ExitStatus
  }
  let out = null;
  try { out = code === 0 ? FS.readFile("/w/out.ipa") : null; } catch { /* no output */ }
  if (!out?.length) throw fail("sign_failed", zsignError(log));
  return { ipa: out, bundleId, originalId: info.bundleId, name: info.name, version: info.version, ...(injected.length ? { injected } : {}) };
}

// mkdir -p inside emscripten's FS.
function mkdirs(FS, path) {
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `/${part}`;
    try { FS.mkdir(at); } catch { /* there already */ }
  }
}

// F288: { files: [{ path, data }], inject: [loadPath] } into the unpacked app; returns what the executable now loads.
export function putTweaks(FS, appDir, plist, { files, inject = [] }) {
  for (const f of files) {
    if (!f?.path || f.path.startsWith("/") || f.path.split("/").includes("..")) throw fail("bad_tweak", `A tweak has a file outside the app (${f?.path}).`);
    const at = `${appDir}/${f.path}`;
    mkdirs(FS, at.slice(0, at.lastIndexOf("/")));
    FS.writeFile(at, f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data));
  }
  if (!inject.length) return [];
  const exe = `${appDir}/${plist.CFBundleExecutable || ""}`;
  let bin;
  try { bin = FS.readFile(exe); } catch { throw fail("bad_ipa", "That IPA's app has no executable to inject the tweaks into."); }
  try { FS.writeFile(exe, injectInto(bin, inject)); } catch (e) { throw fail(e?.code ?? "bad_tweak", e?.message ?? String(e)); }
  return [...inject];
}

// F260: whether `password` opens the .p12, as zsign itself loads it (OpenSSL with the legacy provider: any .p12 the
// signer takes, also the ones core/signing.js checkP12Password can't read and answers null for). zsign reads the
// profile and then the certificate before it looks at the app, so it runs on an empty folder: "Can't find app folder"
// means both loaded (true), OpenSSL's "mac verify failure" a wrong password (false); anything else is unknown (null:
// a damaged .p12 or profile, which the sign itself then names). A fresh module, like a sign; it takes milliseconds.
export async function runPasswordCheck(createZsign, { p12, password = "", profile }) {
  if (!p12 || !profile) return null;
  const log = [];
  const zs = await createZsign({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const { FS } = zs;
  FS.mkdir("/w");
  FS.mkdir("/w/tmp");
  FS.mkdir("/w/none");
  FS.writeFile("/w/key.p12", new Uint8Array(p12));
  FS.writeFile("/w/app.mobileprovision", new Uint8Array(profile));
  try { zs.callMain(["-k", "/w/key.p12", "-p", password ?? "", "-m", "/w/app.mobileprovision", "-t", "/w/tmp", "/w/none"]); } catch (e) {
    if (typeof e?.status !== "number") return null; // a crash says nothing about the password
  }
  return passwordVerdict(log);
}

// zsign's output on the empty folder, as runPasswordCheck answers it.
export function passwordVerdict(lines) {
  const text = lines.map((l) => String(l)).join("\n");
  if (/Can't find app folder/i.test(text)) return true;
  if (/Can't load p12/i.test(text) && /mac verify failure/i.test(text)) return false;
  return null;
}
