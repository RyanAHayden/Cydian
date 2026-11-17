// Where web/app/ runs: "web" (the site), or the app's "jailbreak" or "sideload" build (task I2). The app sets
// globalThis.cydianApp.mode before any script runs (native/Sources/App.swift); the bridge's app.info says the same.
// Sideload mode has no apt or dpkg, so the tabs that need them are left out.

export const MODES = ["web", "jailbreak", "sideload"];

// Tabs that only mean something with dpkg's status behind them. Changes stays: on the site it shows the sources'
// changes, and in the sideload build I3 fills it with app updates.
export const APT_ONLY_TABS = ["installed"];

export function getMode(g = globalThis) {
  const m = g?.cydianApp?.mode;
  return MODES.includes(m) ? m : "web";
}

export function tabsFor(tabs, mode = getMode()) {
  return mode === "sideload" ? tabs.filter((t) => !APT_ONLY_TABS.includes(t)) : tabs.slice();
}
