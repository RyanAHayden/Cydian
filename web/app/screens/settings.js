// Settings (F13; at the bottom of Home since F123), laid out like iOS 6's Settings app (F128, docs/settings.md):
// the root is one list of short rows (iFizBox Account; General, Theme, Updates; Signing; Console Logs), each
// opening its own page. The settings' rows come from core/settings.js (which ones this mode shows, defaults,
// storage, which page they're on); this file only draws them:
//   choice  one row per option, the chosen one checked
//   segmented  an iOS 6 segmented control under the group's header (F199: Theme > Mode: Automatic / Light / Dark)
//   toggle  the iOS 6 switch (ios6.css .switch)
//   list    the current value as detail; pushes <page>/<key>, a page of checked options
//   holds   the ignored packages' count; pushes <page>/holds
// F205: rows carry iOS 6 Settings' 29pt tiles (icons/rowicons.js): every root row, and each setting that names a
// thing (SETTING_ICONS); Appearance's choices and plain values stay bare, as iOS 6 leaves them.
// Routes below Settings: <page> (general, theme, updates; "display", Theme's old id, still opens Theme), <page>/<key>, signing[/<key>], account,
// logs[/<id>], and the older <key> and holds, which links from elsewhere use. F183: the root ends with Home's
// version line (version-foot.js); there is no About page and no manual update check (every launch and Reload checks).
// It also owns the theme: init() puts the Appearance setting on <html data-theme> and the theme-color metas, and
// follows the system while Appearance is Automatic. theme-boot.js does the same before first paint.
import { grouped } from "../nav/ui.js";
import { format, parse, settingsRoute } from "../router.js";
import { createSettings, detectMode, themeState, paletteFor, DARK_THEME_KEY, SETTINGS, SIGNING_GROUPS } from "../core/settings.js";
import { segmented } from "./storepage.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { parseProfile, checkP12Password, deviceSummary, deviceError, summary, profileKind, deviceCheck, deviceCheckText } from "../core/signing.js";
import { sortCertFiles, findPassword } from "../core/certfiles.js";
import { logsSection, logsPage, logsTitle, LOGS } from "./queue.js";
import { loadIdentity, saveIdentity, clearIdentity, getServer, setServer, serverStatus,
  localSigning, deviceStatus, importToDevice, removeFromDevice, statusReady, defaultServer,
  browserSigning, getBring, setBring, signAndInstall } from "../signing-client.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";
import { drawWalkthrough, walkOpen, offerInstall, missingStep, siteReady, deviceRows } from "./signing.js";
import { openInAppSection } from "./importlink.js";
import { accountSection, drawAccount, startAccountSync } from "./account.js";
import { signingExtras } from "./signed-apps.js";
import { syncReminder } from "../core/signing.js";
import { websiteSection } from "./website-settings.js";
import { versionLines } from "./version-foot.js";
import { ipaSection } from "./ipa-install.js";
import { otherLinksOn, setOtherLinks } from "../core/otherlinks.js";
import { NAME, GITHUB_REPO } from "../brand.js";
import { profileNotes, keepOn, GUIDE_LINK } from "../core/keepid.js";
import { keepGuideHref } from "./guides.js";
import { rowIcon, SETTING_ICONS, PAGE_ICONS } from "../icons/rowicons.js";

export const title = "Settings";

// F134: this page's own stylesheet (settings.css), linked once from this module's folder (no build step).
let styled = false;
function style() {
  if (styled || typeof document === "undefined" || !document.head) return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../settings.css", import.meta.url).href;
  document.head.append(link);
}

// The one store the app uses (both modes and the site read it through here). In the jailbreak app the bridge's
// helper makes Ignored Upgrades real dpkg holds (F22); the bridge itself is N3's.
export const settings = createSettings({ mode: detectMode(), helper: globalThis.ifizboxNative?.helper, native: globalThis.ifizboxNative });

// Light: the top of the blue status bar under the nav bar; dark: "Status Bar (Black)".
// By palette (F198): OLED Black's status bar is #000, Gunmetal's the top of its bar. ios6.css --dk-ground matches.
// F200: the palettes.css ones, each its bar's status-bar colour.
export const THEME_COLORS = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f", midnight: "#0a1424", linen: "#000",
  nord: "#2e3440", dracula: "#21222c", sepia: "#7a5c36", solarized: "#2a74a8" };

const defOf = (key) => SETTINGS.find((d) => d.key === key);
const optionLabel = (d, v) => d.options.find((o) => o.value === v)?.label ?? String(v);

const TITLES = { holds: "Ignored Upgrades", blocked: "Blocked", signing: "Signing", account: `${NAME} Account` };
// F205: pages that were renamed, old id -> new, so a saved link still lands (Display became Theme).
const OLD_PAGES = { display: "theme" };
const pathOf = (route) => { const [first, second] = route.path; return [OLD_PAGES[first] ?? first, second]; };

export function nav(route) {
  const [first, second] = pathOf(route);
  if (first === LOGS) return { title: logsTitle(second) }; // N4: Console Logs
  if (first === "signing" && second === HELP) return { title: HELP_TITLE }; // F134: the walkthrough
  const key = second ?? first;
  if (key && TITLES[key]) return { title: TITLES[key] };
  if (key && settings.pageOf(key)) return { title: settings.pageOf(key).title };
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
  const [first, second] = pathOf(route);
  const tone = defOf(second ?? first)?.tone;
  // F231: opening Theme > Light or Dark switches Mode to that tone at once, as picking a theme there does (pick()),
  // before this page joins `pages`, so the change redraws only the pages already open (Theme's Mode control).
  if (tone && settings.get("appearance") !== tone) settings.set("appearance", tone);
  pages.add(p);
  if (tone) { resetSplit(); dropStoredSplit(); } // F215/F230: a theme list opens at its peek
  draw(p);
  // Holds can change outside the app (another package manager, apt-mark by hand): ask dpkg each time Settings
  // opens a page; a change redraws through onChange. Without a helper this does nothing.
  settings.holds.sync().catch(() => {});
}

function draw({ el, route }) {
  style();
  const [first, second] = pathOf(route);
  const top = el.scrollTop;
  if (first === LOGS) el.replaceChildren(logsPage(second, () => draw({ el, route })));
  else if (first === "account") drawAccount(el); // F97
  else if ((second ?? first) === "holds") el.replaceChildren(holdsPage());
  else if ((second ?? first) === "blocked") el.replaceChildren(blockedPage()); // F226
  else if (first === "signing" && second === HELP) drawSigningHelp(el); // F134
  else if (second) el.replaceChildren(listPage(second));
  else if (first === "signing") drawSigning(el);
  else if (first && settings.pageOf(first)) el.replaceChildren(groupPage(first));
  else if (first) el.replaceChildren(listPage(first));
  else el.replaceChildren(rootPage());
  el.scrollTop = top;
}

