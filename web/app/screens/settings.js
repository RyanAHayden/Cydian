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
import { drawSection as drawPushSection } from "../push-client.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { parseProfile, checkP12Password, summary, profileKind, DEFAULT_SERVER } from "../core/signing.js";
import { sortCertFiles, findPassword } from "../core/certfiles.js";
import { logsSection, logsPage, logsTitle, LOGS } from "./queue.js";
import { loadIdentity, saveIdentity, clearIdentity, signingAvailable, getServer, setServer, serverStatus } from "../signing-client.js";

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
  if (defOf(key)?.kind === "toggle") return; // the switch already shows it, and keeps its slide
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
  else el.replaceChildren(rootPage(), signingSection(), pushSection(), logsSection(detectMode()));
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

// Upgrade Alerts (F10, push-client.js): the site only; the app's alerts are native.
function pushSection() {
  const box = document.createElement("div");
  if (detectMode() === "site") {
    drawPushSection(box, { grouped, createSwitch, showAlert, showHUD, holds: () => settings.holds.list() });
  }
  return box;
}

// A settings row's switch: createSwitch bound to the toggle setting `d`.
function makeSwitch(d) {
  return createSwitch({
    label: d.label,
    checked: settings.get(d.key) === true,
    onToggle: (on) => { if ((settings.get(d.key) === true) !== on) settings.set(d.key, on); },
  });
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
  });
}

// ---- Signing (I5) --------------------------------------------------------------------------------------------
// Settings > Signing: the user's .p12, its password and a .mobileprovision, kept in IndexedDB on this phone only
// (signing-client.js), and the signing server. With them, Install on an AltStore app's page signs the app with
// this certificate and installs it (browse.js packageActions). The site only: the jailbreak app has no need, and
// the sideload build signs on the phone itself (F14, I6).

// The root page's row: the certificate's name once one is set.
function signingSection() {
  const box = document.createElement("div");
  if (!signingAvailable()) return box;
  const fill = (detail) => box.replaceChildren(grouped([{ header: "Signing",
    rows: [{ label: "Certificate", detail, href: format({ tab: "settings", path: ["signing"] }) }],
    footer: "Your own certificate: Install signs AltStore apps with it." }]));
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
  if (files.length === 1 && !found.p12 && !found.profile && !found.passwords.length) found[slot] = files[0];
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
  redrawAll();
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
  const { index, value } = await showAlert({ title: "Signing Server", message: `Where apps are signed. Empty for ${new URL(DEFAULT_SERVER).host}.`,
    input: { type: "url", placeholder: DEFAULT_SERVER, value: getServer() === DEFAULT_SERVER ? "" : getServer() }, buttons: ["Cancel", "Save"], cancel: 0 });
  if (index !== 1) return;
  setServer(value.trim() || DEFAULT_SERVER);
  redrawAll();
}

async function checkServer() {
  const hide = showHUD("Checking");
  try {
    const st = await serverStatus();
    hide();
    await alertOK(st.zsign ? "Server Signs Apps" : "Server Can't Sign",
      st.zsign ? `${new URL(getServer()).host} signs IPAs up to ${Math.round(st.maxBytes / 1048576)} MB and keeps each signed app for ${Math.round(st.ttl / 60)} minutes.`
        : `${new URL(getServer()).host} answers but has no signer (zsign) installed.`);
  } catch (e) {
    hide();
    await alertOK("Server Not Reachable", `${new URL(getServer()).host}: ${e.message || "no answer"}.`);
  }
}

async function removeCertificate(el) {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The .p12, its password and the profile are deleted from this iPhone.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  await clearIdentity();
  redrawAll();
}

async function drawSigning(el) {
  const id = await loadIdentity();
  if (!signingAvailable()) {
    el.replaceChildren(grouped([{ footer: "Signing with your own certificate is on the website. This app signs on the iPhone itself." }]));
    return;
  }
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
  const server = getServer();
  sections.push({
    header: "Signing Server",
    rows: [{ label: new URL(server).host, subtitle: server === DEFAULT_SERVER ? "Default" : server, onClick: () => askServer(el), chevron: true },
      { label: "Check Server", onClick: () => checkServer() }],
    footer: "Install sends the app's link, the certificate, its password and the profile to this server over HTTPS. "
      + "The server uses them in memory for that one request and never writes them to disk or logs; the signed app is deleted after 10 minutes. "
      + "Run your own with docker compose up (docs/signing.md) and put its address here.",
  });
  if (id?.p12 || id?.profile) sections.push({ rows: [{ label: "Remove Certificate", onClick: () => removeCertificate(el) }] });
  el.replaceChildren(certificateBlock(el, id), grouped(sections));
  el.scrollTop = top;
}

// The certificate, its profile and its password: one group of rows, each with its name on the left, its value in the
// middle and a Browse button on the right (a <label> over a hidden file input, so iOS opens its picker straight from
// the tap). Any Browse takes several files at once, or the .zip they came in: each goes where it belongs and the
// password is found if a text file holds it (core/certfiles.js), so one pick can fill all three.
function certificateBlock(el, id) {
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

  const input = Object.assign(document.createElement("input"), { type: "password", className: "sign-value", placeholder: "None", value: id?.password ?? "" });
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  let timer = 0;
  const save = async () => { clearTimeout(timer); await saveIdentity({ password: input.value }); await recheckPassword(el, false); };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(save, 500); });
  input.addEventListener("change", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  // Browse here reads the password from a .txt (its first line).
  const pwBrowse = browseButton(".txt,text/plain", false, async ([f]) => {
    if (!f || f.bytes.length > 4096) return;
    input.value = new TextDecoder().decode(f.bytes).split(/\r?\n/)[0];
    await save();
  });

  ul.append(fileRow(".p12", id?.p12Name, "p12"), fileRow(".mobileprovision", id?.profileName, "profile"), signRow("Password", input, pwBrowse));
  const state = id?.p12 && id?.password != null ? (id.passwordOk === false ? " The password doesn't open this certificate." : id.passwordOk ? " The password opens it." : "") : "";
  const foot = Object.assign(document.createElement("p"), { className: "group-footer",
    textContent: "Your .p12 (the certificate and its key), its .mobileprovision and the password. Browse can take all of them at once, or their .zip. They're kept on this iPhone only, in this browser's storage." + state });
  box.append(head, ul, foot);
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
