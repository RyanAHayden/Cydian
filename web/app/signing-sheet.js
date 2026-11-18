// Look first, then sign (F68): the sideload build's Custom Install on an AltStore app (F81: plain Install signs
// straight away, signing-client.js signAndInstall; this sheet is the app page's "Custom Install" row). signing.inspect downloads the IPA and
// says what it is and asks for; this sheet shows that as an iOS 6 grouped table (its permissions, its entitlements,
// what the user's profile can't give it, its extensions with a switch each to leave one out) with the Name, Bundle
// ID and Icon to sign it as; Install (top right) sends signing.install {token, ...edits} (core/signing.js installParams)
// and then follows iOS's own install with signing.progress {bundleId}. docs/signing.md "Before and around signing".
//
//   await inspectAndInstall({ url, name, onInstalled })   true once iOS was asked to install, false otherwise
//   await customInstall({ url, name, onInstalled })       the same, after F75's first-install check (the row's tap)
//   await customInstall({ url, name, queue })             F84: the sheet's Install queues instead: queue(options) with
//                                                         core/appqueue.js's job options, then Confirm signs it in turn
//   await inspectToQueue({ url, name, queue })            that sheet, without the first-install check
//
// The sheet's buttons (F81, user 2026-11-17): Install at the top right of its nav bar, a red Cancel at the bottom.
//
// The bridge is globalThis.cydianNative; an older shell without signing.inspect installs straight away as before.
// SPDX-License-Identifier: GPL-3.0-or-later
import { showSheet } from "./nav/sheet.js";
import { showAlert } from "./nav/alert.js";
import { showHUD } from "./nav/hud.js";
import { grouped } from "./nav/ui.js";
import { format, settingsRoute } from "./router.js";
import { installOnDevice } from "./signing-client.js";
import { createSwitch } from "./screens/settings.js";
import { phaseLabel, deviceError, inspectGroups, installParams, installedId, isCgBI, fromBase64 } from "./core/signing.js";

const ICON_SIZE = 180; // the 60pt @3x icon; the signer writes the same PNG as @2x and @3x

let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./signsheet.css", import.meta.url).href;
  document.head.append(link);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function liveHUD(text) {
  const hide = showHUD(text);
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  return { set: (t) => { if (label) label.textContent = t; }, hide };
}

// An older shell answers "unknown method signing.inspect" (Bridge.swift).
const unknownMethod = (e) => /unknown method/i.test(String(e?.message ?? e ?? ""));

export async function inspectAndInstall({ url, name = "", onInstalled = () => {} },
  { native = globalThis.cydianNative, hud = liveHUD, alert = showAlert, install = installOnDevice, sheet = openSignSheet, later = setTimeout } = {}) {
  const h = hud("Downloading");
  let info;
  try {
    info = await native.call("signing.inspect", { url }, (ev) => { const t = phaseLabel(ev); if (t) h.set(t); });
  } catch (e) {
    h.hide();
    if (unknownMethod(e)) return install({ url, name, onInstalled });
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") location.hash = format(settingsRoute(["signing"])).replace(/^#/, "");
    return false;
  }
  h.hide();
  return new Promise((resolve) => {
    let started = false;
    const close = sheet(info, {
      fallbackName: name,
      async onSign(edits) {
        let params;
        try {
          params = installParams(info, edits);
        } catch (e) {
          await alert({ title: "Can't Sign", message: e.message, buttons: ["OK"] });
          return;
        }
        started = true;
        close();
        const shown = params.name || info.app?.name || name;
        resolve(await install({ url, name: shown, onInstalled, params,
          after: (result, hh) => followInstall(native, installedId(result, params, info), hh, { later }) }));
      },
      onClose: () => { if (!started) resolve(false); },
    });
  });
}

// The Custom Install row's tap: the Signing walkthrough first when something is missing (F75), else the sheet. With
// `opts.queue` (F84, the app page) the sheet's Install queues the app with its options instead of signing now.
export async function customInstall(opts, { check = null, inspect = inspectAndInstall, toQueue = inspectToQueue } = {}) {
  const missing = check ? await check() : await (await import("./signing-client.js")).firstInstallCheck();
  if (missing) return false;
  return opts?.queue ? toQueue(opts) : inspect(opts);
}