// The root, like iOS 6's: short rows, each opening a page; no footers. F183: Home's version line at the bottom.
function rootPage() {
  const frag = document.createDocumentFragment();
  const pageRows = settings.pages().filter((p) => p.id !== "signing")
    .map((p) => ({ label: p.title, href: format(settingsRoute([p.id])), ...(PAGE_ICONS[p.id] ? { icon: rowIcon(PAGE_ICONS[p.id]) } : {}) }));
  frag.append(accountSection(), grouped([{ rows: pageRows }]), signingSection(), openInAppSection(), ipaSection(),
    logsSection(detectMode()), ...versionLines());
  return frag;
}

// A page under the root (General, Theme, Updates): its groups, then what other parts of the app add there.
function groupPage(id) {
  const frag = settingsGroups(settings.sections().filter((s) => s.page === id), id);
  if (id === "general") frag.append(blockedSection()); // F226: Blocked packages and authors, every mode
  if (id === "general") frag.append(sideloadingSection()); // F83, sideload build
  if (id === "general") frag.append(websiteSection()); // F145: Lock Home, Install on the Website; website only
  if (id === "updates") frag.append(notifySection()); // Update Alerts, sideload build
  return frag;
}

// Groups of setting rows on page `page`; a list row pushes <page>/<key>.
function settingsGroups(list, page) {
  const switches = [];
  const segs = [];
  const sections = list.map((s) => {
    const rows = [];
    // F205: a setting's tile (SETTING_ICONS); a choice's option rows stay bare.
    const icon = (d) => (SETTING_ICONS[d.key] ? { icon: rowIcon(SETTING_ICONS[d.key]) } : {});
    for (const d of s.settings) {
      if (d.kind === "choice") {
        const v = settings.get(d.key);
        for (const o of d.options) rows.push({ label: o.label, checked: o.value === v, onClick: () => settings.set(d.key, o.value) });
      } else if (d.kind === "segmented") {
        segs.push(d); // F199: Theme's Mode; drawn under the group's header below
      } else if (d.kind === "toggle") {
        switches.push([rows.length, d]);
        rows.push({ label: d.label, ...icon(d) });
      } else if (d.kind === "list") {
        rows.push({ label: d.label, detail: optionLabel(d, settings.get(d.key)), href: format(settingsRoute([page, d.key])), ...icon(d) });
      } else if (d.kind === "holds") {
        const n = settings.holds.list().length;
        rows.push({ label: d.label, detail: n ? String(n) : "None", href: format(settingsRoute([page, "holds"])), ...icon(d) });
      }
    }
    return { header: s.title, footer: s.footer, rows, id: s.id, switches: switches.splice(0), segs: segs.splice(0) };
  });
  const frag = grouped(sections);
  // grouped() draws plain rows; the switches go into their cells afterwards, a segmented control under its header.
  const groups = frag.querySelectorAll(".group");
  sections.forEach((s, i) => {
    if (s.segs.length) {
      const g = groups[i];
      const kids = [...g.children];
      const head = kids.filter((c) => c.classList.contains("group-header"));
      g.replaceChildren(...head, ...s.segs.map((d) => modeControl(d)), ...kids.filter((c) => !head.includes(c)));
    }
    const cells = groups[i].querySelectorAll(".cell-inner");
    for (const [row, d] of s.switches) {
      cells[row].append(makeSwitch(d));
      cells[row].classList.add("has-switch");
    }
  });
  return frag;
}

// A settings row's switch: createSwitch bound to the toggle setting `d`.
// F65: a toggle whose value changed under its switch (Upgrade Notifications when ifizbox-helper fails) shows it.
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
    onToggle: (on) => {
      if ((settings.get(d.key) === true) === on) return;
      if (on || !d.confirmOff) { settings.set(d.key, on); return; }
      // F237: a switch whose Off needs saying first (Keep Bundle IDs): Cancel puts it back
      showAlert({ ...d.confirmOff, cancel: 0 }).then(({ index }) => {
        if (index === 1) settings.set(d.key, false); else syncSwitches(d.key);
      }, () => syncSwitches(d.key));
    },
  });
  b.dataset.key = d.key;
  return b;
}

