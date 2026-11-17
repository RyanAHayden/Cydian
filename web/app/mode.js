// Which tabs a build shows (task I2). The mode comes from core/settings.js detectMode(): "site", or the app's
// "jailbreak" or "sideload" build, which the shell sets as cydianNative.mode before any script runs
// (native/bridge.js). Sideload mode has no apt or dpkg, so the tabs that need them are left out.

import { detectMode } from "./core/settings.js";

// Tabs that only mean something with dpkg's status behind them. Changes stays: on the site it shows the sources'
// changes, and in the sideload build I3 fills it with app updates.
export const APT_ONLY_TABS = ["installed"];

export function tabsFor(tabs, mode = detectMode()) {
  return mode === "sideload" ? tabs.filter((t) => !APT_ONLY_TABS.includes(t)) : tabs.slice();
}
