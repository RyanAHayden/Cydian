// Cydian updates itself (F61). In the app only (sideload and jailbreak builds): on launch and at most once a day, read
// GitHub's latest release, compare its tag (vX.Y.Z) with the app's own version (Bridge.swift app.info `version`,
// CFBundleShortVersionString) and, when it's newer, ask with an iOS 6 alert: "Cydian X.Y.Z Is Available", the first
// lines of the release notes, Later / Install. Later asks again on the next launch a day on; Settings > About has
// Check for Updates and Skip This Version (screens/settings.js aboutSection).
//
// Install, by build:
//   sideload   the release's Cydian.ipa, signed on the phone with the user's certificate and installed over the
//              running app (F58's installOnDevice: same bundle ID com.ryha.cydian, so its data stays). No certificate
//              in the Keychain: an alert says so and Settings > Signing opens.
//   jailbreak  the release's .deb for this device's architecture, downloaded by the shell (selfupdate.download) and
//              installed with `cydian-helper selfupdate <path>` (dpkg -i, N2), then an offer to close Cydian so the
//              next launch runs the new build (Cydia's own "Close Cydia" after finish:reopen).
//
// Pure: everything that touches the network, the bridge, storage or the screen comes in through `deps`, so node
// tests drive every path (selfupdate.test.js). app.js and screens/settings.js wire the real ones.

export const RELEASES_URL = "https://api.github.com/repos/RyanAHayden/Cydian/releases/latest";
export const DAY = 24 * 60 * 60 * 1000;
export const STORE_KEY = "cydian.selfupdate";
export const NOTE_LINES = 4;

