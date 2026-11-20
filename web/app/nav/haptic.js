// A light haptic tick. In the app: the bridge's "haptic.tap" (UIImpactFeedbackGenerator). In Safari there's no
// vibration API, but toggling a hidden <input type=checkbox switch> plays the system switch haptic (iOS 18+). Other
// browsers: navigator.vibrate. Must be called from a user gesture (pointerdown/touchstart), or iOS stays silent.

export function haptic() {
  const bridge = globalThis.webkit?.messageHandlers?.ifizbox;
  if (bridge && globalThis.ifizboxApp) {
    try { bridge.postMessage({ method: "haptic.tap" })?.catch?.(() => {}); return; } catch { /* fall through */ }
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) { navigator.vibrate(10); return; }
  if (typeof document === "undefined") return;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.append(input);
  document.body.append(label);
  label.click();
  label.remove();
}

// The app's bridge plays haptics (haptic() and hapticTick() reach UIKit); elsewhere only haptic()'s gesture fallbacks.
export const bridgeHaptics = () => Boolean(globalThis.ifizboxApp && globalThis.webkit?.messageHandlers?.ifizbox);

// The smallest tick there is: the bridge's "haptic.tick" (UISelectionFeedbackGenerator). App only; silent elsewhere,
// since the browser fallbacks can't play anything lighter than haptic().
export function hapticTick() {
  if (!bridgeHaptics()) return;
  try { globalThis.webkit.messageHandlers.ifizbox.postMessage({ method: "haptic.tick" })?.catch?.(() => {}); } catch { /* none */ }
}
