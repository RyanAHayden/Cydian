// Settings tab (F13), iOS 6 Settings style: grouped tables, Appearance first. The rows come from core/settings.js
// (which ones this mode shows, defaults, storage); this file only draws them:
//   choice  one row per option, the chosen one checked (Appearance: Automatic / Light / Dark)
//   toggle  the iOS 6 switch (ios6.css .switch)
//   list    the current value as detail; pushes #/settings/<key>, a page of checked options
//   holds   the ignored packages' count; pushes #/settings/holds
// It also owns the theme: init() puts the Appearance setting on <html data-theme> and the theme-color metas, and
// follows the system while Appearance is Automatic. theme-boot.js does the same before first paint.
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";
import { createSettings, detectMode, themeFor, SETTINGS } from "../core/settings.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { parseProfile, checkP12Password, deviceSummary, deviceError, summary, profileKind } from "../core/signing.js";
import { sortCertFiles, findPassword } from "../core/certfiles.js";
import { logsSection, logsPage, logsTitle, LOGS } from "./queue.js";
import { loadIdentity, saveIdentity, clearIdentity, getServer, setServer, serverStatus,
  localSigning, deviceStatus, importToDevice, removeFromDevice, installOnDevice, statusReady, defaultServer,
  browserSigning, getBring, setBring, signAndInstall } from "../signing-client.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";
import { drawWalkthrough, walkOpen } from "./signing.js";
import { openInAppSection } from "./importlink.js";
import { signingExtras } from "./signed-apps.js";
import { syncReminder } from "../core/signing.js";
import { checkForUpdates, runInstall, fetchRelease, loadState, setSkip, installPath, isNewer, compareVersions } from "../core/selfupdate.js";
import { getArch } from "../backend.js";
import { ipaSection } from "./ipa-install.js";
import { otherLinksOn, setOtherLinks } from "../core/otherlinks.js";

export const title = "Settings";

// The one store the app uses (both modes and the site read it through here). In the jailbreak app the bridge's
// helper makes Ignored Upgrades real dpkg holds (F22); the bridge itself is N3's.
export const settings = createSettings({ mode: detectMode(), helper: globalThis.cydianNative?.helper, native: globalThis.cydianNative });

// Light: the top of the blue status bar under the nav bar; dark: "Status Bar (Black)".
export const THEME_COLORS = { light: "#4f698b", dark: "#5f656f" }; // dark: the gunmetal bar's top

const defOf = (key) => SETTINGS.find((d) => d.key === key);
const optionLabel = (d, v) => d.options.find((o) => o.value === v)?.label ?? String(v);

export function nav(route) {
  const key = route.path[0];
  if (key === "holds") return { title: "Ignored Upgrades" };
  if (key === "signing") return { title: "Signing" };
  if (key === LOGS) return { title: logsTitle(route.path[1]) }; // N4: Console Logs
  if (key && defOf(key)) return { title: defOf(key).label };
  return { title: "Settings" };
}

// Pages on screen, each with its route, so a change anywhere redraws them all (a list page's choice updates the
// root's detail). Pages popped off the stack are out of the DOM and get forgotten here.
const pages = new Set();
settings.onChange((key) => {
  // The switch already shows it, and keeps its slide; unless the value went back (F65: the helper refused it).
  if (defOf(key)?.kind === "toggle") return syncSwitches(key);
  for (const p of pages) {
    if (p.el.isConnected) draw(p);
    else pages.delete(p);
  }
});

export function render(el, route) {
  const p = { el, route };
  pages.add(p);
  draw(p);
  // Holds can change outside the app (another package manager, apt-mark by hand): ask dpkg each time Settings
  // opens a page; a change redraws through onChange. Without a helper this does nothing.
  settings.holds.sync().catch(() => {});
}

function draw({ el, route }) {
  const key = route.path[0];
  const top = el.scrollTop;
  if (key === "holds") el.replaceChildren(holdsPage());
  else if (key === "signing") drawSigning(el);
  else if (key === LOGS) el.replaceChildren(logsPage(route.path[1], () => draw({ el, route })));
  else if (key) el.replaceChildren(listPage(key));
  else el.replaceChildren(rootPage(), signingSection(), sideloadingSection(), openInAppSection(), ipaSection(), notifySection(), logsSection(detectMode()), aboutSection());
  el.scrollTop = top;
}

function rootPage() {
  const switches = [];
  const sections = settings.sections().map((s) => {
    const rows = [];
    for (const d of s.settings) {
      if (d.kind === "choice") {
        const v = settings.get(d.key);
        for (const o of d.options) rows.push({ label: o.label, checked: o.value === v, onClick: () => settings.set(d.key, o.value) });
      } else if (d.kind === "toggle") {
        switches.push([rows.length, d]);
        rows.push({ label: d.label });
      } else if (d.kind === "list") {
        rows.push({ label: d.label, detail: optionLabel(d, settings.get(d.key)), href: format({ tab: "settings", path: [d.key] }) });
      } else if (d.kind === "holds") {
        const n = settings.holds.list().length;
        rows.push({ label: d.label, detail: n ? String(n) : "None", href: format({ tab: "settings", path: ["holds"] }) });
      }
    }
    return { header: s.title, footer: s.footer, rows, id: s.id, switches: switches.splice(0) };
  });
  const frag = grouped(sections);
  // grouped() draws plain rows; the switches go into their cells afterwards.
  const groups = frag.querySelectorAll(".group");
  sections.forEach((s, i) => {
    const cells = groups[i].querySelectorAll(".cell-inner");
    for (const [row, d] of s.switches) {
      cells[row].append(makeSwitch(d));
      cells[row].classList.add("has-switch");
    }
  });
  return frag;
}

