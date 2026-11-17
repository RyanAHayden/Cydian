// Settings: what each one is, which mode shows it, its default, and where it lives on the device. Pure JS, no DOM:
// the Settings tab (screens/settings.js) draws what `visible()` returns, and the rest of the app reads values with
// `get()`. Both modes and the site run this same file, so a setting means the same everywhere.
//
//   const s = createSettings({ mode: detectMode() });
//   s.get("appearance");            // "auto" | "light" | "dark"
//   s.set("appearance", "dark");    // stored at localStorage["cydian.appearance"], listeners told
//   s.onChange((key, value) => …);  // returns an unsubscribe function
//   s.sections();                   // [{ id, title, footer, settings: [def…] }], only the rows this mode shows
//   s.holds.set("com.example.tweak", true);  // Ignore upgrades, kept on the device (jailbreak: also a dpkg hold)
//   await s.holds.sync();                    // jailbreak: take dpkg's holds (apt-mark showhold) as the list
//   s.hiddenSections.set("Themes", true);    // Section Visibility (F24): listeners hear ("hiddenSections", list)
//
// Every value is stored as a string under `cydian.<key>`, so backend.js getArch() keeps reading `cydian.arch`.
// A stored value that is not one of the setting's options reads as the default (a hand-edited or older value
// never breaks the app).
//
// A row only shows once the feature it controls exists (user 2026-11-17). FEATURES lists the ones that do; the task
// that builds a feature adds its name here, and its row appears. Each def names its `feature`.

import { ARCHES, DEFAULT_ARCH } from "./apt.js";
import { IOS_VERSIONS } from "./compat.js";

export const MODES = ["site", "jailbreak", "sideload"];

// Features that exist today. "appearance": this task's theme. "sources": the source list and its refresh (F4).
// "holds": Ignored Upgrades (F7's upgrades list leaves them out; the helper's apt-mark side is F22's).
// Still to come, by the setting that waits on it: "update-check" (Check for updates), "cellular" (Use cellular
// data, app only), "notifications" (Notifications), "badge" (App icon badge), "auto-install" (the three
// automatic-install rows), "rollback" (Keep previous versions), "resign" (Re-sign reminder, F14).
// "compat": Works on My Phone (F17). "device": Device type and Sideloader (F37).
export const FEATURES = new Set(["appearance", "sources", "holds", "compat", "device"]);

const BOTH = ["jailbreak", "sideload"];
const ALL = ["site", ...BOTH];
const onOff = [{ value: false, label: "Off" }, { value: true, label: "On" }];

export const SECTIONS = [
  { id: "appearance", title: "Appearance" },
  { id: "device", title: "Device" },
  { id: "sources", title: "Sources" },
  { id: "compat", title: "Works on My Phone" },
  { id: "updates", title: "Updates" },
  { id: "notifications", title: "Notifications" },
  { id: "automatic", title: "Automatic Installs" },
  { id: "signing", title: "Signing" },
];

