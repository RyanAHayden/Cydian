// The Essential Upgrade alert on launch (F72), bound to the real backend, catalog, bridge and alerts. The logic is
// core/essential.js; app.js calls startEssential() once the launch has settled, in the app only.
//
//   jailbreak   catalog.upgrades (apt's lists) + dpkg's status (Essential: yes) + the built-in repo's minimum.
//               Complete Upgrade and Essential Only queue the upgrades (N4), and the Confirm sheet opens.
//   sideload    Cydian's own AltStore source, read once per launch: Cydian's newest version and its minimum.
//               F86: Complete Upgrade queues every upgrade Changes lists (Upgrade (N)'s queueUpgrades), Essential
//               Only just Cydian, in the app queue, and F80's Confirm opens (Cydian last: installing it closes the
//               app). Nothing could be queued (no Cydian.ipa in the source): installSelfNow says why.
// Either build, forced (below the minimum): Confirm's Cancel brings the alert back (core/essential.js queueEssential).
// Nothing found to read (the built-in source never loaded, offline): resolves "unknown", and app.js falls back on
// F61's GitHub check.
import { showBanner } from "./nav/banner.js";
import { runEssential, queueEssential, installSelf, selfFromAltSource, selfUpgradeRow, essentialIds, essentialUpgrades, minimumOf,
  isBuiltin, saveInfo, loadInfo, withSelfUpgrade, SELF_ALT_URL, SELF_ID } from "./core/essential.js";
import { getBackend } from "./backend.js";
import { catalog } from "./catalog.js";
import { detectMode } from "./core/settings.js";
import { parseStatus } from "./core/installed.js";
import { showAlert } from "./nav/alert.js";
import { settings } from "./screens/settings.js";
import { installOnDevice } from "./signing-client.js";

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

// ---- sideload: Cydian's own AltStore source -----------------------------------------------------------------

export async function readSelfInfo() {
  // A fresh copy: raw.githubusercontent.com caches for 5 minutes, and a query of its own skips that cache.
  const info = selfFromAltSource(await getBackend().text(`${SELF_ALT_URL}?t=${Date.now()}`));
  if (info) {
    saveInfo(storage(), info);
    // Changes counts Cydian's own upgrade from this (upgradesWithSelf): it may have counted before it was read at
    // launch (user 2026-11-18: the 0.3.8 banner came, Changes had no row and no badge).
    globalThis.dispatchEvent?.(new Event("cydian:self-info"));
  }
  return info;
}

// Changes (sideload): the upgrades with Cydian's own row on top, from what the last launch read.
export async function upgradesWithSelf(upgrades) {
  if (detectMode() !== "sideload") return upgrades;
  const info = loadInfo(storage());
  if (!info) return upgrades;
  return withSelfUpgrade(upgrades, selfUpgradeRow(info, await appVersion()));
}

export async function installSelfNow(row) {
  // The sideload app signs its own update on the phone and hosts it on the Signing Server (signing.install host:
  // true): straight to iOS's Install prompt, the key never leaves the phone. Without the bridge: installSelf.
  if (detectMode() === "sideload" && row?.ipa && globalThis.cydianNative?.call) {
    const ok = await installOnDevice({ url: row.ipa, name: "Cydian", host: true });
    return ok ? "installing" : "failed";
  }
  return installSelf(row, { alert: showAlert, open: openOutside });
}

// ---- jailbreak: the queue -----------------------------------------------------------------------------------

function queueAll(rows) {
  const q = getBackend().queue;
  if (typeof q !== "function") { showAlert({ title: "Can't Upgrade", message: "This build has no install queue.", buttons: ["OK"] }); return 0; }
  let n = 0;
  for (const r of rows) {
    if (r?.id && r.version) { q.call(getBackend(), { op: "install", id: r.id, version: r.version, installed: r.installed ?? null, name: r.name ?? null }); n++; }
  }
  return n;
}

// ---- sideload: the app queue (F80) ----------------------------------------------------------------------------