// A settings row's switch: createSwitch bound to the toggle setting `d`.
// F65: a toggle whose value changed under its switch (Upgrade Notifications when cydian-helper fails) shows it.
function syncSwitches(key) {
  const on = settings.get(key) === true;
  for (const p of pages) {
    for (const b of p.el.querySelectorAll?.(".switch[data-key]") ?? []) {
      if (b.dataset.key === key && (b.getAttribute("aria-checked") === "true") !== on) b.setAttribute("aria-checked", String(on));
    }
  }
}

function makeSwitch(d) {
  const b = createSwitch({
    label: d.label,
    checked: settings.get(d.key) === true,
    onToggle: (on) => { if ((settings.get(d.key) === true) !== on) settings.set(d.key, on); },
  });
  b.dataset.key = d.key;
  return b;
}

// The iOS 6 switch (ios6.css .switch), for settings rows (makeSwitch) and anything else (F24's Section
// Visibility): `checked` is where it starts, `onToggle(on)` hears every change.
export function createSwitch({ label, checked = false, onToggle = () => {} }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "switch";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-label", label);
  b.innerHTML = '<span class="sw-track"></span><span class="sw-knob"></span>';
  const TRAVEL = 50; // px the knob moves: 77px track, 25px knob 1px inside it (the kit's switch)
  const isOn = () => b.getAttribute("aria-checked") === "true";
  const set = (on) => {
    b.style.removeProperty("--x");
    const was = isOn();
    b.setAttribute("aria-checked", String(on));
    if (was !== on) onToggle(on);
  };
  b.setAttribute("aria-checked", String(Boolean(checked)));
  // Hold, drag and tap like iOS: the knob darkens while held and follows the finger; letting go settles it on the
  // side it's nearer, or flips it if it hardly moved. Keyboard and VoiceOver activation come through click.
  let drag = null;
  b.addEventListener("pointerdown", (e) => {
    const on = isOn();
    drag = { id: e.pointerId, x0: e.clientX, start: on ? TRAVEL : 0, x: on ? TRAVEL : 0, moved: false };
    b.setPointerCapture?.(e.pointerId);
    b.classList.add("is-held");
  });
  b.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    drag.x = Math.max(0, Math.min(TRAVEL, drag.start + dx));
    b.classList.add("is-dragging");
    b.style.setProperty("--x", drag.x + "px");
  });
  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, x, start } = drag;
    drag = null;
    b.classList.remove("is-held", "is-dragging");
    if (cancelled) { set(isOn()); return; }
    set(moved ? x > TRAVEL / 2 : start === 0);
    b.dataset.handled = "1"; // the click that follows this pointerup is already done
  };
  b.addEventListener("pointerup", (e) => end(e, false));
  b.addEventListener("pointercancel", (e) => end(e, true));
  b.addEventListener("click", () => {
    if (b.dataset.handled) { delete b.dataset.handled; return; }
    set(!isOn());
  });
  return b;
}

function listPage(key) {
  const d = defOf(key);
  if (!d || !settings.isShown(key) || d.kind !== "list") {
    return grouped([{ footer: "This setting is not available here." }]);
  }
  const v = settings.get(key);
  return grouped([{
    rows: d.options.map((o) => ({ label: o.label, subtitle: o.subtitle, checked: o.value === v, onClick: () => settings.set(key, o.value) })),
    footer: settings.footerOf(key),
  }]);
}

function holdsPage() {
  const held = settings.holds.list();
  if (!held.length) return grouped([{ footer: "No upgrades are ignored. Turn on Ignore Upgrades on a package's page." }]);
  return grouped([{
    header: "Ignored",
    rows: held.map((pkg) => ({ label: pkg, checked: true, onClick: () => settings.holds.set(pkg, false) })),
    footer: (settings.footerOf("holds") || "") + " Tap a package to take its upgrades again.",
  }]);
}

// ---- Theme ---------------------------------------------------------------------------------------------------

export function applyTheme(doc = document, win = window) {
  const dark = win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const appearance = settings.get("appearance");
  const theme = themeFor(appearance, dark);
  doc.documentElement.dataset.theme = theme;
  // Both metas keep their media query so the browser picks one before any script runs; a fixed choice paints
  // both with its own colour.
  // A fresh meta element, not a changed one: Safari doesn't always repaint its top bar when only `content` changes.
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own = m.media.includes("dark") ? "dark" : "light";
    const color = THEME_COLORS[appearance === "auto" ? own : theme];
    if (m.content === color) continue;
    const fresh = m.cloneNode();
    fresh.content = color;
    m.replaceWith(fresh);
  }
  tellShell(appearance, theme, win);
}

