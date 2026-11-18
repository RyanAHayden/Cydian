// Which tabs a build shows (task I2). The mode comes from core/settings.js detectMode(): "site", or the app's
// "jailbreak" or "sideload" build, which the shell sets as cydianNative.mode before any script runs
// (native/bridge.js). Every build shows every tab: Installed is the remembered apps (F30), Cydian itself and the
// user's own IPAs (F77) in the sideload app, not only dpkg's list (user 2026-11-17).

import { detectMode } from "./core/settings.js";

export const APT_ONLY_TABS = [];

export function tabsFor(tabs, mode = detectMode()) { // eslint-disable-line no-unused-vars
  return tabs.slice();
}