// kind: "choice" (one row per option, the chosen one checked), "toggle" (a switch), "list" (pushes a page that
// picks one option; its footer shows there), "holds" (pushes the held packages). `default` is a value, or a function of the mode.
export const SETTINGS = [
  {
    key: "appearance", section: "appearance", kind: "choice", feature: "appearance", modes: ALL, default: "auto",
    label: "Appearance",
    options: [{ value: "auto", label: "Automatic" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
    footer: "Automatic follows the iPhone's own Light or Dark setting.",
  },
  {
    key: "allowZoom", section: "appearance", kind: "toggle", feature: "appearance", modes: ALL, default: false,
    label: "Allow Zoom", options: onOff, footer: "Lets you pinch to zoom, for screenshots. Off, the app stays at its own size.",
  },
  {
    // F37: what kind of iPhone this is. The site only: the jailbreak app takes it from the bridge (deviceType) and
    // the sideload build is always Not Jailbroken. Not Jailbroken hides APT sources, tweaks and themes everywhere
    // and lists AltStore-style apps (F9); an arch here is also written to `arch`, where backend.js getArch() reads it.
    key: "device", section: "device", kind: "list", feature: "device", modes: ["site"], default: "none",
    label: "Device",
    options: [
      { value: "none", label: "Not Jailbroken", subtitle: "Apps from AltStore-style sources" },
      { value: "iphoneos-arm64", label: "Jailbroken (Rootless)", subtitle: "iphoneos-arm64: Dopamine, palera1n rootless" },
      { value: "iphoneos-arm", label: "Jailbroken (Rootful)", subtitle: "iphoneos-arm: palera1n rootful, older jailbreaks" },
    ],
    footer: "Not Jailbroken lists apps from AltStore-style sources. Jailbroken also lists tweaks and themes from APT sources, built for this architecture.",
  },
  {
    // F37: where an app's GET goes on a phone without a jailbreak. Never through a server of ours. The site only:
    // the sideload build signs and installs on the phone itself (F14).
    key: "sideloader", section: "device", kind: "list", feature: "device", modes: ["site"], default: "feather",
    label: "Sideloader",
    options: [
      { value: "feather", label: "Feather", subtitle: "Signs on the phone with your certificate" },
      { value: "altstore", label: "AltStore", subtitle: "Signs with your Apple ID" },
      { value: "sidestore", label: "SideStore", subtitle: "Signs with your Apple ID, no computer" },
      { value: "download", label: "Download .ipa", subtitle: "Save the file and open it yourself" },
    ],
    footer: "GET on an app opens it in this app, which signs and installs it on your iPhone.",
  },
  {
    // The architecture APT packages are listed for, kept for backend.js getArch() (`cydian.arch`). No row of its
    // own since F37: Device sets it on the site, the bridge in the jailbreak app.
    key: "arch", section: "sources", kind: "list", feature: "sources", modes: [], default: DEFAULT_ARCH,
    label: "Architecture",
    options: [
      { value: "iphoneos-arm64", label: "Rootless", subtitle: "iphoneos-arm64: Dopamine, palera1n rootless" },
      { value: "iphoneos-arm", label: "Rootful", subtitle: "iphoneos-arm: palera1n rootful, older jailbreaks" },
    ],
  },
  {
    key: "worksOnMyPhone", section: "compat", kind: "toggle", feature: "compat", modes: ALL, default: true,
    label: "Works on My Phone", options: onOff,
    footer: (mode) => "Hides packages that say they don't work on this iPhone's iOS version or jailbreak type"
      + (mode === "site" ? " (set under Device)." : ".") + " Packages that don't say are kept.",
  },
  {
    // F35: the check, X or ? beside every package in lists, Search and the package page.
    key: "compatMarks", section: "compat", kind: "toggle", feature: "compat", modes: ALL, default: true,
    label: "Show Compatibility Marks", options: onOff,
    footer: "A green check beside packages that work on this iPhone, a red X beside those that don't, a grey ? where the package doesn't say.",
  },
  {
    // The site's picker (F17): the app knows its iOS version from the bridge.
    key: "iosVersion", section: "compat", kind: "list", feature: "compat", modes: ["site"], default: "auto",
    label: "iOS Version",
    options: [{ value: "auto", label: "Automatic", subtitle: "From this browser" },
      ...IOS_VERSIONS.map((v) => ({ value: v, label: `iOS ${v}` }))],
    footer: "Packages are checked against this version. Automatic reads it from this browser.",
  },
  {
    key: "refreshOnLaunch", section: "sources", kind: "toggle", feature: "sources", modes: ALL,
    default: (mode) => mode !== "site", // the site fetches through our proxy: opt in there
    label: "Refresh Sources on Launch", options: onOff,
  },
  {
    key: "checkUpdates", section: "updates", kind: "list", feature: "update-check", modes: ALL, default: "launch",
    label: "Check for Updates",
    options: [
      { value: "off", label: "Off" }, { value: "launch", label: "On Launch" },
      { value: "6h", label: "Every 6 Hours" }, { value: "daily", label: "Daily" },
    ],
    footer: (mode) => mode === "sideload"
      ? "Looks for new versions of the apps you sideloaded."
      : "Looks for new versions of the packages you installed.",
  },
  { key: "cellular", section: "updates", kind: "toggle", feature: "cellular", modes: BOTH, default: true,
    label: "Use Cellular Data", options: onOff },
  {
    key: "holds", section: "updates", kind: "holds", feature: "holds", modes: ALL, label: "Ignored Upgrades",
    footer: (mode) => mode === "jailbreak"
      ? "Held with dpkg, so other package managers leave them alone too."
      : "Kept on this device.",
  },
  {
    key: "notifications", section: "notifications", kind: "list", feature: "notifications", modes: ALL, default: "summary",
    label: "Notifications",
    options: [{ value: "off", label: "Off" }, { value: "summary", label: "Summary" }, { value: "each", label: "One per Package" }],
  },
  { key: "badge", section: "notifications", kind: "toggle", feature: "badge", modes: ALL, default: true,
    label: "App Icon Badge", options: onOff },
  {
    key: "autoInstall", section: "automatic", kind: "list", feature: "auto-install", modes: ["jailbreak"], default: "off",
    label: "Install Updates Automatically",
    options: [{ value: "off", label: "Off" }, { value: "marked", label: "Only Packages I Mark" }, { value: "all", label: "Everything" }],
  },
  { key: "autoInstallIdle", section: "automatic", kind: "toggle", feature: "auto-install", modes: ["jailbreak"], default: true,
    label: "Only When Charging and Locked", options: onOff },
  {
    key: "respring", section: "automatic", kind: "list", feature: "auto-install", modes: ["jailbreak"], default: "notify",
    label: "After a Respring Update",
    options: [{ value: "notify", label: "Just Notify Me" }, { value: "locked", label: "Respring When Locked" }],
  },
  {
    key: "keepVersions", section: "automatic", kind: "list", feature: "rollback", modes: ["jailbreak"], default: 1,
    label: "Keep Previous Versions",
    options: [{ value: 0, label: "None" }, { value: 1, label: "1" }, { value: 2, label: "2" }],
    footer: "Cached .debs to roll back to.",
  },
  {
    key: "resignReminder", section: "signing", kind: "list", feature: "resign", modes: ["sideload"], default: 2,
    label: "Re-sign Reminder",
    options: [
      { value: 0, label: "Off" }, { value: 1, label: "1 Day Before" }, { value: 2, label: "2 Days Before" },
      { value: 3, label: "3 Days Before" }, { value: 7, label: "7 Days Before" },
    ],
    footer: "Reminds you before an app's signature expires.",
  },
];

const PREFIX = "cydian.";
const HOLDS_KEY = PREFIX + "holds";
const HIDDEN_SECTIONS_KEY = PREFIX + "hiddenSections";
const byKey = new Map(SETTINGS.map((d) => [d.key, d]));

// The architecture list in core/apt.js is the source of truth; the options above must cover it.
for (const a of ARCHES) if (!byKey.get("arch").options.some((o) => o.value === a)) throw new Error(`arch ${a} has no option`);
for (const a of ARCHES) if (!byKey.get("device").options.some((o) => o.value === a)) throw new Error(`arch ${a} has no device type`);

// F37: the device types. "none" is an iPhone without a jailbreak; the others are the APT architecture it installs.
export const NOT_JAILBROKEN = "none";
export const DEVICE_TYPES = byKey.get("device").options.map((o) => o.value);

// The jailbreak app's type from its bridge: `cydianNative.arch` ("iphoneos-arm64" | "iphoneos-arm") or
// `cydianNative.jailbreak` ("rootless" | "rootful"), whichever the shell detected; null when it says neither.
export function bridgeArch(native) {
  if (ARCHES.includes(native?.arch)) return native.arch;
  return { rootless: "iphoneos-arm64", rootful: "iphoneos-arm" }[native?.jailbreak] ?? null;
}

// The mode: the app's bridge says which build is running (I2 sets `cydianNative.mode`); a bridge without one is
// the N1 jailbreak shell; no bridge is the site.
export function detectMode(g = globalThis) {
  const n = g.cydianNative;
  if (!n) return "site";
  return MODES.includes(n.mode) && n.mode !== "site" ? n.mode : "jailbreak";
}

const resolve = (v, mode) => (typeof v === "function" ? v(mode) : v);

// Storage that never throws: Safari's private mode and a full quota both throw on setItem; settings then live
// for this session only.
function safeStorage(storage) {
  const mem = new Map();
  return {
    get(k) {
      try { const v = storage?.getItem(k); if (v != null) return v; } catch { /* unavailable */ }
      return mem.has(k) ? mem.get(k) : null;
    },
    set(k, v) {
      mem.set(k, v);
      try { storage?.setItem(k, v); } catch { /* unavailable: the memory copy stands */ }
    },
  };
}

// `helper` (jailbreak mode only): runs cydian-helper with the given words and resolves to { code, stdout }, e.g.
// helper(["hold", "com.foo"]). The app's bridge provides it as `cydianNative.helper` (N3); without one the holds
// stay a list on the device, as in the other modes.
// `native` (jailbreak mode): the bridge, for the detected jailbreak type (bridgeArch).
export function createSettings({ storage = globalThis.localStorage, mode = "site", features = FEATURES, helper, native = null } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  const store = safeStorage(storage);
  // F37: a site visitor who picked an Architecture before Device existed keeps it as their device type; the app's
  // detected type becomes `arch` for getArch().
  const detected = mode === "jailbreak" ? bridgeArch(native) : null;
  if (detected) store.set(PREFIX + "arch", detected);
  if (mode === "site" && store.get(PREFIX + "device") == null && ARCHES.includes(store.get(PREFIX + "arch"))) {
    store.set(PREFIX + "device", store.get(PREFIX + "arch"));
  }
  const listeners = new Set();

  function def(key) {
    const d = byKey.get(key);
    if (!d || !d.options) throw new Error(`unknown setting ${key}`);
    return d;
  }
  const defaultOf = (d) => resolve(d.default, mode);
  const shown = (d) => d.modes.includes(mode) && features.has(d.feature);
  const notify = (key, value) => { for (const f of listeners) f(key, value); };

  function get(key) {
    const d = def(key);
    const raw = store.get(PREFIX + key);
    const hit = raw == null ? null : d.options.find((o) => String(o.value) === raw);
    return hit ? hit.value : defaultOf(d);
  }

  function set(key, value) {
    const d = def(key);
    const hit = d.options.find((o) => o.value === value);
    if (!hit) throw new Error(`${key}: ${JSON.stringify(value)} is not one of its options`);
    store.set(PREFIX + key, String(value));
    notify(key, value);
    // Device (F37) carries the architecture: getArch() and everything listening for "arch" follow it.
    if (key === "device" && ARCHES.includes(value) && get("arch") !== value) set("arch", value);
  }

  // F37: "none" (no jailbreak) or the architecture APT packages are listed for. Site: the Device setting. Jailbreak
  // app: what the bridge detected, else the stored architecture. Sideload build: always "none".
  function deviceType() {
    if (mode === "sideload") return NOT_JAILBROKEN;
    if (mode === "jailbreak") return detected ?? get("arch");
    return get("device");
  }

  function readHolds() {
    try {
      const list = JSON.parse(store.get(HOLDS_KEY) || "[]");
      return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  function writeHolds(list) {
    store.set(HOLDS_KEY, JSON.stringify(list));
    notify("holds", list);
  }
  const dpkg = mode === "jailbreak" && typeof helper === "function" ? helper : null;
  async function run(words) {
    const r = await dpkg(words);
    if (!r || r.code !== 0) throw new Error(`cydian-helper ${words[0]} failed (exit ${r?.code})`);
    return r;
  }

  // Ignore upgrades, per package, on the device. In jailbreak mode with a helper the real hold is dpkg's
  // (apt-mark hold/unhold through cydian-helper, F22); this list is then the cache the row shows, set at once and
  // put right by `sync()` (apt-mark showhold) when the helper fails or something else changed the holds.
  const holds = {
    list: () => readHolds().sort(),
    has: (pkg) => readHolds().includes(pkg),
    // Resolves to true once the hold is in place (at once without a helper), false when dpkg refused it; the list
    // then shows dpkg's holds again (or the old list if showhold failed too).
    async set(pkg, on) {
      const before = readHolds().sort();
      const list = new Set(before);
      if (on) list.add(pkg); else list.delete(pkg);
      writeHolds([...list].sort());
      if (!dpkg) return true;
      try {
        await run([on ? "hold" : "unhold", pkg]);
        return true;
      } catch {
        try { await holds.sync(); } catch { writeHolds(before); }
        return false;
      }
    },
    replace(pkgs) {
      writeHolds([...new Set(pkgs.filter((p) => typeof p === "string"))].sort());
    },
    // Jailbreak with a helper: dpkg's holds become the list (told to listeners only when it changed). Elsewhere a
    // no-op. Resolves to the list; rejects when the helper fails, leaving the list as it was.
    async sync() {
      if (!dpkg) return holds.list();
      const { stdout = "" } = await run(["showhold"]);
      const held = [...new Set(String(stdout).split("\n").map((l) => l.trim()).filter((l) => l))].sort();
      if (JSON.stringify(held) !== JSON.stringify(holds.list())) writeHolds(held);
      return held;
    },
  };

  // Section Visibility (Cydia's Sections edit mode, F24): section names whose packages drop out of every list,
  // Search and Changes. Kept on this device only, as a sorted JSON list; core/catalog.js setHidden does the filtering.
  function readHidden() {
    try {
      const list = JSON.parse(store.get(HIDDEN_SECTIONS_KEY) || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((n) => typeof n === "string"))].sort() : [];
    } catch {
      return [];
    }
  }
  function writeHidden(list) {
    const sorted = [...new Set(list)].sort();
    if (JSON.stringify(sorted) === JSON.stringify(readHidden())) return;
    store.set(HIDDEN_SECTIONS_KEY, JSON.stringify(sorted));
    notify("hiddenSections", sorted);
  }
  const hiddenSections = {
    list: readHidden,
    has: (name) => readHidden().includes(name),
    set(name, hide) {
      const list = new Set(readHidden());
      if (hide) list.add(name); else list.delete(name);
      writeHidden([...list]);
    },
    replace: (names) => writeHidden((Array.isArray(names) ? names : []).filter((n) => typeof n === "string")),
  };

  return {
    mode,
    get,
    set,
    holds,
    hiddenSections,
    deviceType,
    jailbroken: () => deviceType() !== NOT_JAILBROKEN,
    defaultOf: (key) => defaultOf(def(key)),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    isShown: (key) => { const d = byKey.get(key); return Boolean(d && shown(d)); },
    visible: () => SETTINGS.filter(shown),
    sections: () => SECTIONS.map((s) => {
      const settings = SETTINGS.filter((d) => d.section === s.id && shown(d));
      const footers = settings.filter((d) => d.kind !== "list").map((d) => resolve(d.footer, mode)).filter(Boolean);
      return { ...s, settings, footer: footers.join(" ") || undefined };
    }).filter((s) => s.settings.length),
    footerOf: (key) => resolve(byKey.get(key)?.footer, mode),
  };
}

// The theme Appearance asks for, given whether the system is dark right now.
export function themeFor(appearance, systemDark) {
  if (appearance === "light" || appearance === "dark") return appearance;
  return systemDark ? "dark" : "light";
}