// Complete Upgrade: what Changes' Upgrade (N) would queue, read when the button is tapped (the alert doesn't wait
// for the catalog): every app upgrade, with Cydian's own row on top. Unreadable: just the rows the alert had.
async function sideloadAll(rows) {
  try {
    const { withAppUpgrades } = await import("./app-updates.js");
    const holds = settings.holds.list();
    await catalog.ensure?.();
    const self = rows.find((r) => r.id === SELF_ID) ?? null;
    const u = await withAppUpgrades(withSelfUpgrade(await catalog.upgrades(holds), self), holds);
    return u.available?.length ? u.available : rows;
  } catch { return rows; }
}

async function queueApps(rows) {
  const { queueUpgrades } = await import("./screens/changes.js");
  return (await queueUpgrades(rows)).length;
}

// One button of the alert: queue, open Confirm, wait for it. -> "queued" | "cancelled" | installSelfNow's answer.
async function queueButton(mode, rows, { everything = false } = {}) {
  const { whenConfirmEnds } = await import("./screens/queue.js");
  const self = (list) => list.find((r) => r.id === SELF_ID) ?? list[0];
  if (mode === "sideload") {
    const list = everything ? await sideloadAll(rows) : rows;
    return queueEssential(list, { queue: queueApps, confirmed: whenConfirmEnds, fallback: (l) => installSelfNow(self(l)) });
  }
  return queueEssential(rows, { queue: queueAll, confirmed: whenConfirmEnds });
}

// ---- forced: nothing else is usable ---------------------------------------------------------------------------
// A clear block over the screens and tab bar (under the HUD, the Confirm sheet and alerts): a tap asks again.
let block = null;
function lock(prompt) {
  if (block) return;
  block = document.createElement("div");
  block.className = "essential-block";
  Object.assign(block.style, { position: "fixed", inset: "0", zIndex: "10", background: "transparent" });
  block.setAttribute("aria-label", "Cydian needs to upgrade itself first");
  block.addEventListener("click", () => prompt().catch(() => {}));
  document.body.append(block);
}

// ---- launch -------------------------------------------------------------------------------------------------

async function gather(mode) {
  if (mode === "sideload") {
    const [info, current] = await Promise.all([readSelfInfo(), appVersion()]);
    if (!info) return null;
    const row = selfUpgradeRow(info, current);
    return { current, minimum: info.minimum, essential: row ? [row] : [], all: row ? [row] : [] };
  }
  const backend = getBackend();
  const list = await backend.sources();
  const self = list.find(isBuiltin);
  if (!self || self.updated == null) return null; // never read: F61 still checks GitHub
  await catalog.ensure();
  const [upgrades, status, current] = await Promise.all([
    catalog.upgrades(settings.holds.list()), backend.dpkgStatus?.().catch(() => null) ?? null, appVersion()]);
  const ids = essentialIds(status ? parseStatus(status) : []);
  return { current, minimum: minimumOf(self), essential: essentialUpgrades(upgrades.available, ids), all: upgrades.available };
}

// A Cydian update that isn't required: the iOS 6 banner, "Cydian X is out", with Upgrade (queues it, Confirm opens).
// Once per version per session, so coming back to Cydian doesn't show it again.
let bannered = null;
function bannerOnce(rows, upgrade) {
  const v = rows.find((r) => r.id === SELF_ID)?.version ?? rows[0]?.version ?? "";
  if (!v || bannered === v) return;
  bannered = v;
  showBanner({ title: "Cydian", message: `Cydian ${v} is out.`, action: { label: "Upgrade", onClick: upgrade } });
}

let running = null;
export function startEssential() {
  const mode = detectMode();
  if (mode !== "sideload" && mode !== "jailbreak") return Promise.resolve("site");
  return (running ??= runEssential({
    gather: () => gather(mode),
    alert: showAlert,
    lock,
    complete: (all) => queueButton(mode, all, { everything: true }),
    essentialOnly: (rows) => queueButton(mode, rows),
    ...(mode === "sideload" ? { notify: bannerOnce } : {}),
  }).finally(() => { running = null; }));
}
