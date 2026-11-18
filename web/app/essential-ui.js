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
import { runEssential, queueEssential, installSelf, selfFromAltSource, selfUpgradeRow, essentialIds, essentialUpgrades, minimumOf,
  isBuiltin, saveInfo, loadInfo, withSelfUpgrade, SELF_ALT_URL, SELF_ID } from "./core/essential.js";
import { getBackend } from "./backend.js";
import { catalog } from "./catalog.js";
import { detectMode } from "./core/settings.js";
import { parseStatus } from "./core/installed.js";
import { showAlert } from "./nav/alert.js";
import { settings } from "./screens/settings.js";
import { getServer, pollJob, installOnDevice } from "./signing-client.js";
import { signBody, errorText } from "./core/signing.js";

const native = () => globalThis.cydianNative;
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };

export const appVersion = () => native()?.call
  ? native().call("app.info", {}).then((i) => String(i?.version ?? ""), () => "")
  : Promise.resolve("");

// A link outside the web view: the shell's app.openURL (F72), else a plain navigation.
export async function openOutside(url) {
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
  if (info) saveInfo(storage(), info);
  return info;
}

// Changes (sideload): the upgrades with Cydian's own row on top, from what the last launch read.
export async function upgradesWithSelf(upgrades) {
  if (detectMode() !== "sideload") return upgrades;
  const info = loadInfo(storage());
  if (!info) return upgrades;
  return withSelfUpgrade(upgrades, selfUpgradeRow(info, await appVersion()));
}

// The certificate the Signing Server may use: the shell's signing.export, which the app doesn't have yet (the key
// stays in the Keychain, I6): null, and installSelf sends the user to cydian.dev instead.
async function exportIdentity() {
  const r = await native()?.call?.("signing.export", {});
  if (!r?.p12 || !r?.profile) return null;
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { p12: bytes(r.p12), profile: bytes(r.profile), password: r.password ?? "" };
}

// POST <server>/sign as signing-client's signAndInstall does, with the given identity: the itms-services link.
async function signOnServer({ url, identity, server }) {
  const json = JSON.stringify({ ...JSON.parse(signBody({ url, ...identity })), async: true });
  let status, body;
  try {
    const res = await fetch(`${server}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: json });
    status = res.status;
    body = await res.json().catch(() => null);
    if (status === 202 && typeof body?.job === "string") ({ status, body } = await pollJob(server, body));
  } catch {
    throw new Error(`The signing server (${new URL(server).host}) can't be reached.`);
  }
  if (status !== 200 || !body?.itms) throw new Error(errorText(status, body));
  return body.itms;
}

export async function installSelfNow(row) {
  // The sideload app signs its own update on the phone and hosts it on the Signing Server (signing.install host:
  // true): straight to iOS's Install prompt, the key never leaves the phone. installSelf's paths stay for the rest.
  if (detectMode() === "sideload" && row?.ipa && globalThis.cydianNative?.call) {
    const ok = await installOnDevice({ url: row.ipa, name: "Cydian", host: true });
    return ok ? "installing" : "failed";
  }
  return installSelf(row, { exportIdentity, server: getServer(), signOnServer, alert: showAlert, open: openOutside, storage: storage() });
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
  }).finally(() => { running = null; }));
}