// "v1.2.3", "1.2", "1.2.3-beta" -> [1, 2, 3] (missing parts are 0; anything after the numbers is ignored).
// Null when it doesn't start with a number.
export function parseVersion(s) {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(String(s ?? ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

// -1, 0 or 1; an unreadable version is older than any readable one.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const isNewer = (latest, current) => parseVersion(latest) != null && compareVersions(latest, current) > 0;

// The first `n` lines of a release's notes worth showing in an alert: Markdown headings, rules, images and blank
// lines dropped, list bullets and emphasis taken off.
export function noteLines(body, n = NOTE_LINES) {
  const out = [];
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^#{1,6}\s/.test(l) || /^([-*_])\1{2,}$/.test(l) || /^!\[/.test(l) || /^<!--/.test(l)) continue;
    l = l.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\*\*|__|`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if (l) out.push(l);
    if (out.length >= n) break;
  }
  return out;
}

// GitHub's release JSON -> { version, tag, notes, url, ipa, debs: [{ name, url }] }, or null when it isn't a
// release with a version tag (a draft, a rate-limit message, a tag like "nightly").
export function parseRelease(json) {
  if (!json || typeof json !== "object" || json.draft || typeof json.tag_name !== "string") return null;
  const v = parseVersion(json.tag_name);
  if (!v) return null;
  const assets = Array.isArray(json.assets) ? json.assets.filter((a) => a && typeof a.name === "string" && typeof a.browser_download_url === "string") : [];
  const url = (a) => a.browser_download_url;
  const ipa = assets.find((a) => a.name === "Cydian.ipa") ?? assets.find((a) => /\.ipa$/i.test(a.name));
  return {
    version: v.join("."),
    tag: json.tag_name,
    notes: noteLines(json.body),
    url: typeof json.html_url === "string" ? json.html_url : "",
    ipa: ipa ? url(ipa) : null,
    debs: assets.filter((a) => /\.deb$/i.test(a.name)).map((a) => ({ name: a.name, url: url(a) })),
  };
}

// The .deb for this architecture (core/settings.js bridgeArch: iphoneos-arm64 rootless, iphoneos-arm64e roothide,
// iphoneos-arm rootful): the asset naming exactly that arch (Debian's name_version_arch.deb), else a plain
// Cydian.deb, which is the rootless build (native/build.sh), so only for iphoneos-arm64. Null when none fits.
export function debFor(release, arch) {
  const debs = release?.debs ?? [];
  if (arch) {
    const exact = debs.find((d) => new RegExp(`[_-]${arch.replace(/[^a-z0-9-]/g, "")}\\.deb$`, "i").test(d.name));
    if (exact) return exact.url;
  }
  if (!arch || arch === "iphoneos-arm64") return debs.find((d) => d.name === "Cydian.deb")?.url ?? null;
  return null;
}

// Which install each build takes: "sideload", "jailbreak", or null on the site (it has nothing to update).
export function installPath(mode) {
  return mode === "sideload" || mode === "jailbreak" ? mode : null;
}

// ---- the state kept between launches ------------------------------------------------------------------------
//   lastCheck  ms of the last automatic check (the once-a-day gate)
//   laterAt    ms when Later was tapped; laterVersion the version it was for
//   skip       the version Skip This Version is on
//   latest     the newest release seen: { version, notes, url, ipa, debs }

export function loadState(storage) {
  try {
    const s = JSON.parse(storage?.getItem(STORE_KEY) ?? "null");
    return s && typeof s === "object" ? s : {};
  } catch { return {}; }
}

export function saveState(storage, patch) {
  const next = { ...loadState(storage), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  try { storage?.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* full or private: asks again next time */ }
  return next;
}

// The once-a-day gate: an automatic check runs when none ran in the last day (or the clock went back).
export function dueForCheck(state, now) {
  const last = Number(state?.lastCheck);
  return !Number.isFinite(last) || last <= 0 || now - last >= DAY || now < last;
}

// Whether an automatic check offers `release` to a user on `current`: newer, not skipped, and not put off with
// Later in the last day.
export function shouldOffer(release, current, state, now) {
  if (!release || !isNewer(release.version, current)) return false;
  if (state?.skip && compareVersions(state.skip, release.version) === 0) return false;
  const later = Number(state?.laterAt);
  if (Number.isFinite(later) && later > 0 && now - later < DAY && now >= later) return false;
  return true;
}

// Skip This Version (Settings > About): on for `version`, or off (null).
export function setSkip(storage, version) {
  return saveState(storage, { skip: version || null });
}

// ---- the alert ----------------------------------------------------------------------------------------------

export function offerAlert(release) {
  return {
    title: `Cydian ${release.version} Is Available`,
    message: release.notes?.length ? release.notes.join("\n") : "A new version of Cydian is out.",
    buttons: ["Later", "Install"],
    cancel: 0,
  };
}

// The release as JSON from GitHub: in the app through the shell's net.fetch (no CORS, its own User-Agent, which
// GitHub's API asks for), else fetch(). Throws on a non-2xx answer.
export async function fetchRelease({ native, fetch: f = globalThis.fetch, url = RELEASES_URL } = {}) {
  if (native?.call) {
    const r = await native.call("net.fetch", { url });
    if (!r || r.status >= 300) throw new Error(`GitHub answered ${r?.status ?? "nothing"}`);
    const bin = atob(r.body ?? "");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parseRelease(JSON.parse(new TextDecoder().decode(bytes)));
  }
  const res = await f(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return parseRelease(await res.json());
}

// ---- the check ----------------------------------------------------------------------------------------------
// deps: {
//   mode, storage, now()             build, where the state lives, the clock
//   current()   -> "0.1.0"           the app's own version (app.info)
//   release()   -> parseRelease(...) the latest release (fetchRelease)
//   alert(spec) -> { index }         nav/alert.js showAlert
//   install(release)                 runInstall bound to the real bridge (below)
// }
// Automatic (on launch): nothing unless due; failures are silent. Manual (Check for Updates): always asks GitHub,
// says when it's up to date or couldn't be reached, and offers the release even if skipped or put off.
// Resolves what happened: "site" | "not-due" | "error" | "current" | "skipped" | "later" | "install".
export async function checkForUpdates(deps, { manual = false } = {}) {
  const { mode, storage, now = Date.now } = deps;
  if (!installPath(mode)) return "site";
  const t = now();
  let state = loadState(storage);
  if (!manual && !dueForCheck(state, t)) return "not-due";
  let release, current;
  try {
    [release, current] = await Promise.all([deps.release(), deps.current()]);
  } catch (e) {
    if (manual) await deps.alert({ title: "Couldn't Check for Updates", message: e?.message || "GitHub didn't answer.", buttons: ["OK"] });
    return "error";
  }
  state = saveState(storage, { ...(manual ? {} : { lastCheck: t }), latest: release ?? null, current: current || null });
  const newer = release && isNewer(release.version, current);
  if (!newer) {
    if (manual) await deps.alert({ title: "Cydian Is Up to Date", message: `Cydian ${current || ""} is the newest version.`.replace("  ", " "), buttons: ["OK"] });
    return "current";
  }
  if (!manual && !shouldOffer(release, current, state, t)) {
    return state.skip && compareVersions(state.skip, release.version) === 0 ? "skipped" : "later";
  }
  const { index } = await deps.alert(offerAlert(release));
  if (index !== 1) {
    saveState(storage, { laterAt: t, laterVersion: release.version });
    return "later";
  }
  saveState(storage, { laterAt: null, laterVersion: null });
  await deps.install(release);
  return "install";
}

// ---- the install --------------------------------------------------------------------------------------------
// deps (by path):
//   sideload:  status() -> { identity }       signing-client.js deviceStatus
//              installOnDevice({ url, name }) signing-client.js: signs, installs, explains its own errors
//   jailbreak: native                          the bridge: selfupdate.download, helper(words, onEvent), app.quit
//              arch                            core/settings.js bridgeArch / getArch
//              hud(text) -> { set, hide }
//   both:      alert(spec) -> { index }, go(path)  open a Settings page (["signing"])
// Resolves "installed" | "no-certificate" | "no-asset" | "failed" | "site".
export async function runInstall(release, mode, deps) {
  const path = installPath(mode);
  if (path === "sideload") return installSideload(release, deps);
  if (path === "jailbreak") return installJailbreak(release, deps);
  return "site";
}

async function installSideload(release, { status, installOnDevice, alert, go }) {
  if (!release.ipa) {
    await alert({ title: "Can't Install", message: `Cydian ${release.version} has no Cydian.ipa on GitHub.`, buttons: ["OK"] });
    return "no-asset";
  }
  let st = null;
  try { st = await status(); } catch { /* the signer didn't answer: as if no certificate, Settings > Signing says why */ }
  if (!st?.identity) {
    await alert({ title: "No Certificate", message: `To install Cydian ${release.version}, add your certificate in Settings > Signing. Cydian signs its update with it on this iPhone.`, buttons: ["OK"] });
    go(["signing"]);
    return "no-certificate";
  }
  return (await installOnDevice({ url: release.ipa, name: "Cydian" })) ? "installed" : "failed";
}

const lastLine = (s) => String(s ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";

async function installJailbreak(release, { native, arch, hud, alert }) {
  const url = debFor(release, arch);
  if (!url) {
    await alert({ title: "Can't Install", message: `Cydian ${release.version} has no .deb for ${arch || "this iPhone"} on GitHub.`, buttons: ["OK"] });
    return "no-asset";
  }
  const h = hud("Downloading");
  let r;
  try {
    const { path } = await native.call("selfupdate.download", { url });
    h.set("Installing");
    r = await native.helper(["selfupdate", path], () => {});
  } catch (e) {
    h.hide();
    await alert({ title: "Couldn't Update", message: e?.message || "The download failed.", buttons: ["OK"] });
    return "failed";
  }
  h.hide();
  if (r?.code !== 0) {
    await alert({ title: "Couldn't Update", message: `dpkg failed (${r?.code}): ${lastLine(r?.stderr) || lastLine(r?.stdout) || "no output"}`, buttons: ["OK"] });
    return "failed";
  }
  const { index } = await alert({ title: "Cydian Updated", message: `Cydian ${release.version} is installed. Close Cydian and open it again to use it.`,
    buttons: ["Later", "Close Cydian"], cancel: 0 });
  if (index === 1) await native.call("app.quit", {}).catch(() => {});
  return "installed";
}
