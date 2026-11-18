// F75: Open in Cydian App, like Feather's feather:// links. On the website (Settings, and Home's Install Cydian App
// area) a row that opens cydian://import?d=<base64url of gzipped JSON> with the visitor's sources, the settings that
// travel (core/settings.js TRAVELS), Ignored Upgrades and the Signing Server; never the certificate (that travels
// only inside Cydian's own IPA, or encrypted through Import from Safari). In the app, incoming.js hands the link to
// reviewAndImport: an "Import from the Website?" alert listing only what's new, then Import adds it.
//
//   openInAppSection()                   the website's group, Not Jailbroken (an empty box anywhere else)
//   await openInApp()                    builds the link, shows the banner, opens it
//   await websitePayload()               what the link carries (sources as core/sourcelist.js export lines)
//   await reviewAndImport(url, deps)     the app's side -> "imported" | "cancelled" | "nothing" | "bad"
//   reviewText(review, label)            the alert's lines (pure)
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showBanner } from "../nav/banner.js";
import { showHUD } from "../nav/hud.js";
import { detectMode, TRAVELS, SETTINGS } from "../core/settings.js";
import { exportLine } from "../core/sourcelist.js";
import { encodeLink, decodeLink, reviewLink } from "../core/transfer.js";
import { toBase64 } from "../core/signing.js";
import { getServer, setServer } from "../signing-client.js";
import { getBackend } from "../backend.js";
import { settings } from "./settings.js";

export function openInAppSection() {
  const box = document.createElement("div");
  if (detectMode() !== "site" || settings.deviceType() !== "none") return box; // the sideload app takes the link
  box.append(grouped([{ header: "Cydian App", rows: [{ label: "Open in Cydian App", onClick: () => openInApp() }],
    footer: "Brings your sources and settings into the Cydian app on this iPhone. Your certificate stays here." }]));
  return box;
}

export async function websitePayload({ backend = getBackend(), store = settings, server = getServer() } = {}) {
  const sources = (await backend.sources().catch(() => [])).filter((s) => s?.uri).map(exportLine);
  const values = {};
  for (const k of TRAVELS) if (store.isShown(k)) values[k] = store.get(k);
  return { sources, settings: values, holds: store.holds.list(), server };
}

export async function openInApp() {
  const hide = showHUD("Preparing");
  let link;
  try { link = await encodeLink(await websitePayload()); } catch {
    hide();
    await showAlert({ title: "Can't Open Cydian", message: "This browser can't pack the list (it needs Safari 16.4 or later).", buttons: ["OK"] });
    return;
  }
  hide();
  // Safari's own "Open in Cydian?" can't be reworded: the banner says which button to press.
  showBanner({ title: "Cydian", message: "Press Open to import your sources and settings into Cydian." });
  location.href = link;
}

const labelOf = (key) => SETTINGS.find((d) => d.key === key)?.label ?? key;
const optionOf = (key, v) => SETTINGS.find((d) => d.key === key)?.options?.find((o) => o.value === v)?.label ?? String(v);
const host = (u) => { try { return new URL(u).host; } catch { return String(u); } };

export function reviewText(r) {
  const lines = [];
  if (r.sources.length) {
    const names = r.sources.slice(0, 5).map((e) => e.uri.replace(/^https?:\/\//, "").replace(/\/$/, ""));
    const more = r.sources.length - names.length;
    lines.push(`${r.sources.length === 1 ? "1 new source" : `${r.sources.length} new sources`}: ${names.join(", ")}${more ? ` and ${more} more` : ""}.`);
  }
  for (const s of r.settings) lines.push(`${labelOf(s.key)}: ${optionOf(s.key, s.to)}.`);
  if (r.holds.length) lines.push(`Ignored Upgrades: ${r.holds.length} more.`);
  if (r.server) lines.push(`Signing Server: ${host(r.server.to)}.`);
  return lines.join("\n");
}

export async function reviewAndImport(url, { native = globalThis.cydianNative, backend = getBackend(), store = settings,
  alert = showAlert, hud = showHUD } = {}) {
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
    holds: store.holds.list(), server: getServer(),
  });
  if (r.empty) {
    await alert({ title: "Nothing New", message: "Cydian already has the website's sources and settings.", buttons: ["OK"] });
    return "nothing";
  }
  const { index } = await alert({ title: "Import from the Website?", message: reviewText(r), buttons: ["Cancel", "Import"], cancel: 0 });
  if (index !== 1) return "cancelled";
  const hide = hud("Importing");
  const failed = [];
  // Sources on the Source Warning list (core/warnings.js) stay out, as Manage's import leaves them unticked.
  for (const e of r.sources.filter((x) => !x.warning)) {
    try { await backend.addSource(e.input); } catch (err) { failed.push(`${e.uri}: ${err?.message ?? err}`); }
  }
  for (const s of r.settings) { try { store.set(s.key, s.to); } catch { /* an option this build lacks */ } }
  for (const p of r.holds) { try { await store.holds.set(p, true); } catch { /* the helper refused */ } }
  if (r.server) setServer(r.server.to);
  if (failed.length) {
    hide();
    await alert({ title: "Some Sources Failed", message: failed.join("\n\n"), buttons: ["OK"] });
  } else if (hide.done) hide.done("Imported");
  else hide();
  return "imported";
}