// F199: a "segmented" setting (Theme's Mode: Automatic / Light / Dark) as the iOS 6 segmented control, the same one
// as the package page's (storepage.js segmented, ios6.css .store-segmented); settings.css fits it into the group.
export function modeControl(d, store = settings) {
  const values = d.options.map((o) => o.value);
  const { bar } = segmented(d.options.map((o) => o.label), {
    selected: Math.max(0, values.indexOf(store.get(d.key))),
    onSelect: (i) => { if (store.get(d.key) !== values[i]) store.set(d.key, values[i]); },
  });
  bar.classList.add("settings-segmented");
  bar.setAttribute("role", "radiogroup");
  bar.setAttribute("aria-label", d.label);
  // VoiceOver reads Mode as a set of radio buttons (the bar is redrawn on every change, so this stays right)
  for (const b of bar.children) { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", b.getAttribute("aria-selected")); }
  bar.dataset.key = d.key;
  return bar;
}

// F199: a theme's little tile in Theme > Light / Dark: its bar colour over its ground (core/settings.js `swatch`).
export function swatchIcon(o) {
  if (!o.swatch) return {};
  const [bar, ground] = o.swatch;
  return { icon: { cls: "theme-swatch", color: `linear-gradient(${bar} 0 45%, ${ground} 45%)` } };
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
  // F215: a tap on a theme also grows the preview to half the screen (until the divider has been dragged).
  const choose = (value) => { if (d.tone) splitTapped(); pick(d, value); if (d.tone) layoutSoon(); };
  const frag = grouped([{
    rows: d.options.map((o) => ({ label: o.label, subtitle: o.subtitle, checked: o.value === v, onClick: () => choose(o.value),
      ...swatchIcon(o) })),
    footer: settings.footerOf(key),
  }]);
  if (d.tone) {
    const list = frag.firstElementChild;
    const space = Object.assign(document.createElement("div"), { className: "theme-preview-space" });
    const box = themePreview();
    frag.append(space, box);
    splitPane(box, space, list);
  }
  return frag;
}

// ---- F215: Theme > Light / Dark's preview as a movable split (like iOS 6's resizable panes) ---------------------
// The preview's height, in px, from where the page is laid out (geo: `top` the list's visible top under the nav bar,
// `bottom` the preview's bottom on the tab bar, `screen` the page's height, `edges` the bottoms of the list's rows and
// of its footer at scroll 0, all in the page's px). F230: on entry it is a short peek (SPLIT_PEEK: the divider and the
// sample's nav bar); when a row edge falls within a row of that line the divider snaps to it, so no row is cut. The
// first tap on a theme springs it up to half the screen. A drag wins over both, for this visit only: the position
// lives in `split` below, which a theme list clears when it opens (nothing is stored).
export const SPLIT_KEY = "ifizbox.themePreviewSplit"; // F215 stored the dragged position here; F230 removes it
export const SPLIT_PEEK = 100; // px: the grip (25) and the sample's nav bar (44), with a little of what is under it
export const SPLIT_TAP = 0.5;
export const SPLIT_MIN = 64; // px: the dragged preview keeps its divider and a bit of sample
const LIST_MIN = 44; // px: and the list one row's height

export function entrySplit({ top, bottom, edges = [] }) {
  const fit = edges.filter((e) => e > top && bottom - e >= SPLIT_PEEK);
  const low = fit.length ? Math.max(...fit) : null;
  return low != null && bottom - low - SPLIT_PEEK < LIST_MIN ? bottom - low : SPLIT_PEEK;
}

export function clampSplit(h, { top, bottom }) {
  return Math.round(Math.max(SPLIT_MIN, Math.min(bottom - top - LIST_MIN, h)));
}

// state: { dragged } the height the divider was let go at this visit (px, or null), { tapped } a theme was tapped.
export function splitHeight(geo, { dragged = null, tapped = false } = {}) {
  if (dragged != null && Number.isFinite(dragged)) return clampSplit(dragged, geo);
  const entry = entrySplit(geo);
  return tapped ? Math.max(entry, Math.min(Math.round(geo.screen * SPLIT_TAP), geo.bottom - geo.top - LIST_MIN)) : entry;
}

// F230: F215 kept the dragged position in localStorage; drop that key once per launch so no stale one lingers.
let oldKeyGone = false;
export function dropStoredSplit(storage = globalThis.localStorage) {
  if (oldKeyGone) return;
  oldKeyGone = true;
  try { storage?.removeItem(SPLIT_KEY); } catch { /* private mode */ }
}

// The live state: the preview on screen, its height now, whether a theme was tapped since the list opened, and where
// the divider was dragged to. A theme tap redraws the page (a new preview), so the height carries over here and the
// new one animates from it.
let split = { box: null, space: null, list: null, h: null, tapped: false, dragged: null, moving: false };
export const resetSplit = () => { split = { box: null, space: null, list: null, h: null, tapped: false, dragged: null, moving: false }; };
// The state changes, apart from the DOM (settings.test.js drives them): a theme tapped, the divider let go, and the
// height the preview should have now.
export const splitTapped = () => { split.tapped = true; };
export const splitDropped = (h) => { split.dragged = h; };
export const splitNow = (geo) => splitHeight(geo, split);

function splitPane(box, space, list) {
  Object.assign(split, { box, space, list });
  if (split.h != null) setSplit(box, space, split.h); // a redraw: keep the height on screen, then move from it
  box.querySelector(".theme-preview-grip")?.addEventListener?.("pointerdown", (e) => dragSplit(e, box, space));
  layoutSoon();
}

function setSplit(box, space, h) {
  box.style.height = h + "px";
  box.style.transform = "";
  space.style.height = h + "px";
}

let layoutQueued = false;
function layoutSoon() {
  if (layoutQueued || !globalThis.requestAnimationFrame) return; // no layout to measure (node's tests)
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layoutSplit(); });
}

