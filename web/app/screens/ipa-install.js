// F67: Install IPA in the jailbreak build (ipa-install.js runs it over F59's ipa.install; core/ipainstall.js has the
// words). Three ways in:
//   - Settings > Install IPA > Install from URL: an alert with a URL field and Paste (askIpaUrl)
//   - an AltStore app's Install row (screens/altstore.js installRows, jailbreak only): the app's own IPA
//   - a tapped link to an .ipa anywhere in the app (depictions, news): an action sheet offers Install IPA
//     (initIpaLinks, app.js)
// F88: a successful install is remembered (core/installed.js) for the Installed tab's Apps page and Changes: the
// AltStore row's with its source (installRows' onInstall), a URL's or link's by bundle id (rememberIpa).
// All open the same console as the install queue's (screens/queue.js modal, queue.css's .console): the shell's and
// helper's lines as they come, installd's pmstatus progress on the bar, then Return to Cydian. A jailbreak that
// can't install ad hoc apps (no_adhoc) ends with the console's red line and an alert saying what to install
// (AppSync Unified or ldid) or to sign the IPA. Each run is kept in Settings > Console Logs.
// The sideload build has none of this: it keeps signing.install (signing-client.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { modal } from "./queue.js";
import { runLogs } from "../queue.js";
import { ipaInstallAvailable, runIpaInstall } from "../ipa-install.js";
import { ipaUrl, ipaName, looksLikeIpa, IPA_FOOTER } from "../core/ipainstall.js";
import { apps, recordInstall } from "../core/installed.js";

const MAX_LINES = 1500;
let running = false;

// The console sheet for one IPA. Resolves the run's result once it has ended (the sheet stays up until Close or
// Return to Cydian). False when another IPA install's console is already up.
// N9: `native` stands in for the bridge (a shared file's share.ipaInstall, share.js).
export async function openIpaInstall({ url, name = "", onInstalled = () => {}, native = undefined }) {
  if (running) return false;
  running = true;
  const title = name || ipaName(url);
  const close = el("button", "bar-button", "Close");
  close.type = "button";
  close.hidden = true;
  const m = modal({ title: "Running", right: close, cls: "console" });
  m.scroll.className = "sheet-scroll console-scroll";
  const out = el("div", "console-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  const foot = el("div", "console-foot");
  const statusText = el("div", "console-status", "Preparing");
  const bar = el("div", "console-progress");
  const fill = el("div", "console-fill");
  bar.append(fill);
  foot.append(statusText, bar);
  m.scroll.append(out, foot);

  let pending = [];
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending.length) return;
    const frag = document.createDocumentFragment();
    for (const [type, text] of pending) frag.append(el("div", `console-line ${type}`, text));
    pending = [];
    out.append(frag);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    m.scroll.scrollTop = m.scroll.scrollHeight;
  };
  const view = {
    line(type, text) { pending.push([type, text]); if (!frame) frame = requestAnimationFrame(flush); },
    status(text) { statusText.textContent = text; },
    progress(pct) { fill.style.transform = `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`; },
  };

  const r = await runIpaInstall({ url, name: title }, view, native ? { native } : undefined);
  flush();
  m.setTitle("Complete");
  runLogs.add({ title: `Install ${title}`, jobs: [{ op: "install", id: r.bundleId || url, version: null, mode: "ipa" }],
    code: r.ok ? 0 : -1, text: r.log });
  if (r.ok) { try { onInstalled(r); } catch { /* the record is a nicety */ } }

  const done = () => { running = false; return m.close(); };
  const button = el("button", "console-finish", "Return to Cydian");
  button.type = "button";
  button.addEventListener("click", () => done());
  bar.replaceWith(button);
  close.hidden = false;
  close.addEventListener("click", () => done());
  if (r.error) await showAlert({ title: r.error.title, message: r.error.message, buttons: ["OK"] });
  return r;
}

// F88: an IPA installed from a URL or a link (no source page to say what it is): remembered by the bundle id the
// helper reports, so the Installed tab's Apps page and Changes follow it. No version: I4's real version (the
// jailbreak backend's installedApps) fills it in. An app already remembered (from its source's page, with its
// source) keeps that record. Resolves the record, or null (no bundle id, already remembered, no store).
export async function rememberIpa(r, name, { store = apps } = {}) {
  const id = r?.bundleId;
  if (!id) return null;
  try {
    const s = await store();
    if ((await s.all()).some((x) => x?.id === id)) return null;
    return await recordInstall(s, { id, name: String(name ?? "").replace(/\.ipa$/i, "") || id, version: "" });
  } catch { return null; }
}

// Settings > Install IPA's row: a URL typed or pasted. Asks again (with what was typed) when it isn't an http(s) link.
async function askIpaUrl(value = "") {
  for (;;) {
    const { index, value: typed } = await showAlert({
      title: "Install IPA",
      message: "The IPA's link (http or https). Cydian downloads it and installs it with the jailbreak.",
      input: { placeholder: "https://example.com/App.ipa", value, type: "url", paste: (t) => ipaUrl(t) ?? String(t ?? "").trim() },
      buttons: ["Cancel", "Install"], cancel: 0,
    });
    if (index !== 1) return false;
    const url = ipaUrl(typed);
    if (url) return openIpaInstall({ url, onInstalled: (r) => rememberIpa(r, ipaName(url)) });
    await showAlert({ title: "Not a Link", message: `"${String(typed ?? "").trim()}" isn't an http or https link to an IPA.`, buttons: ["OK"] });
    value = typed;
  }
}

// The Settings root's section (jailbreak build only; nothing elsewhere).
export function ipaSection(available = ipaInstallAvailable()) {
  if (!available) return document.createDocumentFragment();
  return grouped([{ header: "Install IPA", rows: [{ label: "Install from URL", onClick: () => askIpaUrl() }],
    footer: IPA_FOOTER }]);
}

// A tapped link to an .ipa (a depiction's, a news item's): Install IPA or open it as the link would.
export function initIpaLinks(root = document) {
  if (!ipaInstallAvailable()) return;
  root.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[href]");
    if (!a || e.defaultPrevented || !looksLikeIpa(a.href)) return;
    e.preventDefault();
    e.stopPropagation();
    const url = a.href;
    showActionSheet({ title: ipaName(url), buttons: ["Install IPA", "Open Link"] }).then((i) => {
      if (i === 0) openIpaInstall({ url, onInstalled: (r) => rememberIpa(r, ipaName(url)) });
      else if (i === 1) window.open(url, "_blank", "noopener");
    });
  }, true);
}
