// F67: Install IPA in the jailbreak build (ipa-install.js runs it over F59's ipa.install; core/ipainstall.js has the
// words). Three ways in:
//   - Settings > Install IPA > Install from URL: an alert with a URL field and Paste (askIpaUrl)
//   - an AltStore app's Install row (screens/altstore.js installRows, jailbreak only): the app's own IPA
//   - a tapped link to an .ipa anywhere in the app (depictions, news): an action sheet offers Install IPA
//     (initIpaLinks, app.js)
// F88: a successful install is remembered (core/installed.js) for the Installed tab's Apps page and Changes: the
// AltStore row's with its source (installRows' onInstall), a URL's or link's by bundle id (rememberIpa).
// All open the same progress page as the install queue's (F151: nav/progress.js): the shell's and helper's lines as
// they come, installd's pmstatus progress on the bar, then Reload Data (uicache) or Return to iFizBox. A jailbreak that
// can't install ad hoc apps (no_adhoc) ends with the console's red line and an alert saying what to install
// (AppSync Unified or ldid) or to sign the IPA. Each run is kept in Settings > Console Logs.
// The sideload build has none of this: it keeps signing.install (signing-client.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { openProgress } from "../nav/progress.js";
import { chooseFinish } from "../core/progress.js";
import { getBackend } from "../backend.js";
import { runLogs } from "../queue.js";
import { ipaInstallAvailable, runIpaInstall } from "../ipa-install.js";
import { ipaUrl, ipaName, looksLikeIpa, IPA_FOOTER } from "../core/ipainstall.js";
import { apps, recordInstall } from "../core/installed.js";
import { NAME } from "../brand.js";

let running = false;

// The console page for one IPA (F151: nav/progress.js, as the queue's). Resolves the run's result once it has ended
// (the page stays up until Close or the finish button). False when another IPA install's console is already up.
// N9: `native` stands in for the bridge (a shared file's share.ipaInstall, share.js). An app went in, so the button
// is Reload Data (uicache, as Cydia runs after a run) when the backend can, else Return to iFizBox.
export async function openIpaInstall({ url, name = "", onInstalled = () => {}, native = undefined }) {
  if (running) return false;
  running = true;
  const title = name || ipaName(url);
  const page = openProgress();
  page.onClose(() => { running = false; });
  // F188: Cancel at the top right from the first line to the end (Done once it has ended): it stops the run and the
  // page closes, back where Install was tapped.
  const ctl = new AbortController();
  page.stoppable?.(() => { ctl.abort(); stopIpaInstall(native); });
  const view = {
    line(type, text) { page.line(type === "status" ? "step" : type === "info" ? "raw" : type, text); },
    status(text) { page.status(text); },
    progress(pct) { page.progress(pct); },
  };

  const r = await runIpaInstall({ url, name: title }, view, { ...(native ? { native } : {}), signal: ctl.signal });
  runLogs.add({ title: `Install ${title}`, jobs: [{ op: "install", id: r.bundleId || url, version: null, mode: "ipa" }],
    code: r.ok ? 0 : -1, text: r.log });
  if (r.cancelled) return r;
  if (r.ok) { try { onInstalled(r); } catch { /* the record is a nicety */ } }

  const backend = getBackend();
  const reload = r.ok && typeof backend?.uicache === "function";
  const choice = chooseFinish({ ok: reload, kinds: ["app"] });
  page.finish({ label: choice.label, status: r.ok ? "Done" : "Failed", action: reload ? async () => {
    try { await backend.uicache(); } catch (e) {
      await showAlert({ title: "Reload Data", message: e.message || String(e), buttons: ["OK"] });
      return true;
    }
    return false;
  } : null });
  if (r.error) await showAlert({ title: r.error.title, message: r.error.message, buttons: ["OK"] });
  return r;
}

// F196: asks the shell to stop ipa.install (its download, or the helper before it starts: Apt.swift ipa.cancel).
// The page has already ended the run; the answer is ignored (a refusal once the helper runs, a shell without the
// call). Not for share.js's stand-in (`native`): it sends every call to share.ipaInstall, a staged file with no
// download to stop. True when ipa.cancel was asked for.
export function stopIpaInstall(native = undefined, { bridge = globalThis.ifizboxNative } = {}) {
  if (native !== undefined || typeof bridge?.call !== "function") return false;
  try { Promise.resolve(bridge.call("ipa.cancel", {})).catch(() => {}); } catch { return false; }
  return true;
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
      message: `The IPA's link (http or https). ${NAME} downloads it and installs it with the jailbreak.`,
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
