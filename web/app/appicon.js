// F323: the app icon, in the native builds: the shell's Home Screen icon follows the theme (Settings > Theme >
// App Icon), and the page shows the icon the app has now (Home's header, Theme > Light / Dark's preview).
//
//   tellIcon("dark")          after the theme changes: app.icon {light, dark, onScreen} to the shell (once per change)
//   iconImage(img, "current") keeps an <img> on an icon: "current" (the tone on screen), "light" or "dark"
//   refreshIcons()            repaints every such <img> (screens/settings.js applyTheme calls it)
//
// The icons themselves are the shell's: ifizbox://app/appicon/<icon>.png (native/build.sh AppIconThumbs, Bridge.swift
// AppScheme), the Lite build's with its sash. On the website none of this runs: it keeps its WEB icon.
import { settings } from "./settings-store.js";
import { iconFor, iconState } from "./core/settings.js";
import { nativeBridge, hasNativeCall } from "./native.js";
import { iosFromUserAgent } from "./core/compat.js";
import { clearOffered } from "./core/settings.js";

// Whether Theme > App Icon's grid offers Clear on this phone (iOS 18+; the web view's user agent carries iOS's version).
export const clearHere = (ua = globalThis.navigator?.userAgent) => clearOffered(iosFromUserAgent(ua));

export const nativeIcons = (s = settings) => Boolean(nativeBridge()) && s.isShown("iconMatch");
export const iconSrc = (name) => `appicon/${name}.png`;

const toneOnScreen = () => (globalThis.document?.documentElement?.dataset.theme === "dark" ? "dark" : "light");
const get = (k) => settings.get(k);

// The icon a slot shows: "current" the tone on screen's, "light" / "dark" that tone's.
export function iconOf(slot, read = get, onScreen = toneOnScreen()) {
  return iconFor(slot === "light" || slot === "dark" ? slot : onScreen, read);
}

export function iconImage(img, slot = "current") {
  img.dataset.appicon = slot;
  img.src = iconSrc(iconOf(slot));
  img.removeAttribute("srcset");
  return img;
}

export function refreshIcons(doc = globalThis.document) {
  for (const img of doc?.querySelectorAll?.("img[data-appicon]") ?? []) {
    if (!img.dataset?.appicon) continue;
    const src = iconSrc(iconOf(img.dataset.appicon));
    if (img.getAttribute("src") !== src) img.src = src;
  }
}

// The message app.icon takes, for the tests and tellIcon.
export const iconMessage = (read, onScreen) => ({ method: "app.icon", params: iconState(read, onScreen) });

let lastSent = "";
export function tellIcon(onScreen, s = settings, native = nativeBridge()) {
  if (!nativeIcons(s) || !hasNativeCall(native)) return false;
  const { method, params } = iconMessage((k) => s.get(k), onScreen);
  const key = JSON.stringify(params);
  if (key === lastSent) return false;
  lastSent = key;
  Promise.resolve(native.call(method, params)).catch(() => { lastSent = ""; }); // an older shell, or not active yet
  return true;
}
export const resetTold = () => { lastSent = ""; };
