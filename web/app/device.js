// This iPhone, for "Works on my phone" (F17; the rules are core/compat.js). The iOS version comes from the bridge in
// the app (Bridge.swift app.info `ios`) and on the site from the user agent, unless Settings > iOS Version picks one;
// the jailbreak type is the Architecture setting's. Both stay on the device (core/settings.js). The worker's catalog
// hears every change (catalog.setDevice), so lists, Search and Changes follow the Works on My Phone switch.
//
//   currentDevice()          -> { ios: "16.5" | null, jailbreak: "rootless" | "rootful" | "none" (sideload build) }
//   compatFilterOn()         -> whether rows that can't work are hidden (on by default)
//   filterRow(onChange)      -> the "Works on My Phone" switch row for the Sections page and Search
//   compatBadge(code)        -> a row badge's text, or "" when the row was not judged
import { plain } from "./nav/ui.js";
import { getArch } from "./backend.js";
import { catalog } from "./catalog.js";
import { settings, createSwitch } from "./screens/settings.js";
import { iosFromUserAgent, jailbreakOfArch, badge, normalizeDevice } from "./core/compat.js";

let nativeIos = null; // the app's own answer, once app.info came back

// The sideload build runs on phones without a jailbreak: debs never fit there, apps do (core/compat.js).
export function deviceFrom({ setting = "auto", nativeIos: fromBridge = null, userAgent = "", arch, mode = "site" } = {}) {
  const ios = setting && setting !== "auto" ? setting : fromBridge || iosFromUserAgent(userAgent);
  return normalizeDevice({ ios, jailbreak: mode === "sideload" ? "none" : jailbreakOfArch(arch) });
}

export function currentDevice() {
  return deviceFrom({
    setting: settings.isShown("iosVersion") ? settings.get("iosVersion") : "auto",
    nativeIos,
    userAgent: globalThis.navigator?.userAgent ?? "",
    arch: getArch(),
    mode: settings.mode,
  });
}

export const compatFilterOn = () => settings.get("worksOnMyPhone") === true;

export const compatBadge = (code) => (code ? badge(code, currentDevice()) : "");

// "iOS 16.5 · Rootless", or "iOS unknown · Rootless".
export function deviceLabel(d = currentDevice()) {
  const jb = d.jailbreak === "none" ? "Not Jailbroken" : d.jailbreak.charAt(0).toUpperCase() + d.jailbreak.slice(1);
  return `${d.ios ? `iOS ${d.ios}` : "iOS unknown"} · ${jb}`;
}

const send = () => catalog.setDevice(currentDevice(), { filter: compatFilterOn() });

// The switch row: a one-row plain table with the device under the label, above the Sections list and Search's
// results. `onChange()` runs after the setting changed and the catalog heard it, for the page to redraw its list.
// The version and jailbreak type are changed in Settings (Works on My Phone, Sources > Architecture).
export function filterRow(onChange = () => {}) {
  const ul = document.createElement("ul");
  ul.className = "table plain compat-filter";
  ul.append(plain([{ rows: [{ label: "Works on My Phone", subtitle: deviceLabel() }] }]).firstChild);
  const cell = ul.querySelector(".cell-inner");
  cell.classList.add("has-switch");
  const makeSwitch = () => createSwitch({
    label: "Works on My Phone", checked: compatFilterOn(),
    onToggle: (on) => { if (compatFilterOn() !== on) settings.set("worksOnMyPhone", on); },
  });
  let sw = makeSwitch();
  cell.append(sw);
  // Any change (this switch, Settings, the Architecture) redraws the page; a row left behind unsubscribes.
  const off = settings.onChange((key) => {
    if (!["worksOnMyPhone", "iosVersion", "arch"].includes(key)) return;
    if (!ul.isConnected) { off(); return; }
    ul.querySelector(".cell-subtitle").textContent = deviceLabel();
    if ((sw.getAttribute("aria-checked") === "true") !== compatFilterOn()) { const next = makeSwitch(); sw.replaceWith(next); sw = next; }
    onChange();
  });
  return ul;
}

let wired = false;
export function initDevice() {
  if (wired) return;
  wired = true;
  send();
  settings.onChange((key) => { if (["worksOnMyPhone", "iosVersion", "arch"].includes(key)) send(); });
  const n = globalThis.cydianNative;
  if (n?.call) {
    n.call("app.info", {}).then((info) => {
      if (typeof info?.ios === "string" && info.ios) { nativeIos = info.ios; send(); }
    }).catch(() => {});
  }
}