// F84: look first, then the sheet; its Install hands `queue` the job's options (core/appqueue.js: token and when it
// was looked at, the edits, the name to show, the ID iOS will know it by) and closes. True once queued, false on
// Cancel or an error (shown). An older shell without signing.inspect queues it plain (queue(null)), as Install would.
export async function inspectToQueue({ url, name = "", queue },
  { native = globalThis.cydianNative, hud = liveHUD, alert = showAlert, sheet = openSignSheet, now = Date.now } = {}) {
  const h = hud("Downloading");
  let info;
  try {
    info = await native.call("signing.inspect", { url }, (ev) => { const t = phaseLabel(ev); if (t) h.set(t); });
  } catch (e) {
    h.hide();
    if (unknownMethod(e)) { queue(null); return true; }
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") location.hash = format(settingsRoute(["signing"])).replace(/^#/, "");
    return false;
  }
  h.hide();
  return new Promise((resolve) => {
    let queued = false;
    const close = sheet(info, {
      fallbackName: name,
      async onSign(edits) {
        let params;
        try {
          params = installParams(info, edits);
        } catch (e) {
          await alert({ title: "Can't Sign", message: e.message, buttons: ["OK"] });
          return;
        }
        queued = true;
        close();
        const { token, ...rest } = params;
        queue({ token, at: now(), edits: rest, name: params.name || info.app?.name || name || null,
          signsAs: installedId(null, params, info) });
        resolve(true);
      },
      onClose: () => { if (!queued) resolve(false); },
    });
  });
}

// The sheet's chrome (F81): `right` (the nav bar's right side) gets Install, done-styled, in place of Done; `box` (the
// scroll content) ends with a red Cancel. -> { install, cancel }.
export function signSheetButtons({ right, box, onInstall, onCancel, doc = document }) {
  const install = doc.createElement("button");
  install.type = "button";
  install.className = "bar-button done ss-install";
  install.textContent = "Install";
  install.addEventListener("click", () => onInstall());
  right?.replaceChildren(install);
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "ss-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => onCancel());
  box.append(cancel);
  return { install, cancel };
}

// signing.progress {bundleId}: iOS's own progress on the HUD until it says installed (or gives up), then it goes.
export async function followInstall(native, bundleId, h, { later = setTimeout } = {}) {
  if (!bundleId) { later(h.hide, 2500); return null; }
  let r = null;
  try {
    r = await native.call("signing.progress", { bundleId }, (ev) => {
      const pct = Math.round(Number(ev?.progress) * 100);
      h.set(pct > 0 && pct < 100 ? `Installing ${pct}%` : "Installing");
    });
  } catch { /* an older shell, or the private API gone: the HUD just goes */ }
  if (r?.installed === true) { h.set("Installed"); later(h.hide, 1200); } else h.hide();
  return r?.installed ?? null;
}

