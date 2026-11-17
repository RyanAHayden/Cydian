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

export const title = "Settings";

// The one store the app uses (both modes and the site read it through here).
export const settings = createSettings({ mode: detectMode() });

// Light: the top of the blue status bar under the nav bar; dark: "Status Bar (Black)".
export const THEME_COLORS = { light: "#4f698b", dark: "#000000" };

const defOf = (key) => SETTINGS.find((d) => d.key === key);
const optionLabel = (d, v) => d.options.find((o) => o.value === v)?.label ?? String(v);

export function nav(route) {
  const key = route.path[0];
  if (key === "holds") return { title: "Ignored Upgrades" };
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
}

function draw({ el, route }) {
  const key = route.path[0];
  const top = el.scrollTop;
  if (key === "holds") el.replaceChildren(holdsPage());
  else if (key) el.replaceChildren(listPage(key));
  else el.replaceChildren(rootPage());
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

function makeSwitch(d) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "switch";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(settings.get(d.key) === true));
  b.setAttribute("aria-label", d.label);
  b.addEventListener("click", () => {
    const on = settings.get(d.key) !== true;
    b.setAttribute("aria-checked", String(on));
    settings.set(d.key, on);
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
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own = m.media.includes("dark") ? "dark" : "light";
    m.content = THEME_COLORS[appearance === "auto" ? own : theme];
  }
}

export function init() {
  applyTheme();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
  settings.onChange((key) => { if (key === "appearance") applyTheme(); });
}