// The jailbreak/sideload shell (F23): native parts the page can't style (keyboard, <select> pickers, alerts,
// the window behind the web view) follow the theme through the bridge's app.theme. Automatic sends "auto" so the
// shell lets the system decide; pinning a style there would also pin prefers-color-scheme inside the web view and
// Automatic would stop following the system. On the site there is no handler and this does nothing.
export function themeMessage(appearance, theme) {
  return { id: 0, method: "app.theme", params: { style: appearance === "auto" ? "auto" : theme, theme } };
}
let lastSent = "";
function tellShell(appearance, theme, win) {
  const h = win.webkit?.messageHandlers?.cydian;
  if (!h) return;
  const msg = themeMessage(appearance, theme);
  const key = JSON.stringify(msg.params);
  if (key === lastSent) return;
  lastSent = key;
  try { Promise.resolve(h.postMessage(msg)).catch(() => {}); } catch { /* an older shell without app.theme */ }
}

// Zoom is off unless Settings > Allow Zoom is on. iOS Safari ignores user-scalable=no, so besides the viewport and
// touch-action (html.no-zoom in ios6.css) the pinch gesture itself is cancelled while zoom is off.
export function applyZoom(doc = document) {
  const allow = settings.get("allowZoom") === true || settings.get("allowZoom") === "true";
  doc.documentElement.classList.toggle("no-zoom", !allow);
  const vp = doc.querySelector('meta[name="viewport"]');
  if (vp) vp.content = "width=device-width, initial-scale=1, viewport-fit=cover" +
    (allow ? "" : ", maximum-scale=1, user-scalable=no");
  return allow;
}
function stopPinch(e) { if (document.documentElement.classList.contains("no-zoom")) e.preventDefault(); }

export function init() {
  applyTheme();
  applyZoom();
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, stopPinch, { passive: false });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
  settings.onChange((key) => {
    if (key === "appearance") applyTheme();
    if (key === "allowZoom") applyZoom();
    if (key === "resignReminder") remindNow();
  });
  remindNow(); // F68: on launch too, so the notification follows the setting (and any change the shell missed)
}

// F68: Re-sign Reminder to the shell (signing.remind {days}, F14), sideload build only.
function remindNow() {
  if (!localSigning() || !settings.isShown("resignReminder")) return;
  const n = globalThis.cydianNative;
  syncReminder((k) => settings.get(k), n?.call ? (m, p) => n.call(m, p) : null);
}

// ---- Signing (I5, F58) ---------------------------------------------------------------------------------------
// Settings > Signing, in the sideload build only: the user's .p12, its password and a .mobileprovision go into the
// Keychain, and the Signing Server hands iOS the manifests. F93: the website signs in the browser again (its page is
// at the end of this file), and the jailbreak app installs with its helper.

// The root page's row: the certificate's name once one is set.
function signingSection() {
  const box = document.createElement("div");
  if (localSigning()) return deviceSigningSection(box);
  if (browserSigning()) return siteSigningSection(box);
  return box;
}
// After a change on the Signing page: redraw every Settings page on screen (the root's Certificate row too).
function redrawAll() {
  for (const p of pages) {
    if (p.el.isConnected) draw(p);
    else pages.delete(p);
  }
}

const alertOK = (title, message) => showAlert({ title, message, buttons: ["OK"] });

// Everything picked at once: the .p12 and profile are checked and saved as if picked alone, then the password is
// found among any text files (or the empty password), unless the saved one already opens the certificate.
async function chooseFiles(el, files, slot) {
  const hide = showHUD("Reading");
  let found;
  try { found = await sortCertFiles(files); } catch { found = { p12: null, profile: null, passwords: [] }; }
  hide();
  // One file on a button that sorting didn't place: that button's file (its checks below say if it's wrong).
  if (slot && files.length === 1 && !found.p12 && !found.profile && !found.passwords.length) found[slot] = files[0];
  if (!found.p12 && !found.profile && !found.passwords.length) {
    await alertOK("No Certificate Files", "Choose your .p12, its .mobileprovision and (if you have one) a .txt with the password, or the .zip they came in.");
    return;
  }
  if (found.profile) await chooseProfile(el, found.profile, false);
  if (found.p12) await chooseP12(el, found.p12, false);
  const id = await loadIdentity();
  if (id?.p12 && !(id.password != null && await checkP12Password(id.p12, id.password) === true)) {
    const pw = await findPassword(id.p12, found.passwords);
    if (pw != null) await saveIdentity({ password: pw, passwordOk: true });
  }
  if (id?.p12) await recheckPassword(el, false);
  if (localSigning()) await importIfComplete(el, false);
  redrawAll();
}

