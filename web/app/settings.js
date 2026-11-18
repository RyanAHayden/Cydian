// F65: the jailbreak app's side of N5's upgrade daemon (native/daemon/), wired up by app.js.
//
//   const up = createUpgradeNotices({ settings, native: globalThis.cydianNative, current: () => router.current() });
//   up.badge("changes", n);   // beside the tab badge: 0 while the Changes tab is on screen clears the icon badge
//   up.start();               // once at launch: Upgrade Notifications off reaches the daemon again
//
// The daemon sets iFizBox's icon badge to the upgrades it found. Once the Changes tab shows no upgrades (the
// user installed them, or ignored them), the page asks the shell to clear it (Notifications.swift app.badge, which
// also takes the "3 Upgrades" notification away). Only while the Changes tab is the one shown: a count of 0 worked out
// in the background, before the sources have loaded, would otherwise wipe a badge that is right. A zero counted
// while another tab is shown clears it when the user opens Changes.
// Elsewhere (the site, the sideload build) both do nothing.
import { detectMode, DAEMON_KEYS, DAEMON_LISTS } from "./core/settings.js";
import { parse } from "./router.js";

export function createUpgradeNotices({ settings, native = globalThis.cydianNative, current, win = globalThis.window } = {}) {
  // Both app builds: the jailbreak app's daemon counts in the background too, the sideload app counts here.
  const on = Boolean(native && typeof native.call === "function") && ["jailbreak", "sideload"].includes(detectMode({ cydianNative: native }));
  let count = null; // the Changes tab's last count
  let cleared = false; // the icon badge is 0 as far as we know (until the next count above 0)
  const onChanges = () => (current?.() ?? (win ? parse(win.location.hash) : null))?.tab === "changes";

  function clear() {
    if (!on || cleared || count !== 0 || !onChanges()) return false;
    cleared = true;
    Promise.resolve(native.call("app.badge", { count: 0 })).catch(() => { cleared = false; });
    return true;
  }

  return {
    // Same arguments as ctx.setBadge. Returns true when it asked the shell to clear the icon badge.
    badge(tab, n) {
      if (tab !== "changes") return false;
      const next = typeof n === "number" ? n : Number(n) || 0;
      // the app icon shows the count too (Settings > App Icon Badge), not only the daemon's background checks
      if (on && next > 0 && next !== count) Promise.resolve(native.call("app.badge", { count: next })).catch(() => {});
      // the icon's long-press menu offers Upgrade All while there are upgrades (sideload: native Shortcut)
      if (on && next !== count) Promise.resolve(native.call("app.shortcuts", { upgrades: next })).catch(() => {});
      count = next;
      if (count > 0) cleared = false;
      return clear();
    },
    // Returns true when it looked at the launch state (jailbreak app only).
    start() {
      if (!on) return false;
      win?.addEventListener?.("hashchange", () => setTimeout(clear, 0)); // after the router has moved
      if (settings?.isShown?.("upgradeNotifications") && settings.get("upgradeNotifications") === false) {
        settings.upgradeNotifications.sync().catch(() => {});
      }
      return true;
    },
  };
}

// F70: N7's daemon (native/daemon/) reads the automatic-install settings from the app's preferences
// (NSUserDefaults com.ryha.cydian), not from the web view's localStorage. The page hands them over through the
// shell's prefs.set {values: {"cydian.<key>": value | null}} (Bridge.swift Prefs; null removes the key): all of
// them once at launch, then each one as it changes.
//
//   createPrefsMirror({ settings, native: globalThis.cydianNative }).start();
//
// Jailbreak app only; elsewhere start() does nothing and returns false. A failed call is dropped: the next change
// or launch writes the values again.

export function createPrefsMirror({ settings, native = globalThis.cydianNative } = {}) {
  const on = Boolean(native && typeof native.call === "function") && detectMode({ cydianNative: native }) === "jailbreak";
  const send = (values) => Promise.resolve().then(() => native.call("prefs.set", { values })).catch(() => {});
  const watched = new Set([...DAEMON_KEYS, ...DAEMON_LISTS]);
  let started = false;
  return {
    start() {
      if (!on || !settings || started) return false;
      started = true;
      send(settings.daemonPrefs());
      settings.onChange((key) => { if (watched.has(key)) send(settings.daemonPrefs([key])); });
      return true;
    },
  };
}
