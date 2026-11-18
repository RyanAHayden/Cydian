// F70: the package page's Update Automatically switch (screens/browse.js installedGroup), the per-package mark
// N7's daemon installs for when Install Updates Automatically is Only Packages I Mark (core/settings.js autoMarked,
// handed to the daemon as ifizbox.autoMarked). Pure JS.
export const AUTO_MARK_LABEL = "Update Automatically";
export const AUTO_MARK_FOOTER = "Update Automatically installs its updates by itself (Settings, Install Updates Automatically).";

// Shown only where the marks count: the jailbreak app, with its Automatic Installs rows, set to Only Packages I Mark.
export function autoMarkShown(settings) {
  return Boolean(settings?.isShown?.("autoInstall") && settings.get("autoInstall") === "marked" && settings.autoMarked);
}