// F83: Sideloading > Open Other Apps' Links (sideload build only, which claims the schemes; on by default). The
// footer says the limit: iOS fixed the schemes at install, so off can't hand a link back to the app it was for.
export const OTHER_LINKS_FOOTER = "Links for AltStore, SideStore, Feather, ESign, Scarlet and other sideloaders open in Cydian: "
  + "a source goes to Sources, an app to Install IPAs. iOS gives each kind of link to one app and Cydian can't change "
  + "which, so off doesn't give them back: Cydian opens the link again, which reaches the other app only where iOS "
  + "picked that app, and otherwise says the link was for another app.";
export function sideloadingSection(mode = detectMode()) {
  const box = document.createElement("div");
  if (mode !== "sideload") return box;
  const frag = grouped([{ header: "Sideloading", rows: [{ label: "Open Other Apps' Links" }], footer: OTHER_LINKS_FOOTER }]);
  const cell = frag.querySelector(".cell-inner");
  cell?.append(createSwitch({ label: "Open Other Apps' Links", checked: otherLinksOn(), onToggle: (on) => setOtherLinks(on) }));
  cell?.classList.add("has-switch");
  box.append(frag);
  return box;
}

async function chooseP12(el, f, redraw = true) {
  if (!f) return;
  if (f.bytes[0] !== 0x30 || f.bytes.length > 256 * 1024) {
    await alertOK("Not a Certificate", `${f.name} is not a .p12 file. Export your certificate and its key from Keychain as .p12.`);
    return;
  }
  await saveIdentity({ p12: f.bytes, p12Name: f.name.split("/").pop(), passwordOk: null });
  if (redraw) redrawAll();
}

async function chooseProfile(el, f, redraw = true) {
  if (!f) return;
  try {
    if (f.bytes.length > 1024 * 1024) throw new Error("too large");
    parseProfile(f.bytes);
  } catch {
    await alertOK("Not a Profile", `${f.name} is not a provisioning profile (.mobileprovision).`);
    return;
  }
  await saveIdentity({ profile: f.bytes, profileName: f.name.split("/").pop() });
  if (redraw) redrawAll();
}

