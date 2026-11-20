// F75: Open in iFizBox App (Home's Send Settings), like Feather's feather:// links. On the website (Settings, and
// Home's Install iFizBox App area) a row that opens ifizbox://import?d=<base64url of gzipped JSON> with the visitor's
// sources, the settings that travel (core/settings.js TRAVELS), Ignored Upgrades and, F93, the certificate saved in
// the website's Settings > Signing (as before F89; no Signing Server). In the app, incoming.js hands the link to
// reviewAndImport, which adds only what's new and puts the certificate into the Keychain (signing.import).
//
//   openInAppSection()                   the website's group, Not Jailbroken (an empty box anywhere else)
//   await openInApp()                    builds the link, shows the banner, opens it
//   await websitePayload({ identity })   what the link carries (sources as core/sourcelist.js export lines; the
//                                        certificate unless identity: false)
//   await reviewAndImport(url, deps)     the app's side -> "imported" | "cancelled" | "nothing" | "bad"
//   reviewText(review, label)            the alert's lines (pure)
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showBanner } from "../nav/banner.js";
import { showHUD } from "../nav/hud.js";
import { detectMode, TRAVELS, SETTINGS } from "../core/settings.js";
import { exportLine } from "../core/sourcelist.js";
import { encodeLink, decodeLink, reviewLink, toB64url, fromB64url } from "../core/transfer.js";
import { toBase64 } from "../core/signing.js";
import { getBackend } from "../backend.js";
import { loadIdentity, saveIdentity } from "../signing/identity.js";
import { settings } from "../settings-store.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";

export function openInAppSection() {
  const box = document.createElement("div");
  if (detectMode() !== "site" || settings.deviceType() !== "none") return box; // the sideload app takes the link
  box.append(grouped([{ header: `${NAME} App`, rows: [{ label: `Open in ${NAME} App`, onClick: () => openInApp(), icon: rowIcon("openInApp") }],
    footer: `Brings your certificate, sources and settings into the ${NAME} app on this iPhone.` }]));
  return box;
}

export async function websitePayload({ backend = getBackend(), store = settings, identity = true, load = loadIdentity } = {}) {
  const sources = (await backend.sources().catch(() => [])).filter((s) => s?.uri).map(exportLine);
  const values = {};
  for (const k of TRAVELS) if (store.isShown(k)) values[k] = store.get(k);
  // F93: the certificate goes along when this browser has one (Settings > Signing), so the app needs no setup.
  let id = null;
  if (identity) {
    try {
      const c = await load();
      if (c?.p12 && c?.profile) id = { p12: toB64url(c.p12), profile: toB64url(c.profile), password: c.password ?? "",
        p12Name: c.p12Name ?? "", profileName: c.profileName ?? "" };
    } catch { /* no certificate stored here */ }
  }
  const versions = store.ignoredVersions?.all?.() ?? {}; // F281: Ignore This Version
  return { sources, settings: values, holds: store.holds.list(), ...(id ? { identity: id } : {}),
    ...(Object.keys(versions).length ? { versions } : {}) };
}

async function openInApp() {
  const hide = showHUD("Preparing");
  let link;
  try { link = await encodeLink(await websitePayload()); } catch {
    hide();
    await showAlert({ title: `Can't Open ${NAME}`, message: "This browser can't pack the list (it needs Safari 16.4 or later).", buttons: ["OK"] });
    return;
  }
  hide();
  // Safari's own "Open in iFizBox?" can't be reworded: the banner says which button to press.
  showBanner({ title: NAME, message: `Press Open to bring your certificate, sources and settings into ${NAME}.`, wait: true });
  location.href = link;
}

const labelOf = (key) => SETTINGS.find((d) => d.key === key)?.label ?? key;
const optionOf = (key, v) => SETTINGS.find((d) => d.key === key)?.options?.find((o) => o.value === v)?.label ?? String(v);