// The sheet itself. `onSign(edits)` with { name, bundleId, icon (base64 PNG | null), removeExtensions: [path] }.
// Returns the sheet's close().
function openSignSheet(info, { onSign, onClose = () => {}, fallbackName = "" } = {}) {
  style();
  const app = info?.app ?? {};
  const edits = { name: app.name || fallbackName, bundleId: info?.signsAs || app.bundleId || "", icon: null, removeExtensions: [] };
  const box = el("div", "sheet-scroll page-body grouped sign-sheet");

  // The head: the icon, the name and what it signs as, like an App Store page's top.
  const head = el("div", "ss-head");
  const iconBox = el("span", "ss-icon");
  const title = el("span", "ss-title", edits.name || "App");
  const sub = el("span", "ss-sub", [app.version ? `Version ${app.version}` : null, app.bundleId].filter(Boolean).join(" · "));
  const words = el("span", "ss-words");
  words.append(title, sub);
  head.append(iconBox, words);
  box.append(head);

  const ipaIcon = typeof info?.icon === "string" && info.icon ? info.icon : null;
  const placeholder = () => {
    iconBox.replaceChildren(el("span", "ss-icon-letter", (edits.name || "?").trim().charAt(0).toUpperCase() || "?"));
    iconBox.classList.add("is-placeholder");
  };
  const showIcon = (b64) => {
    const img = new Image();
    img.alt = "";
    img.onerror = placeholder;
    img.src = `data:image/png;base64,${b64}`;
    iconBox.classList.remove("is-placeholder");
    iconBox.replaceChildren(img);
  };
  const drawIcon = () => {
    if (edits.icon) showIcon(edits.icon);
    // Apple's CgBI PNG (most IPAs' icons) is byte-swapped and premultiplied: no browser draws it.
    else if (ipaIcon && !isCgBI(fromBase64(ipaIcon))) showIcon(ipaIcon);
    else placeholder();
  };
  drawIcon();

  // Install As: the three things the user may change.
  const g = el("div", "group");
  g.append(el("h2", "group-header", "Install As"));
  const ul = el("ul", "table grouped");
  const field = (label, value, set, extra = {}) => {
    const li = el("li", "cell");
    const row = el("label", "cell-inner sign-row ss-field");
    const input = Object.assign(el("input", "sign-value"), { type: "text", value, ...extra });
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.addEventListener("input", () => set(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    row.append(el("span", "cell-label", label), input);
    li.append(row);
    return li;
  };
  ul.append(field("Name", edits.name, (v) => { edits.name = v; title.textContent = v.trim() || app.name || "App"; if (iconBox.classList.contains("is-placeholder")) placeholder(); },
    { placeholder: app.name || "" }));
  ul.append(field("Bundle ID", edits.bundleId, (v) => { edits.bundleId = v; }, { placeholder: info?.signsAs || app.bundleId || "", inputMode: "url" }));
  const iconLi = el("li", "cell sign-files-cell");
  const iconRow = el("div", "cell-inner sign-row ss-icon-row");
  const iconState = el("span", "sign-value", "");
  const setIconState = () => {
    iconState.textContent = edits.icon ? "Chosen" : ipaIcon && !isCgBI(fromBase64(ipaIcon)) ? "The App's" : "The App's (not shown)";
  };
  setIconState();
  iconRow.append(el("span", "cell-label", "Icon"), iconState);
  const file = Object.assign(el("input", "visually-hidden"), { type: "file", accept: "image/*" });
  file.id = "ssi" + Math.random().toString(36).slice(2);
  const choose = Object.assign(el("label", "bar-button sign-browse", "Choose"), { htmlFor: file.id });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      edits.icon = await iconPNG(f);
      drawIcon();
      setIconState();
    } catch {
      await showAlert({ title: "Can't Use This Image", message: "Cydian couldn't read it. Choose a PNG or JPEG.", buttons: ["OK"] });
    }
  });
  iconLi.append(iconRow, file, choose);
  ul.append(iconLi);
  g.append(ul);
  const as = info?.signsAs && info.signsAs !== app.bundleId ? ` Your profile signs it as ${info.signsAs}.` : "";
  g.append(el("p", "group-footer", `Change the name on the Home Screen, the bundle ID (to install a second copy) or the icon (made ${ICON_SIZE}×${ICON_SIZE}).${as}`));
  box.append(g);

  box.append(grouped(inspectGroups(info)));
  // The missing group's rows are a warning: red, as Settings' warnings are.
  for (const grp of box.querySelectorAll(".group")) {
    if (grp.querySelector(".group-header")?.textContent === "Your Profile Can't Give It") grp.classList.add("ss-missing");
  }

  // Extensions: on means signed and kept; off leaves the bundle out.
  const exts = Array.isArray(app.extensions) ? app.extensions : [];
  if (exts.length) {
    const eg = el("div", "group");
    eg.append(el("h2", "group-header", "Extensions"));
    const eul = el("ul", "table grouped");
    for (const x of exts) {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner has-switch ss-ext");
      const text = el("span", "cell-text");
      text.append(el("span", "cell-label", x.name || x.path.split("/").pop()), el("span", "cell-subtitle", x.point || x.bundleId || x.path));
      inner.append(text, createSwitch({ label: `Keep ${x.name || x.path}`, checked: true, onToggle: (on) => {
        const set = new Set(edits.removeExtensions);
        if (on) set.delete(x.path); else set.add(x.path);
        edits.removeExtensions = [...set];
      } }));
      li.append(inner);
      eul.append(li);
    }
    eg.append(eul, el("p", "group-footer", "Widgets, share sheets, Watch apps. Turn one off to leave it out: each needs an App ID of its own, which a free account may not have to spare."));
    box.append(eg);
  }

  const close = showSheet({ title: edits.name || "Install", body: box, onClose });
  const sheetEl = box.closest(".sheet");
  signSheetButtons({ right: sheetEl?.querySelector(".sheet-right"), box,
    onInstall: () => onSign?.({ ...edits, removeExtensions: [...edits.removeExtensions] }), onCancel: () => close() });
  sheetEl?.classList.add("sign-sheet-modal");
  return close;
}

// A picked image as a 180x180 PNG, base64 (no data: prefix): drawn centred and cropped to a square.
export async function iconPNG(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const canvas = Object.assign(document.createElement("canvas"), { width: ICON_SIZE, height: ICON_SIZE });
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("empty image");
    ctx.fillStyle = "#fff"; // iOS draws a transparent icon's holes black: white is kinder
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}
