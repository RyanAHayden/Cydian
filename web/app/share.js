// N9: what the page does with cydian://shared?route=… (incoming.js hands it here; core/share.js reads it). The shell
// already picked the route for this build (native/share/Share.swift); sources came as cydian://add?url=… instead.
//   helper-ipa  jailbreak: "Install <name>?", then the Install IPA console (screens/ipa-install.js) over
//               share.ipaInstall (a staged file) or ipa.install (a link); the app is remembered for I3's updates
//   sign-ipa    sideload: the IPA in My IPAs (a link is added there first, library.add) and its page, where
//               Install signs it on the phone and installs it
//   deb         jailbreak: the Confirm sheet and console for that file (screens/sharedeb.js); a link is fetched first
//   refuse      an alert saying why (a .deb in the sideload app, no AppSync Unified, something iFizBox can't open)
//
//   await handleShared(url, deps) -> the route, or null when it isn't one
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { showHUD } from "./nav/hud.js";
import { format } from "./router.js";
import { parseShared, sharedRecord } from "./core/share.js";
import { apps, recordInstall } from "./core/installed.js";
import { deviceError } from "./core/signing.js";
import { NAME } from "./brand.js";

export async function handleShared(url, { native = globalThis.cydianNative, alert = showAlert, hud = showHUD } = {}) {
  const s = parseShared(url);
  if (!s) return null;
  if (s.route === "refuse") {
    await alert({ title: s.title, message: s.message, buttons: ["OK"] });
    return s.route;
  }
  const name = s.name || "this app";
  if (s.route === "helper-ipa") {
    const { index } = await alert({ title: `Install ${name}?`, message: `${NAME} installs it with the jailbreak's app installer (AppSync Unified).`,
      buttons: ["Cancel", "Install"], cancel: 0 });
    if (index !== 1) {
      if (s.file) native.call("share.discard", { file: s.file, kind: "ipa" }).catch(() => {});
      return s.route;
    }
    const { openIpaInstall } = await import("./screens/ipa-install.js");
    // A staged file goes through share.ipaInstall; ipa-install.js calls "ipa.install", so it gets a bridge that
    // turns that call into this one.
    const through = s.file ? { call: (method, params, onEvent) => native.call("share.ipaInstall", { file: s.file, stream: params?.stream }, onEvent) } : undefined;
    await openIpaInstall({ url: s.file ? name : s.url, name, native: through,
      onInstalled: (r) => remember(sharedRecord(r, name)) });
    return s.route;
  }
  if (s.route === "sign-ipa") {
    let file = s.file;
    if (!file) {
      const h = hud("Downloading");
      try {
        file = (await native.call("library.add", { url: s.url }))?.file;
      } catch (e) {
        h();
        await alert({ title: "Couldn't Download", message: deviceError(e, name).message, buttons: ["OK"] });
        return s.route;
      }
      h();
      if (!file) return s.route;
    }
    // Straight to its page in Install IPAs, no "Install?" over it: the page has Install (user 2026-11-18).
    location.hash = format({ tab: "installed", path: ["myipas", `ipa:${file}`] }).replace(/^#/, "");
    return s.route;
  }
  if (s.route === "deb") {
    let file = s.file;
    let label = s.name;
    if (!file) {
      const h = hud("Downloading");
      try {
        const r = await native.call("share.debFetch", { url: s.url });
        file = r?.file;
        label = label || r?.name;
      } catch (e) {
        h();
        await alert({ title: "Couldn't Download", message: String(e?.message ?? e).replace(/^[a-z_]+: /, ""), buttons: ["OK"] });
        return s.route;
      }
      h();
      if (!file) return s.route;
    }
    const { openDebConfirm } = await import("./screens/sharedeb.js");
    await openDebConfirm({ file, name: label }, { native });
    return s.route;
  }
  return null;
}

async function remember(rec) {
  if (!rec) return;
  try { await recordInstall(await apps(), rec); } catch { /* the record is a nicety */ }
}
