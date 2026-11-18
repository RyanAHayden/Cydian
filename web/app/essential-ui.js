// iFizBox's own update, bound to the real backend, bridge and storage (F72, F183). The logic is core/essential.js
// and core/selfupdate.js; app.js calls lookForUpdates() on every launch, Home's Reload and return, in the app only.
// No alert (user 2026-11-18): a newer iFizBox is a row on top of Changes, with its badge, and the iOS 6 banner
// "iFizBox X is out." once per version per session (user 2026-11-18: 0.9.2 showed no banner for 0.9.3).
//
//   sideload    iFizBox's own AltStore source and GitHub's latest release, both read every time; Changes' row takes
//               whichever is newer (upgradesWithSelf). Installing it (Changes' Upgrade, the app queue) signs it on
//               the phone (installSelfNow).
//   jailbreak   GitHub's release is read and kept; the row itself is apt's, from iFizBox's built-in repo.
import { installSelf, selfFromAltSource, selfUpgradeRow, saveInfo, loadInfo, withSelfUpgrade, selfInfoWith, lookForSelfUpdate,
  SELF_ALT_URL } from "./core/essential.js";
import { checkForUpdates, fetchRelease, newerRelease } from "./core/selfupdate.js";
import { getBackend } from "./backend.js";
import { detectMode } from "./core/settings.js";
import { showAlert } from "./nav/alert.js";
import { installOnDevice } from "./signing-client.js";
import { NAME } from "./brand.js";
import { showBanner } from "./nav/banner.js";

const native = () => globalThis.cydianNative;
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };

export const appVersion = () => native()?.call
  ? native().call("app.info", {}).then((i) => String(i?.version ?? ""), () => "")
  : Promise.resolve("");

// A link outside the web view: the shell's app.openURL (F72), else a plain navigation.
async function openOutside(url) {
  try {
    const r = await native()?.call?.("app.openURL", { url });
    if (r?.opened) return;
  } catch { /* an older shell: no app.openURL */ }
  location.href = url;
}

// ---- sideload: iFizBox's own AltStore source -----------------------------------------------------------------

export async function readSelfInfo() {
  // A fresh copy: raw.githubusercontent.com caches for 5 minutes, and a query of its own skips that cache.
  const info = selfFromAltSource(await getBackend().text(`${SELF_ALT_URL}?t=${Date.now()}`));
  if (info) {
    saveInfo(storage(), info);
    // Changes counts iFizBox's own upgrade from this (upgradesWithSelf): it may have counted before it was read at
    // launch (user 2026-11-18: the 0.3.8 banner came, Changes had no row and no badge).
    globalThis.dispatchEvent?.(new Event("cydian:self-info"));
  }
  return info;
}

// Changes (sideload): the upgrades with iFizBox's own row on top, from what the last check read: its source, or
// GitHub's release when that is newer (F183).
export async function upgradesWithSelf(upgrades) {
  if (detectMode() !== "sideload") return upgrades;
  const current = await appVersion();
  const info = selfInfoWith(loadInfo(storage()), newerRelease(storage(), current));
  if (!info) return upgrades;
  return withSelfUpgrade(upgrades, selfUpgradeRow(info, current));
}

export async function installSelfNow(row) {
  // The sideload app signs its own update on the phone and hosts it on the Signing Server (signing.install host:
  // true): straight to iOS's Install prompt, the key never leaves the phone. Without the bridge: installSelf.
  if (detectMode() === "sideload" && row?.ipa && globalThis.cydianNative?.call) {
    const ok = await installOnDevice({ url: row.ipa, name: NAME, host: true });
    return ok ? "installing" : "failed";
  }
  return installSelf(row, { alert: showAlert, open: openOutside });
}

// ---- launch, Home's Reload, a return ----------------------------------------------------------------------------

// Silent whatever it finds (F183): reads iFizBox's source (sideload) and GitHub's release, then Changes counts
// again (cydian:self-info). One at a time. Resolves core/essential.js lookForSelfUpdate's answer.
let running = null;
export function lookForUpdates() {
  const mode = detectMode();
  return (running ??= lookForSelfUpdate({
    mode,
    readSource: () => readSelfInfo(),
    checkRelease: () => checkForUpdates({ mode, storage: storage(), current: appVersion, release: () => fetchRelease({ native: native() }) }),
    changed: () => globalThis.dispatchEvent?.(new Event("cydian:self-info")),
  }).then(async (r) => { await bannerOnce(mode).catch(() => {}); return r; }).finally(() => { running = null; }));
}

// The newer iFizBox the last check found, as Changes' row has it: sideload the source or GitHub's release, jailbreak
// GitHub's (apt's row comes from the same release). Upgrade opens Changes. Once per version per session.
let bannered = null;
async function bannerOnce(mode) {
  const current = await appVersion();
  const release = newerRelease(storage(), current);
  const v = mode === "sideload" ? selfUpgradeRow(selfInfoWith(loadInfo(storage()), release), current)?.version : release?.version;
  if (!v || bannered === v) return;
  bannered = v;
  showBanner({ title: NAME, message: `${NAME} ${v} is out.`, action: { label: "Upgrade", onClick: () => { location.hash = "#/changes"; } } });
}