export function reviewText(r) {
  const lines = [];
  if (r.sources.length) {
    const names = r.sources.slice(0, 5).map((e) => e.uri.replace(/^https?:\/\//, "").replace(/\/$/, ""));
    const more = r.sources.length - names.length;
    lines.push(`${r.sources.length === 1 ? "1 new source" : `${r.sources.length} new sources`}: ${names.join(", ")}${more ? ` and ${more} more` : ""}.`);
  }
  for (const s of r.settings) lines.push(`${labelOf(s.key)}: ${optionOf(s.key, s.to)}.`);
  if (r.holds.length) lines.push(`Ignored Upgrades: ${r.holds.length} more.`);
  const nv = Object.keys(r.versions ?? {}).length; // F281
  if (nv) lines.push(`Ignored versions: ${nv} more.`);
  return lines.join("\n");
}

export async function reviewAndImport(url, { native = globalThis.ifizboxNative, backend = getBackend(), store = settings,
  alert = showAlert, hud = showHUD, banner = showBanner,
  // B141: manage.js's onSourcesChanged listeners (loaded here, not imported: settings.js -> this -> manage.js ->
  // settings.js would be a cycle at start-up). screens/sources.js loads the new sources under the reload bar and
  // puts them in the catalog; an open Search runs its query again.
  changed = async () => (await import("./manage.js")).sourcesChanged() } = {}) {
  const gunzip = native?.call
    ? async (bytes) => (await native.call("app.gunzip", { data: toBase64(bytes) })).text
    : null;
  const payload = await decodeLink(url, { gunzip });
  if (!payload) {
    await alert({ title: "Can't Import", message: "That link from the website can't be read.", buttons: ["OK"] });
    return "bad";
  }
  const have = await backend.sources().catch(() => []);
  const r = reviewLink(payload, {
    have, get: (k) => (store.isShown(k) ? store.get(k) : undefined), shown: (k) => store.isShown(k),
    holds: store.holds.list(), versions: store.ignoredVersions?.all?.() ?? {},
  });
  // Straight away, no question (user 2026-11-17): the user asked for it by opening the link.
  const hide = hud("Importing");
  const failed = [];
  // F93: the website's certificate into the Keychain, as before F89.
  if (payload.identity && native?.call) {
    try {
      const b64 = (t) => toBase64(fromB64url(t));
      await native.call("signing.import", { p12: b64(payload.identity.p12), profile: b64(payload.identity.profile),
        password: payload.identity.password ?? "" });
      await saveIdentity({ p12Name: payload.identity.p12Name, profileName: payload.identity.profileName }).catch(() => {});
    } catch (err) { failed.push(`Certificate: ${err?.message ?? err}`); }
  }
  if (r.empty && !payload.identity) {
    hide();
    await alert({ title: "Nothing New", message: `${NAME} already has the website's sources and settings.`, buttons: ["OK"] });
    return "nothing";
  }
  // Sources on the Source Warning list (core/warnings.js) stay out, as Manage's import leaves them unticked.
  let added = 0;
  for (const e of r.sources.filter((x) => !x.warning)) {
    try { await backend.addSource(e.input); added++; } catch (err) { failed.push(`${e.uri}: ${err?.message ?? err}`); }
  }
  // B141: the new sources load now (the launch refresh ran before this import ended), not on the next Refresh.
  if (added) { try { await changed(); } catch { /* the sources are in; Search and Refresh load them later */ } }
  for (const s of r.settings) { try { store.set(s.key, s.to); } catch { /* an option this build lacks */ } }
  for (const p of r.holds) { try { await store.holds.set(p, true); } catch { /* the helper refused */ } }
  for (const [id, v] of Object.entries(r.versions ?? {})) { try { store.ignoredVersions?.set(id, v); } catch { /* storage full */ } } // F281
  // One popup only: the HUD ends on its checkmark; anything that didn't go in is a banner, which goes by itself.
  if (hide.done) hide.done("Imported");
  else hide();
  if (failed.length) {
    const names = failed.map((f) => f.split(": ")[0].replace(/^https?:\/\//, "").replace(/\/$/, ""));
    banner({ title: NAME, duration: 6000,
      message: `${names.length === 1 ? names[0] : `${names.length} items`} couldn't be added: ${failed.length === 1 ? "try it again in Sources" : names.slice(0, 3).join(", ")}.` });
  }
  return "imported";
}