// Whether the saved password opens the .p12; the result shows under the password field. `redraw` false while the
// field is being typed in (a redraw would take its focus).
async function recheckPassword(el, redraw = true) {
  const id = await loadIdentity();
  if (!id?.p12) return;
  const ok = await checkP12Password(id.p12, id.password ?? "");
  await saveIdentity({ passwordOk: ok });
  if (redraw) redrawAll();
  else {
    const foot = el.querySelector(".sign-files .group-footer");
    if (foot) foot.textContent = foot.textContent.replace(/ The password (doesn't open this certificate|opens it)\.$/, "")
      + (ok === false ? " The password doesn't open this certificate." : ok ? " The password opens it." : "");
  }
}

async function askServer(el) {
  const { index, value } = await showAlert({ title: "Signing Server", message: `Hands iOS the install manifests. Empty for ${new URL(defaultServer()).host}.`,
    input: { type: "url", placeholder: defaultServer(), value: getServer() === defaultServer() ? "" : getServer() }, buttons: ["Cancel", "Save"], cancel: 0 });
  if (index !== 1) return;
  setServer(value.trim() || defaultServer());
  redrawAll();
}

const RUN_YOUR_OWN = "https://github.com/RyanAHayden/Cydian/tree/main/worker#host-your-own-free-about-a-minute";

async function checkServer() {
  const hide = showHUD("Checking");
  try {
    const st = await serverStatus();
    hide();
    const host = new URL(getServer()).host;
    // The app needs only manifests and the update hand-off (worker/ answers worker: true).
    if (st?.worker || st?.ok) await alertOK("Server Works", `${host} hands iOS the install manifests and holds Cydian's own updates. Signing happens on this iPhone.`);
    else await alertOK("Server Not Ready", `${host} answers but isn't a Signing Server.`);
  } catch (e) {
    hide();
    await alertOK("Server Not Reachable", `${new URL(getServer()).host}: ${e.message || "no answer"}.`);
  }
}

async function drawSigning(el) {
  if (localSigning()) return drawDeviceSigning(el);
  if (browserSigning()) return drawSiteSigning(el);
  el.replaceChildren(grouped([{ footer: "Apps are signed in the Cydian app, on the iPhone itself, with your own certificate." }]));
}

// The certificate, its profile and its password: one group of rows, each with its name on the left, its value in the
// middle and a Browse button on the right (a <label> over a hidden file input, so iOS opens its picker straight from
// the tap). F75: above them the big Select All Files button, the same multi-select picker: one pick of the .p12, the
// .mobileprovision and the password file (or their .zip) fills whatever is missing (core/certfiles.js sorts them and
// finds the password). Any row's Browse takes several files too.
function certificateBlock(el, id, status = null) {
  const kept = statusReady(status) ? status.identity : null; // F58: what the sideload build's Keychain holds
  const box = document.createElement("div");
  box.className = "group sign-files"; // a .group, like every grouped section: its 10px side margins
  const head = Object.assign(document.createElement("h3"), { className: "group-header", textContent: "Certificate" });
  const ul = document.createElement("ul");
  ul.className = "table grouped";
  const accept = ".p12,.pfx,.mobileprovision,.txt,.zip,application/x-pkcs12,application/zip,text/plain";
  const fileRow = (name, value, slot) => {
    const shown = Object.assign(document.createElement("span"), { className: "sign-value" + (value ? "" : " is-empty"), textContent: value || "None" });
    return signRow(name, shown, browseButton(accept, true, (files) => chooseFiles(el, files, slot)));
  };

  const input = Object.assign(document.createElement("input"), { type: "password", className: "sign-value",
    placeholder: kept && !id?.p12 ? "Not Kept" : "None", value: id?.password ?? "" });
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  let timer = 0;
  // F58: in the sideload build a password that opens the .p12 (or, where it can't be checked here, a finished
  // entry) sends all three to the Keychain.
  const save = async (done = false) => {
    clearTimeout(timer);
    await saveIdentity({ password: input.value });
    await recheckPassword(el, false);
    if (localSigning()) {
      const now = await loadIdentity();
      if (now?.passwordOk === true || (done && now?.passwordOk !== false)) await importIfComplete(el, true);
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(save, 500); });
  input.addEventListener("change", () => save(true));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  // Browse here reads the password from a .txt (its first line).
  const pwBrowse = browseButton(".txt,text/plain", false, async ([f]) => {
    if (!f || f.bytes.length > 4096) return;
    input.value = new TextDecoder().decode(f.bytes).split(/\r?\n/)[0];
    await save(true);
  });

  // F69: in the sideload build a name stays on the row only while its file is picked (in memory) or the Keychain
  // holds the identity (statusReady), never as a leftover of an import the signer can't see.
  const p12Shown = !status || id?.p12 ? id?.p12Name ?? (kept ? "In Keychain" : null) : kept ? id?.p12Name ?? "In Keychain" : null;
  const profShown = !status || id?.profile ? id?.profileName ?? kept?.profile?.name : kept ? id?.profileName ?? kept.profile?.name : null;
  ul.append(fileRow(".p12", p12Shown, "p12"),
    fileRow(".mobileprovision", profShown, "profile"), signRow("Password", input, pwBrowse));
  const state = id?.p12 && id?.password != null ? (id.passwordOk === false ? " The password doesn't open this certificate." : id.passwordOk ? " The password opens it." : "") : "";
  const kind = browserSigning() ? "They're kept in this browser only, and apps are signed here in the browser: they go to no server, except inside Cydian's own app with Bring My Certificate."
    : "Once all three are here, they go into this iPhone's Keychain, where only Cydian can use them; the password isn't kept. To change one, choose the .p12 and the profile again.";
  const foot = Object.assign(document.createElement("p"), { className: "group-footer",
    textContent: "Your .p12 (the certificate and its key), its .mobileprovision and the password. Each row's Browse picks one. " + kind + state });
  const [allInput, allLabel] = browseButton(accept, true, (files) => chooseFiles(el, files, null));
  allLabel.className = "walk-action sign-all";
  allLabel.textContent = "Select All Files";
  box.append(head, allInput, allLabel, ul, foot);
  return box;
}

function signRow(name, value, button) {
  const li = document.createElement("li");
  li.className = "cell";
  const row = document.createElement(value.tagName === "INPUT" ? "label" : "div");
  row.className = "cell-inner sign-row";
  row.append(Object.assign(document.createElement("span"), { className: "cell-label", textContent: name }), value);
  li.append(row, ...button);
  return li;
}

// [hidden file input, its Browse label]; onFiles gets [{ name, bytes }].
function browseButton(accept, multiple, onFiles) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple, className: "visually-hidden" });
  input.id = "f" + Math.random().toString(36).slice(2);
  const label = Object.assign(document.createElement("label"), { className: "bar-button sign-browse", textContent: "Browse" });
  label.htmlFor = input.id;
  input.addEventListener("change", async () => {
    const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    input.value = "";
    if (files.length) onFiles(files);
  });
  return [input, label];
}

// ---- Signing on the phone (F58) ------------------------------------------------------------------------------
// The sideload build: the same Certificate rows, but the picks wait in memory (signing-client.js) until the .p12, the
// profile and a password are there, then go to the Keychain through signing.import (I6, docs/signing.md "On the
// phone"). What the page shows comes from signing.status: the identity, its profile and their problem. F75: and the
// Signing Server, which hands iOS the manifest for the IPA Cydian serves at 127.0.0.1 (the certificate never leaves
// the phone; the server sees the app's ID, version and name).

function deviceSigningSection(box) {
  // F68: Re-sign Reminder's group just above already says Signing
  const header = settings.isShown("resignReminder") ? undefined : "Signing";
  const fill = (detail) => box.replaceChildren(grouped([{ header,
    rows: [{ label: "Certificate", detail, href: format({ tab: "settings", path: ["signing"] }) }],
    footer: "Your own certificate: Install signs AltStore apps with it on this iPhone." }]));
  fill("");
  Promise.all([deviceStatus().catch(() => null), loadIdentity()]).then(([st, id]) => {
    // F69: statusReady, the rule Install goes by: the row names a certificate only when Install will use it
    fill(statusReady(st) ? (st.identity.name || "In Keychain") : id?.p12 || id?.profile ? "Incomplete" : "None");
  });
  return box;
}