function geometry(box, list) {
  const scroller = box.closest(".page-body");
  if (!scroller || !box.isConnected) return null;
  const r = scroller.getBoundingClientRect();
  const top = r.top + (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
  const bottom = r.bottom - (parseFloat(getComputedStyle(box).bottom) || 0);
  const at0 = (el) => el.getBoundingClientRect().bottom + scroller.scrollTop;
  const rows = [...(list?.querySelectorAll(".table > li") ?? [])];
  const edges = rows.map((li, i) => at0(i === rows.length - 1 ? li.parentElement : li));
  const footer = list?.querySelector(".group-footer");
  if (footer) edges.push(at0(footer) + 10); // the whole list fits: end under its footer, with a group's gap
  return { top, bottom, screen: r.height, edges };
}

function layoutSplit() {
  const { box, space, list } = split;
  if (!box || split.moving) return;
  const geo = geometry(box, list);
  if (!geo) return;
  const to = splitNow(geo);
  const from = split.h;
  split.h = to;
  if (from == null || from === to || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setSplit(box, space, to);
  if (to > from) return springSplit(box, space, from, to);
  // Transform only (120 Hz): lay it out at the taller of the two once, slide, then settle at the new height.
  const tall = Math.max(from, to);
  box.style.height = tall + "px";
  if (to > from) space.style.height = to + "px";
  const anim = box.animate([{ transform: `translateY(${tall - from}px)` }, { transform: `translateY(${tall - to}px)` }],
    { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)", fill: "forwards" });
  split.moving = true;
  anim.finished.catch(() => {}).then(() => {
    split.moving = false;
    anim.cancel();
    if (split.box === box) setSplit(box, space, split.h);
  });
}

// F230: the first theme tap pops the preview up: laid out once at the new height plus a small overshoot, it rises
// past the line (~65% of the time), then settles back down onto it. Transform only (120 Hz); ~380ms in all.
function springSplit(box, space, from, to) {
  const over = Math.min(14, Math.max(4, Math.round((to - from) * 0.06)));
  const tall = to + over;
  box.style.height = tall + "px";
  space.style.height = to + "px";
  const anim = box.animate([
    { transform: `translateY(${tall - from}px)`, offset: 0, easing: "cubic-bezier(.2,.75,.35,1)" },
    { transform: "translateY(0px)", offset: 0.65, easing: "cubic-bezier(.45,0,.55,1)" },
    { transform: `translateY(${over}px)`, offset: 1 },
  ], { duration: 380, fill: "forwards" });
  split.moving = true;
  anim.finished.catch(() => {}).then(() => {
    split.moving = false;
    anim.cancel();
    if (split.box === box) setSplit(box, space, split.h);
  });
}

// Dragging the divider: the preview is laid out at its tallest once, the finger moves it by transform, and where it
// is let go is the height for the rest of this visit (F230: kept in `split` only, never stored).
function dragSplit(e, box, space) {
  if (split.moving && !split.dragging) return;
  const geo = geometry(box, split.list);
  if (!geo) return;
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture?.(e.pointerId);
  grip.classList.add("is-held");
  const tall = geo.bottom - geo.top - LIST_MIN;
  const h0 = split.h ?? box.getBoundingClientRect().height;
  const y0 = e.clientY;
  let h = h0;
  split.moving = split.dragging = true;
  box.style.height = tall + "px";
  box.style.transform = `translateY(${tall - h0}px)`;
  const move = (m) => {
    if (m.pointerId !== e.pointerId) return;
    h = clampSplit(h0 - (m.clientY - y0), geo);
    box.style.transform = `translateY(${tall - h}px)`;
  };
  const end = (u) => {
    if (u.pointerId !== e.pointerId) return;
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    grip.classList.remove("is-held");
    split.moving = split.dragging = false;
    split.h = h;
    if (h !== h0) splitDropped(h);
    setSplit(box, space, h);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

// A theme picked in Theme > Light / Dark also switches Mode to that tone, so it shows once back on Theme.
export function pick(d, value, store = settings) {
  store.set(d.key, value);
  if (d.tone && store.get("appearance") !== d.tone) store.set("appearance", d.tone);
}

// Theme > Light / Dark: a sample of the app's controls in the theme showing, pinned over the page's bottom half
// (settings.css .theme-preview). Inert: nothing in it does anything.
function themePreview() {
  const make = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? "" });
  // F215: the pane holds the divider (a grip to drag) and the sample, which scrolls on its own under it.
  const pane = make("div", "theme-preview");
  const grip = make("div", "theme-preview-grip");
  grip.setAttribute("aria-hidden", "true");
  const box = make("div", "theme-preview-body");
  pane.append(grip, box);
  box.inert = true;
  box.setAttribute("aria-hidden", "true");
  const bar = make("div", "navbar theme-preview-bar");
  bar.append(make("span", "bar-button back", "Back"), make("span", "nav-title", "Preview"), make("span", "bar-button", "Edit"));
  const search = make("div", "search-bar");
  const field = make("label", "search-field");
  field.append(Object.assign(document.createElement("input"), { type: "search", placeholder: "Search" }));
  search.append(field);
  const seg = segmented(["Details", "Reviews", "Related"]).bar;
  seg.classList.add("theme-preview-seg");
  const buttons = make("div", "theme-preview-buttons");
  buttons.append(make("span", "store-btn", "FREE"), make("span", "store-btn", "$0.99"), make("span", "badge", "3"));
  const groups = grouped([{ header: "Sample", rows: [
    { label: "Sources", detail: "12", chevron: true, icon: rowIcon(PAGE_ICONS.general) },
    { label: "Upgrades", badge: "3", chevron: true, icon: rowIcon(PAGE_ICONS.updates) },
    { label: "Switch" },
    { label: "Checked", checked: true },
    { label: "Package", subtitle: "A row with a subtitle", detail: "1.0" },
  ], footer: "A group footer reads like this." }]);
  const sw = groups.querySelectorAll(".cell-inner")[2];
  sw.append(createSwitch({ label: "Switch", checked: true }));
  sw.classList.add("has-switch");
  box.append(bar, search, seg, buttons, groups);
  return pane;
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

// F226: Settings > General > Blocked (Zebra #1037, #998): the packages blocked from their page and the authors
// (F104's hidden authors), each with a check; a tap unblocks it. Pure: the groups for nav/ui.js grouped(), for the
// tests. `entries` [{ id, name }], `authors` [name].
export function blockedLayout({ entries = [], authors = [], mode = "site" } = {}) {
  const where = mode === "jailbreak"
    ? "An installed package you block is also held with dpkg, so other package managers leave it alone."
    : "Kept on this device.";
  if (!entries.length && !authors.length) {
    return [{ footer: `Nothing is blocked. Block a package or its author on the package's page: it leaves Browse, Search, Sections and Changes. ${where}` }];
  }
  const groups = [];
  if (entries.length) {
    groups.push({ header: "Packages", key: "packages",
      rows: entries.map((e) => ({ id: e.id, label: e.name, subtitle: e.name !== e.id ? e.id : undefined, checked: true })),
      footer: `Left out of Browse, Search, Sections and Changes. ${where} Tap a package to unblock it.` });
  }
  if (authors.length) {
    groups.push({ header: "Authors", key: "authors", rows: authors.map((a) => ({ author: a, label: a, checked: true })),
      footer: "Every package by these authors is left out the same way. Tap an author to unblock them." });
  }
  return groups;
}

// The General page's row: how many are blocked, pushing the list.
function blockedSection() {
  const n = settings.blocked.list().length + settings.blocked.authors().length;
  return grouped([{ rows: [{ label: "Blocked", detail: n ? String(n) : "None", href: format(settingsRoute(["general", "blocked"])), icon: rowIcon("hidden") }] }]);
}

function blockedPage() {
  // Unblock lifts a dpkg hold only where the block made it (core/settings.js blocked.set); a change redraws the page.
  return grouped(blockedLayout({ entries: settings.blocked.entries(), authors: settings.blocked.authors(), mode: detectMode() }).map((g) => ({
    ...g,
    rows: (g.rows ?? []).map((r) => ({ label: r.label, subtitle: r.subtitle, checked: true,
      onClick: () => (r.author ? settings.blocked.setAuthor(r.author, false) : settings.blocked.set(r.id, false).catch(() => {})) })),
  })));
}

// ---- Theme ---------------------------------------------------------------------------------------------------

// F198: the dark palette chosen (raw, as theme-boot.js reads it). F199: Theme > Dark sets it (settings' darkTheme,
// stored at the same key); paletteFor() reads anything but a known palette as OLED Black.
export function darkTheme(win = globalThis) {
  try { return win.localStorage?.getItem(DARK_THEME_KEY) ?? null; } catch { return null; }
}

// F199: Theme > Light and Theme > Dark are live previews: while one of their lists is the page on screen, the app
// shows that tone in the theme picked there, whatever Mode says; back on Theme it shows Mode's again. Read off the
// route (the URL hash), so it holds before the page is drawn and the moment back is tapped. theme-boot.js matches.
const THEME_LISTS = { lightTheme: "light", darkTheme: "dark" };
export function previewOf(route) {
  if (route?.tab !== "home" || route.path[0] !== "settings") return null;
  const [first, second] = pathOf({ path: route.path.slice(1) });
  if (second && first !== "theme") return null;
  return THEME_LISTS[second ?? first] ?? null;
}
function currentPreview(win) {
  try { return previewOf(parse(win.location?.hash)); } catch { return null; }
}

export function applyTheme(doc = document, win = window) {
  const dark = win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const appearance = settings.get("appearance");
  const lightTheme = settings.get("lightTheme");
  const darkPalette = settings.get("darkTheme");
  const preview = currentPreview(win);
  const { theme, palette } = themeState({ appearance, lightTheme, darkTheme: darkPalette, preview }, dark);
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.dataset.palette = palette; // F198/F199: Mode's tone in its chosen theme
  // A meta with a media query (light or dark) is painted for its own scheme while Mode is Automatic; a fixed
  // choice, a preview, or a meta with none (index.html has one), takes the palette showing now.
  // A fresh meta element, not a changed one: Safari doesn't always repaint its top bar when only `content` changes.
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own = m.media?.includes("dark") ? "dark" : m.media?.includes("light") ? "light" : null;
    const color = THEME_COLORS[appearance === "auto" && own && !preview ? paletteFor(own, darkPalette, lightTheme) : palette];
    if (m.content === color) continue;
    const fresh = m.cloneNode();
    fresh.content = color;
    m.replaceWith(fresh);
  }
  // A preview pins the shell to the tone on screen (its status bar and keyboard follow the page) until it ends.
  tellShell(preview ? theme : appearance, theme, win, darkPalette, paletteFor("light", darkPalette, lightTheme));
}

// The jailbreak/sideload shell (F23): native parts the page can't style (keyboard, <select> pickers, alerts,
// the window behind the web view) follow the theme through the bridge's app.theme. Automatic sends "auto" so the
// shell lets the system decide; pinning a style there would also pin prefers-color-scheme inside the web view and
// Automatic would stop following the system. On the site there is no handler and this does nothing.
// F198: darkPalette is the dark palette chosen (oled or gunmetal), sent in light too: the shell keeps it to paint its
// window at the next launch before the page runs (black for OLED Black), whichever way Automatic then goes.
// F214: lightPalette (classic, sepia or solarized) likewise, so a light launch paints Sepia's or Solarized Light's
// pinstripes, not the kit's blue-grey.
export function themeMessage(appearance, theme, darkPalette = "oled", lightPalette = "classic") {
  return { id: 0, method: "app.theme", params: { style: appearance === "auto" ? "auto" : theme, theme, darkPalette, lightPalette } };
}
let lastSent = "";
function tellShell(appearance, theme, win, darkPalette, lightPalette) {
  const h = win.webkit?.messageHandlers?.ifizbox;
  if (!h) return;
  const msg = themeMessage(appearance, theme, darkPalette, lightPalette);
  const key = JSON.stringify(msg.params);
  if (key === lastSent) return;
  lastSent = key;
  try { Promise.resolve(h.postMessage(msg)).catch(() => {}); } catch { /* an older shell without app.theme */ }
}

// Zoom is always off (F134 retired Display > Zoom, allowZoom). iOS Safari ignores user-scalable=no, so besides the
// viewport and touch-action (html.no-zoom in ios6.css) the pinch gesture itself is cancelled.
function applyZoom(doc = document) {
  const allow = false;
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
  window.addEventListener?.("hashchange", () => applyTheme()); // F199: a theme list's preview starts and ends
  settings.onChange((key) => {
    if (key === "appearance" || key === "lightTheme" || key === "darkTheme") applyTheme();
    if (key === "resignReminder") remindNow();
  });
  startAccountSync(); // F97: read the account on launch, save it when iFizBox goes to the background
  remindNow(); // F68: on launch too, so the notification follows the setting (and any change the shell missed)
}

// F68: Re-sign Reminder to the shell (signing.remind {days}, F14), sideload build only.
function remindNow() {
  if (!localSigning() || !settings.isShown("resignReminder")) return;
  const n = globalThis.ifizboxNative;
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
const OTHER_LINKS_FOOTER = `AltStore, SideStore, Feather and other sideloaders' links open in ${NAME}. `
  + "iOS picks the app for each kind of link, so Off can't always hand them back.";
function sideloadingSection(mode = detectMode()) {
  const box = document.createElement("div");
  if (mode !== "sideload") return box;
  const frag = grouped([{ header: "Sideloading", rows: [{ label: "Open Other Apps' Links", icon: rowIcon("otherLinks") }], footer: OTHER_LINKS_FOOTER }]);
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

// B20: the Signing Server row's alert: a text field with the server's URL (empty for the default), then Save stores
// it and checks it (Check Server's alerts). Injectable for the tests.
export async function askServer(el, { alert = showAlert, current = getServer, def = defaultServer, save = setServer,
  check = checkServer, redraw = redrawAll } = {}) {
  const server = current(), fallback = def();
  const { index, value } = await alert({ title: "Signing Server", message: `Hands iOS the install manifests. Empty for ${new URL(fallback).host}.`,
    input: { type: "url", placeholder: fallback, value: server === fallback ? "" : server }, buttons: ["Cancel", "Save"], cancel: 0 });
  if (index !== 1) return false;
  save(String(value ?? "").trim() || fallback);
  redraw();
  await check();
  return true;
}

// B20: the row that opens it, drawn as a field (F149): "Server" on the left, the host in the field blue-grey on the
// right, or the default's host in the grey hint colour (what the empty field falls back to).
export function serverRow({ server, fallback, ask }) {
  const own = server !== fallback;
  return { label: "Server", detail: new URL(server).host, subtitle: own ? null : "Default",
    cls: own ? "server-field" : "server-field-default", chevron: true, onClick: () => ask() };
}

const RUN_YOUR_OWN = `https://github.com/${GITHUB_REPO}/tree/main/worker#host-your-own-free-about-a-minute`;

async function checkServer() {
  const hide = showHUD("Checking");
  try {
    const st = await serverStatus();
    hide();
    const host = new URL(getServer()).host;
    // The app needs only manifests and the update hand-off (worker/ answers worker: true).
    if (st?.worker || st?.ok) await alertOK("Server Works", `${host} hands iOS the install manifests and holds ${NAME}'s own updates. Signing happens on this iPhone.`);
    else await alertOK("Server Not Ready", `${host} answers but isn't a Signing Server.`);
  } catch (e) {
    hide();
    await alertOK("Server Not Reachable", `${new URL(getServer()).host}: ${e.message || "no answer"}.`);
  }
}

async function drawSigning(el) {
  if (localSigning()) return drawDeviceSigning(el);
  if (browserSigning()) return drawSiteSigning(el);
  el.replaceChildren(grouped([{ footer: `Apps are signed in the ${NAME} app, on the iPhone itself, with your own certificate.` }]));
}

// The certificate, its profile and its password: one group of rows, each with its name on the left, its value in the
// middle and a Browse button on the right (a <label> over a hidden file input, so iOS opens its picker straight from
// the tap). F75: above them the big Select All Files button, the same multi-select picker: one pick of the .p12, the
// .mobileprovision and the password file (or their .zip) fills whatever is missing (core/certfiles.js sorts them and
// finds the password). Any row's Browse takes several files too.
// F134: Settings > Signing shows it as its "Files" group while files are picked but not all in (`files`: no Select
// All Files, which the Certificate group's Import row already is, and a one-line footer); the walkthrough as before.
function certificateBlock(el, id, status = null, { files = false } = {}) {
  const kept = statusReady(status) ? status.identity : null; // F58: what the sideload build's Keychain holds
  const box = document.createElement("div");
  box.className = "group sign-files"; // a .group, like every grouped section: its 10px side margins
  const head = Object.assign(document.createElement("h3"), { className: "group-header", textContent: files ? "Files" : "Certificate" });
  const ul = document.createElement("ul");
  ul.className = "table grouped";
  const accept = ".p12,.pfx,.mobileprovision,.txt,.zip,application/x-pkcs12,application/zip,text/plain";
  const fileRow = (name, value, slot) => {
    const shown = Object.assign(document.createElement("span"), { className: "sign-value" + (value ? "" : " is-empty"), textContent: value || "None" });
    return signRow(name, shown, browseButton(accept, true, (files) => chooseFiles(el, files, slot)));
  };

  const input = Object.assign(document.createElement("input"), { type: "password", className: "sign-value",
    placeholder: passwordPlaceholder(kept, id?.p12), value: id?.password ?? "" });
  input.classList.add("sign-field"); // F149: drawn as an editable field, not a read-only value
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
    fileRow(".mobileprovision", profShown, "profile"), focusOnRowTap(signRow("Password", input, pwBrowse), input));
  const state = id?.p12 && id?.password != null ? (id.passwordOk === false ? " The password doesn't open this certificate." : id.passwordOk ? " The password opens it." : "") : "";
  const kind = browserSigning() ? `They're kept in this browser only, and apps are signed here in the browser: they go to no server, except inside ${NAME}'s own app with Bring My Certificate.`
    : `Once all three are here, they go into this iPhone's Keychain, where only ${NAME} can use them; the password isn't kept. To change one, choose the .p12 and the profile again.`;
  const foot = Object.assign(document.createElement("p"), { className: "group-footer",
    textContent: (files ? "Browse for what's missing, or type the password." : "Your .p12 (the certificate and its key), its .mobileprovision and the password. Each row's Browse picks one. " + kind) + state });
  if (files) {
    box.append(head, ul, foot);
    return box;
  }
  const [allInput, allLabel] = browseButton(accept, true, (picked) => chooseFiles(el, picked, null));
  allLabel.className = "walk-action sign-all";
  allLabel.textContent = "Select All Files";
  box.append(head, allInput, allLabel, ul, foot);
  return box;
}

// F149: the Password row's grey hint, iOS 6's "Required" (Mail's account fields), never the file rows' "None".
// "Not Kept" while the Keychain holds the identity and no .p12 is picked: the password isn't kept with it.
export function passwordPlaceholder(kept, p12) {
  return kept && !p12 ? "Not Kept" : "Required";
}

// F149: a tap anywhere on the row (its padding and edges too, outside the <label>) puts the caret in the field,
// except on the Browse button, which opens its picker.
export function focusOnRowTap(li, input) {
  li.addEventListener("click", (e) => {
    if (e.target === input || e.target?.closest?.(".sign-browse")) return;
    input.focus();
  });
  return li;
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
// Signing Server, which hands iOS the manifest for the IPA iFizBox serves at 127.0.0.1 (the certificate never leaves
// the phone; the server sees the app's ID, version and name).

// F128: the root's Signing row, the certificate as its detail (the page explains the rest).
const signingRow = (box, detail) => box.replaceChildren(grouped([{ rows: [{ label: "Signing", detail, href: format(settingsRoute(["signing"])), icon: rowIcon("signing") }] }]));
function deviceSigningSection(box) {
  const fill = (detail) => signingRow(box, detail);
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
    await alertOK("Couldn't Import", after.identityProblem || `The certificate went into the Keychain but ${NAME} can't find it there. Remove it and import it again.`);
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

// Back in iFizBox (from Safari or the Files app): redraw, and while the Signing page is open look at signing.status
// every 2 s, so the walkthrough ticks the moment a certificate lands (the launch import of one that came inside the
// app, an import finished elsewhere). The app's web view doesn't always send visibilitychange, so focus and
// pageshow count too.
// B20: but the web view also gets window focus back on an ordinary tap (the first one after a keyboard or a native
// sheet went away), and a full redraw then swapped the rows under the finger: iOS dropped the click (the Signing
// Server row "can't be tapped"). Focus now only looks at signing.status and redraws when it changed, as the 2 s check
// does; visibilitychange (back from hidden) and pageshow still redraw at once.
let watchingReturn = false;
function watchReturn() {
  if (watchingReturn || typeof document === "undefined") return;
  watchingReturn = true;
  returnWatcher({ doc: document, win: globalThis, redraw: redrawAll, status: deviceStatus, interval: setInterval });
}

// watchReturn's listeners, injectable for the tests. Returns the status check (what focus and the timer run).
export function returnWatcher({ doc, win, redraw, status, interval }) {
  let last = null;
  const onPage = () => doc.visibilityState !== "hidden" && doc.querySelector(".page.is-top .walkthrough, .page.is-top .signing-page");
  const check = async () => {
    if (!onPage()) return;
    let st = null;
    try { st = await status(); } catch { return; }
    const now = String(statusReady(st));
    if (last !== null && now !== last) redraw();
    last = now;
  };
  const again = () => { if (doc.visibilityState !== "hidden") redraw(); };
  doc.addEventListener("visibilitychange", again);
  win.addEventListener("pageshow", again);
  win.addEventListener("focus", check);
  interval(check, 2000);
  return check;
}

// F134: Settings > Signing as an iOS 6 settings page (signingPage below): the certificate, the files while some are
// missing, the profile, Show Expiry Dates and Re-sign Reminder, the Signing Server, Certificate Status and Signed
// Apps, Remove Certificate, and How Signing Works at the bottom. That link opens the walkthrough (screens/signing.js,
// drawSigningHelp), which keeps its steps, picture and Select All Files.
async function deviceSigningState(el) {
  const id = await loadIdentity();
  let status = null, failure = null;
  try { status = await deviceStatus(); } catch (e) { failure = e; }
  return { id, status, failure, kept: statusReady(status) ? status.identity : null };
}

const serverGroup = (el) => {
  const server = getServer();
  return grouped([{ header: "Signing Server", rows: [
    { ...serverRow({ server, fallback: defaultServer(), ask: () => askServer(el) }), icon: rowIcon("server") },
    { label: "Check Server", onClick: () => checkServer(), icon: rowIcon("checkServer") },
    // Nothing depends on our own server: anyone can run their own, free (worker/README.md's Deploy to Cloudflare).
    { label: "Run Your Own", subtitle: "Free on Cloudflare, about a minute", chevron: true, icon: rowIcon("runYourOwn"),
      onClick: () => window.open(RUN_YOUR_OWN, "_blank", "noopener") }] }]);
};

// F237: under Keep Bundle IDs, what the profile can't do with the ID kept (wildcard, development, no Push), or the
// old way's warning while it's off, with the guide's row. Nothing for an Ad Hoc profile with Push.
export function keepNotes(profile, keep) {
  return profileNotes(profile, { keep }).filter((n) => n.id !== "one-app");
}
function withKeepNotes(frag, profile) {
  const notes = keepNotes(profile, keepOn((k) => settings.get(k)));
  if (notes.length) {
    const rows = notes.some((n) => n.guide) ? [{ label: GUIDE_LINK, href: keepGuideHref() }] : [];
    frag.append(grouped([{ rows, footer: notes.map((n) => n.text).join(" ") }]));
  }
  return frag;
}

async function drawDeviceSigning(el) {
  watchReturn();
  const { id, status, failure, kept } = await deviceSigningState(el);
  const info = deviceSummary(kept);
  const staged = Boolean(id?.p12 || id?.profile);
  const notes = [failure ? `The signer didn't answer: ${deviceError(failure).message}` : null, status?.identityProblem ?? null,
    ...info.problems].filter(Boolean);
  const split = splitSummary(info.rows);
  const parts = {
    certificate: () => certificateGroup(el, { rows: split.certificate, has: Boolean(kept), staged, notes,
      footer: `Kept in this iPhone's Keychain, where only ${NAME} can use it.` }),
    files: () => certificateBlock(el, id, status ?? { identity: null }, { files: true }),
    profile: () => profileGroup(split.profile, info.device), // F236: with "This iPhone is in the profile"
    options: () => withKeepNotes(settingsGroups(settings.sections().filter((s) => s.page === "signing"), "signing"), kept?.profile),
    server: () => serverGroup(el),
    status: () => signingExtras({ identity: kept, redraw: redrawAll, dates: settings.get("showExpiry") }),
    remove: () => grouped([{ rows: [{ label: "Remove Certificate", onClick: () => removeDeviceCertificate() }] }]),
    help: () => helpGroup(),
  };
  showSigningPage(el, signingLayout({ mode: "sideload", certificate: Boolean(kept), staged, profile: split.profile.length > 0,
    options: settings.sections().some((s) => s.page === "signing") }), parts);
  offerInstall(missingStep(status, getServer()) == null); // F177: Install sent the user here: Install Now once ready
}

// The walkthrough (F69, F75): Import Your Certificate (Select All Files, the rows, the Files picker's picture), then
// the Signing Server, ticked as each is done. walkOpen keeps the user's expand/collapse taps across redraws (and
// Install's redirect sets it: openAt).
async function drawSigningHelp(el) {
  if (localSigning()) {
    watchReturn();
    const { id, status, failure } = await deviceSigningState(el);
    const server = getServer();
    drawWalkthrough(el, {
      status, failure: failure ? deviceError(failure).message : "",
      certificate: certificateBlock(el, id, status ?? { identity: null }),
      server: serverGroup(el), serverUrl: server, open: walkOpen,
    });
    offerInstall(missingStep(status, server) == null); // F177
    return;
  }
  if (!browserSigning()) return drawSigning(el);
  const id = await loadIdentity();
  // The same walkthrough as the app's (user 2026-11-18: "the webpage one needs to match the ipa one"): step 1 the
  // certificate, step 2 the server, which on the website is this site itself (it holds the signed app for iOS).
  const ready = Boolean(id?.p12 && id?.profile && id?.passwordOk !== false);
  const here = grouped([{ rows: [{ label: location.host, subtitle: "This site holds each signed app for iOS" }] }]);
  drawWalkthrough(el, {
    status: ready ? { identity: { website: true } } : null,
    certificate: certificateBlock(el, id),
    server: here, serverUrl: location.origin, open: walkOpen,
    extra: [grouped([{ header: "How It Works",
      footer: "Install downloads the app, signs it in this browser with your certificate, and leaves the signed app on "
        + `${location.host} for 10 minutes so iOS can install it. Your certificate, key and password stay in this browser.` }])],
  });
  offerInstall(siteReady(id)); // F177
}

export const HELP = "help";
const HELP_TITLE = "How Signing Works";

// F134: which of SIGNING_GROUPS (core/settings.js, their order) the page shows. `certificate`: one is in use (the
// Keychain's, or the browser's .p12 with its profile); `staged`: files are picked but not all in, or the password
// is wrong; `profile`: there are profile rows; `options`: the build has Signing's settings. Pure, for the tests.
export function signingLayout({ mode, certificate = false, staged = false, profile = false, options = false, ready = false } = {}) {
  const site = mode === "site";
  const on = {
    certificate: true,
    files: staged,
    profile,
    options,
    server: mode === "sideload",
    status: mode === "sideload",
    app: site && ready,
    other: site,
    remove: certificate || staged,
    help: true,
  };
  return SIGNING_GROUPS.filter((g) => on[g]);
}

// F134: core/signing.js summary()/deviceSummary() rows, split into the Certificate group (Name, Team, Expires) and
// the Provisioning Profile group (Name, Expires, Devices, App ID). Long values go under the label, where they wrap.
const CERT_LABELS = { Certificate: "Name", Team: "Team", "Certificate Expires": "Expires" };
const PROFILE_LABELS = { Profile: "Name", Type: "Type", "Profile Expires": "Expires", Devices: "Devices", "App ID": "App ID",
  "Certificates in Profile": "Certificates" };
export function splitSummary(rows = []) {
  const fit = (label, detail) => (String(detail).length > 16 ? { label, subtitle: detail } : { label, detail });
  return {
    certificate: rows.filter((r) => CERT_LABELS[r.label]).map((r) => fit(CERT_LABELS[r.label], r.detail)),
    profile: rows.filter((r) => PROFILE_LABELS[r.label]).map((r) => fit(PROFILE_LABELS[r.label], r.detail)),
  };
}

// The Certificate group: its rows (or None / Incomplete), then Import Certificate or Replace Certificate, a row that
// opens the file picker (the hidden multi-file input Browse uses, clicked in the tap's own handler so iOS allows it;
// a button row, so it shows the pressed look). Its footer is what's wrong, else `footer`.
function certificateGroup(el, { rows, has, staged, notes = [], footer }) {
  const list = has && rows.length ? rows : [{ label: "Certificate", detail: staged ? "Incomplete" : "None" }];
  const accept = ".p12,.pfx,.mobileprovision,.txt,.zip,application/x-pkcs12,application/zip,text/plain";
  const [input] = browseButton(accept, true, (files) => chooseFiles(el, files, null));
  const action = { label: has ? "Replace Certificate" : "Import Certificate", cls: "sign-import", onClick: () => input.click() };
  const frag = grouped([{ header: "Certificate", rows: [...list, action],
    footer: notes.length ? notes.join(" ") : has ? footer : "Choose your .p12, its .mobileprovision and the password file, or their .zip." }]);
  frag.querySelector(".sign-import")?.append(input);
  if (notes.length) frag.querySelector(".group-footer")?.classList.add("sign-warning");
  return frag;
}

// The Provisioning Profile group, with F236's "This iPhone" rows and the check's sentence as its footer (red when this
// iPhone isn't in the profile; Copy UDID puts the UDID on the clipboard for the developer account's Add Device).
function profileGroup(rows, device) {
  const extra = deviceRows(device);
  if (!extra) return grouped([{ header: "Provisioning Profile", rows }]);
  const more = extra.rows.map((r) => (r.copy ? { label: r.label, cls: "sign-copy-udid", onClick: (e) => copyUdid(r.copy, e) } : r));
  const frag = grouped([{ header: "Provisioning Profile", rows: [...rows, ...more], footer: extra.footer }]);
  if (extra.warn) frag.querySelector(".group-footer")?.classList.add("sign-warning");
  return frag;
}

async function copyUdid(udid, e) {
  const label = e?.currentTarget?.querySelector?.(".cell-label") ?? null;
  try {
    await navigator.clipboard.writeText(udid);
    if (label) label.textContent = "Copied";
  } catch {
    await showAlert({ title: "UDID", message: udid, buttons: ["OK"] }); // no clipboard: show it to copy by hand
  }
}

const helpGroup = () => grouped([{ rows: [{ label: HELP_TITLE, href: format(settingsRoute(["signing", HELP])), icon: rowIcon("help") }] }]);

// The page from its parts, in signingLayout's order, keeping the scroll position.
function showSigningPage(el, layout, parts) {
  const page = document.createElement("div");
  page.className = "signing-page";
  for (const g of layout) if (parts[g]) page.append(parts[g]());
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
}

// ---- Update Alerts (I3) ---------------------------------------------------------------------------------------
// iFizBox's own update check has no page (F183): essential-ui.js lookForUpdates runs on every launch and Reload.

// The sideload app: what iOS lets iFizBox do for update alerts (badges, notifications, Background App Refresh) and
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
    footer: off ? `iOS asks only once: anything left off is turned on in Settings > Notifications > ${NAME}, and Settings > General > Background App Refresh.`
      : "iOS decides when the background check runs, usually every few hours. It badges every update and notifies only about new ones." };
}
function notifySection() {
  const box = document.createElement("div");
  const n = globalThis.ifizboxNative;
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

// ---- Signing on the website (F93, as before F89) --------------------------------------------------------------
// The .p12, its password and the .mobileprovision in this browser's IndexedDB (signing-client.js); Install on an app
// page and Home's Install iFizBox App sign in the browser with them (zsign as WebAssembly, signing-worker.js) and the
// Worker only hosts the signed IPA for iOS's install prompt.

function siteSigningSection(box) {
  const fill = (detail) => signingRow(box, detail);
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

// Install iFizBox App, green, once the certificate works, with Bring My Certificate under it.
const installApp = () => signAndInstall({ url: APP_IPA_URL, name: APP_NAME, bring: getBring() });
function siteAppSection(id) {
  if (!(id?.p12 && id?.profile && id.passwordOk !== false)) return [];
  const frag = grouped([{ rows: [{ label: `Install ${NAME} App`, onClick: installApp, icon: { text: "" } }],
    footer: `${NAME} as an app, signed here with this certificate. It signs apps on the iPhone itself.` }]);
  frag.firstChild.classList.add("app-offer");
  frag.querySelector(".cell-icon")?.classList.add("home-glyph", "glyph-install");
  const bring = grouped([{ rows: [{ label: "Bring My Certificate", icon: rowIcon("syncCert") }],
    footer: `Puts a copy of your certificate inside the app, so ${NAME} has it on first launch.` }]);
  const cell = bring.querySelector(".cell-inner");
  cell?.append(createSwitch({ label: "Bring my certificate into the app", checked: getBring(), onToggle: (on) => setBring(on) }));
  cell?.classList.add("has-switch");
  return [frag, bring];
}

// F96's Install on the Website and Home's lock moved to General > Website (F145: screens/website-settings.js).

async function removeSiteCertificate() {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The .p12, its password and the profile are deleted from this browser.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  await clearIdentity();
  redrawAll();
}

async function drawSiteSigning(el) {
  const id = await loadIdentity();
  let profile = null;
  try { profile = id?.profile ? parseProfile(id.profile) : null; } catch { /* checked when picked */ }
  const info = summary({ profile, passwordOk: id?.passwordOk ?? null });
  const ready = Boolean(id?.p12 && id?.profile && id?.passwordOk !== false);
  const staged = Boolean(id?.p12 || id?.profile) && !ready;
  const rows = profile ? [{ label: "Profile", detail: profile.name || "Unnamed" }, { label: "Type", detail: profileKind(profile) }, ...info.rows] : [];
  const split = splitSummary(rows);
  const parts = {
    certificate: () => certificateGroup(el, { rows: split.certificate, has: ready && Boolean(profile), staged, notes: info.problems,
      footer: "Kept in this browser only. Apps are signed here, not on a server." }),
    files: () => certificateBlock(el, id, null, { files: true }),
    // F236: the website can't read the UDID: a profile that lists devices says how to check it
    profile: () => profileGroup(split.profile, profile ? deviceCheckText(deviceCheck(profile, null)) : null),
    options: () => withKeepNotes(settingsGroups(settings.sections().filter((s) => s.page === "signing"), "signing"), profile),
    app: () => { const f = document.createDocumentFragment(); f.append(...siteAppSection(id)); return f; },
    remove: () => grouped([{ rows: [{ label: "Remove Certificate", onClick: () => removeSiteCertificate() }] }]),
    help: () => helpGroup(),
  };
  showSigningPage(el, signingLayout({ mode: "site", certificate: ready, staged, profile: split.profile.length > 0, ready,
    options: settings.sections().some((s) => s.page === "signing") }), parts);
  offerInstall(siteReady(id)); // F177: Install sent the user here: Install Now once ready
}