// The staged .p12, profile and password into the Keychain, once all are there and the password isn't known to be
// wrong. True when imported. `typing`: the password field has focus, so a wrong password only updates its footer.
async function importIfComplete(el, typing) {
  const id = await loadIdentity();
  if (!id?.p12 || !id?.profile || id.password == null || id.passwordOk === false) return false;
  const hide = showHUD("Importing");
  let after;
  try {
    after = await importToDevice(id);
  } catch (e) {
    hide();
    if (e?.code === "wrong_password") {
      await saveIdentity({ passwordOk: false });
      if (typing) {
        const foot = el.querySelector(".sign-files .group-footer");
        if (foot && !/doesn't open/.test(foot.textContent)) foot.textContent += " The password doesn't open this certificate.";
      } else redrawAll();
      return false;
    }
    await alertOK("Couldn't Import", deviceError(e).message);
    return false;
  }
  hide();
  // F69: the status the import answers must show the identity, as Install will look for it; if it doesn't, say why
  // instead of leaving the names on the rows as if it worked.
  if (after && !statusReady(after)) {
    await clearIdentity();
    await alertOK("Couldn't Import", after.identityProblem || "The certificate went into the Keychain but Cydian can't find it there. Remove it and import it again.");
    redrawAll();
    return false;
  }
  // In the Keychain now: only the names stay in memory, for the rows.
  await clearIdentity();
  await saveIdentity({ p12Name: id.p12Name, profileName: id.profileName });
  redrawAll();
  return true;
}

async function removeDeviceCertificate() {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The certificate, its key and the profile are deleted from this iPhone's Keychain.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  try { await removeFromDevice(); } catch (e) { await alertOK("Couldn't Remove", deviceError(e).message); }
  await clearIdentity();
  redrawAll();
}

// Back in Cydian (from Safari or the Files app): redraw, and while the Signing page is open look at signing.status
// every 2 s, so the walkthrough ticks the moment a certificate lands (the launch import of one that came inside the
// app, an import finished elsewhere). The app's web view doesn't always send visibilitychange, so focus and
// pageshow count too.
let watchingReturn = false;
function watchReturn() {
  if (watchingReturn || typeof document === "undefined") return;
  watchingReturn = true;
  const again = () => { if (document.visibilityState !== "hidden") redrawAll(); };
  document.addEventListener("visibilitychange", again);
  addEventListener("focus", again);
  addEventListener("pageshow", again);
  let last = null;
  setInterval(async () => {
    if (document.visibilityState === "hidden" || !document.querySelector(".page.is-top .walkthrough")) return;
    let st = null;
    try { st = await deviceStatus(); } catch { return; }
    const now = String(statusReady(st));
    if (last !== null && now !== last) redrawAll();
    last = now;
  }, 2000);
}

// F69, F75: the page is the walkthrough (screens/signing.js): the certificate (Select All Files, the rows), then
// the Signing Server. The Keychain's details and Remove Certificate go under the steps.
// walkOpen keeps the user's expand/collapse taps across redraws (and Install's redirect sets it: openAt).
async function drawDeviceSigning(el) {
  watchReturn();
  const id = await loadIdentity();
  let status = null, failure = null;
  try { status = await deviceStatus(); } catch (e) { failure = e; }
  const kept = statusReady(status) ? status.identity : null;
  const sections = [];
  if (kept) {
    const info = deviceSummary(kept);
    sections.push({ header: "In This iPhone's Keychain",
      rows: info.rows.map((r) => (r.detail.length > 16 ? { label: r.label, subtitle: r.detail } : r)),
      footer: info.problems.length ? info.problems.join(" ") : null });
  }
  if (kept || id?.p12 || id?.profile) sections.push({ rows: [{ label: "Remove Certificate", onClick: () => removeDeviceCertificate() }] });
  const server = getServer();
  const serverRows = grouped([{ rows: [
    { label: new URL(server).host, subtitle: server === defaultServer() ? "Default" : server, onClick: () => askServer(el), chevron: true },
    { label: "Check Server", onClick: () => checkServer() },
    // Nothing depends on cydian.dev: anyone can run their own, free (worker/README.md's Deploy to Cloudflare).
    { label: "Run Your Own", subtitle: "Free on Cloudflare, about a minute", chevron: true,
      onClick: () => window.open(RUN_YOUR_OWN, "_blank", "noopener") }] }]);
  drawWalkthrough(el, {
    status, failure: failure ? deviceError(failure).message : "",
    certificate: certificateBlock(el, id, status ?? { identity: null }),
    server: serverRows, serverUrl: server,
    open: walkOpen,
    extra: [...(sections.length ? [grouped(sections)] : []), signingExtras({ identity: kept, redraw: redrawAll })],
  });
}

// ---- About and updates (F61) ---------------------------------------------------------------------------------
// The app only (sideload and jailbreak builds): Settings > About shows the app's version, Check for Updates and,
// once a newer release is known, Skip This Version. core/selfupdate.js does the work; this binds it to the bridge,
// the signer, the alerts and the HUD. app.js runs the automatic check at launch (checkUpdates()).

const appVersion = () => globalThis.cydianNative?.call
  ? globalThis.cydianNative.call("app.info", {}).then((i) => String(i?.version ?? ""))
  : Promise.resolve("");

// A HUD whose label can change (Downloading, then Installing): { set(text), hide() }.
function updateHUD(text) {
  const hide = showHUD(text);
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  return { set: (t) => { if (label) label.textContent = t; }, hide };
}

let checking = null;
// The automatic launch check, or Check for Updates (manual, with a Checking HUD until the first alert). One at a time.
export function checkUpdates({ manual = false, always = false } = {}) {
  if (checking) return checking;
  const mode = detectMode();
  if (!installPath(mode)) return Promise.resolve("site");
  const native = globalThis.cydianNative;
  const go = (path) => { location.hash = format({ tab: "settings", path }).replace(/^#/, ""); };
  const hide = manual ? showHUD("Checking") : () => {};
  const alert = (spec) => { hide(); return showAlert(spec); };
  checking = checkForUpdates({
    mode, storage: globalThis.localStorage,
    current: appVersion,
    release: () => fetchRelease({ native }),
    alert,
    install: (release) => runInstall(release, mode, {
      status: () => deviceStatus(), installOnDevice: (o) => installOnDevice(o), alert, go,
      installSelf: (row) => import("../essential-ui.js").then((m) => m.installSelfNow(row)), // F72
      native, arch: getArch(), hud: updateHUD,
    }),
  }, { manual, always }).catch(() => "error").finally(() => { hide(); checking = null; redrawAll(); });
  return checking;
}

// The sideload app: what iOS lets Cydian do for update alerts (badges, notifications, Background App Refresh) and
// when the background check last ran. A "no" given once can only be changed in iOS Settings: the row opens it.
export function notifyRows(st, now = Date.now()) {
  if (!st) return null;
  const onOff = (v) => (v ? "On" : "Off");
  const ago = (iso) => {
    const t = Date.parse(iso ?? "");
    if (Number.isNaN(t)) return "Not yet";
    const m = Math.round((now - t) / 60000);
    return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const off = st.backgroundOn !== false && (!st.badges || !st.alerts || !st.backgroundRefresh);
  return { header: "Update Alerts", rows: [
    // switch rows (our iOS 6 switch, notifySection): ours to flip, or iOS's (flipping opens its Settings)
    { label: "Check in the Background", detail: onOff(st.backgroundOn !== false), on: st.backgroundOn !== false, toggle: "ours" },
    { label: "Icon Badge", detail: onOff(st.badges), on: Boolean(st.badges), toggle: "ios" },
    { label: "Notifications", detail: onOff(st.alerts), on: Boolean(st.alerts), toggle: "ios" },
    { label: "Background App Refresh", detail: onOff(st.backgroundRefresh), on: Boolean(st.backgroundRefresh), toggle: "ios" },
    { label: "Last Background Check", detail: ago(st.lastCheck) },
    ...(off ? [{ label: "Turn On in Settings", chevron: true, open: true }] : [])],
    footer: off ? "iOS asks only once: anything left off is turned on in Settings > Notifications > Cydian, and Settings > General > Background App Refresh."
      : "iOS decides when the background check runs, usually every few hours. It badges every update and notifies only about new ones." };
}
function notifySection() {
  const box = document.createElement("div");
  const n = globalThis.cydianNative;
  if (detectMode() !== "sideload" || !n?.call) return box;
  Promise.resolve(n.call("app.notifyStatus", {})).then((st) => {
    const g = notifyRows(st);
    if (!g) return;
    const openIOS = () => {
      n.call("app.openSettings", {});
      // back from iOS Settings: show what was changed there
      const back = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", back); box.replaceWith(notifySection()); };
      document.addEventListener("visibilitychange", back);
    };
    const switches = g.rows.map((r) => r.toggle);
    g.rows = g.rows.map((r) => (r.open ? { label: r.label, chevron: true, onClick: openIOS }
      : r.toggle ? { label: r.label } : r));
    const frag = grouped([g]);
    // Our iOS 6 switch in each switch row, in place of an On/Off text.
    frag.querySelectorAll(".cell").forEach((li, i) => {
      const kind = switches[i];
      if (!kind) return;
      const r = notifyRows(st).rows[i];
      const sw = createSwitch({ label: r.label, checked: r.on, onToggle: (on) => {
        if (kind === "ours") Promise.resolve(n.call("updates.background", { on })).then(() => box.replaceWith(notifySection()), () => {});
        else openIOS();
      } });
      li.querySelector(".cell-inner").append(sw);
      li.querySelector(".cell-inner").classList.add("has-switch");
    });
    box.replaceChildren(frag);
  }, () => {});
  return box;
}

function aboutSection() {
  const box = document.createElement("div");
  if (!installPath(detectMode())) return box;
  const fill = (version) => {
    const st = loadState(globalThis.localStorage);
    const latest = st.latest?.version;
    const rows = [{ label: "Version", detail: version || "Unknown" },
      { label: "Check for Updates", onClick: () => checkUpdates({ manual: true }) }];
    let footer = latest && version && !isNewer(latest, version) ? "Cydian is up to date." : "Cydian looks for a new version on GitHub once a day.";
    if (latest && isNewer(latest, version)) {
      const skipped = st.skip && compareVersions(st.skip, latest) === 0;
      rows.push({ label: "Skip This Version", subtitle: `Cydian ${latest}`, checked: skipped,
        onClick: () => { setSkip(globalThis.localStorage, skipped ? null : latest); redrawAll(); } });
      footer = skipped ? `Cydian won't ask about ${latest} again. Check for Updates still offers it.`
        : `Cydian ${latest} is available. Check for Updates installs it.`;
    }
    box.replaceChildren(grouped([{ header: "About", rows, footer }]));
  };
  fill(loadState(globalThis.localStorage).current ?? "");
  appVersion().then(fill, () => {});
  return box;
}

// ---- Signing on the website (F93, as before F89) --------------------------------------------------------------
// The .p12, its password and the .mobileprovision in this browser's IndexedDB (signing-client.js); Install on an app
// page and Home's Install Cydian App sign in the browser with them (zsign as WebAssembly, signing-worker.js) and the
// Worker only hosts the signed IPA for iOS's install prompt.

function siteSigningSection(box) {
  const fill = (detail) => box.replaceChildren(grouped([{ header: "Signing",
    rows: [{ label: "Certificate", detail, href: format({ tab: "settings", path: ["signing"] }) }],
    footer: "Your own certificate: Install signs apps with it, here in the browser." }]));
  fill("");
  loadIdentity().then((id) => {
    let name = "None";
    if (id?.profile) {
      try { name = summary({ profile: parseProfile(id.profile) }).rows[0].detail; } catch { name = "Unreadable"; }
    } else if (id?.p12) name = "Incomplete";
    fill(name);
  });
  return box;
}

// Install Cydian App, green, once the certificate works, with Bring My Certificate under it.
const installApp = () => signAndInstall({ url: APP_IPA_URL, name: APP_NAME, bring: getBring() });
function siteAppSection(id) {
  if (!(id?.p12 && id?.profile && id.passwordOk !== false)) return [];
  const frag = grouped([{ rows: [{ label: "Install Cydian App", onClick: installApp, icon: { text: "" } }],
    footer: "Cydian as an app on your Home Screen, signed here with this certificate: it signs apps on the iPhone itself." }]);
  frag.firstChild.classList.add("app-offer");
  frag.querySelector(".cell-icon")?.classList.add("home-glyph", "glyph-install");
  const bring = grouped([{ rows: [{ label: "Bring My Certificate" }],
    footer: "Install Cydian App puts a copy of your certificate inside the app, so Cydian has it on first launch. "
      + "The copy sits in the app's own files until the next update, and in the signed app the server holds for iOS's 10 minutes." }]);
  const cell = bring.querySelector(".cell-inner");
  cell?.append(createSwitch({ label: "Bring my certificate into the app", checked: getBring(), onToggle: (on) => setBring(on) }));
  cell?.classList.add("has-switch");
  return [frag, bring];
}

async function removeSiteCertificate() {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The .p12, its password and the profile are deleted from this browser.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  await clearIdentity();
  redrawAll();
}

async function drawSiteSigning(el) {
  const id = await loadIdentity();
  const top = el.scrollTop;
  let profile = null;
  try { profile = id?.profile ? parseProfile(id.profile) : null; } catch { /* checked when picked */ }
  const info = summary({ profile, passwordOk: id?.passwordOk ?? null });
  const sections = [];
  if (profile) {
    sections.push({ header: profile.name ? `${profileKind(profile)} Profile: ${profile.name}` : `${profileKind(profile)} Profile`,
      // Long values (a certificate's name, a team) go under the label, where they wrap, not cut off on the right.
      rows: info.rows.map((r) => (r.detail.length > 16 ? { label: r.label, subtitle: r.detail } : r)),
      footer: info.problems.length ? info.problems.join(" ") : null });
  }
  sections.push({ header: "How It Works",
    footer: "Install downloads the app, signs it in this browser with your certificate, and leaves the signed app on "
      + `${location.host} for 10 minutes so iOS can install it. Your certificate, key and password stay in this browser.` });
  if (id?.p12 || id?.profile) sections.push({ rows: [{ label: "Remove Certificate", onClick: () => removeSiteCertificate() }] });
  el.replaceChildren(certificateBlock(el, id), ...siteAppSection(id), grouped(sections));
  el.scrollTop = top;
}
