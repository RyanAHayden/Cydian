// F280: Push in Settings > Updates, the sideload build only (core/push.js, docs/push.md). F285: its rows sit in the
// Checking for Updates group (screens/settings.js notifySection, rows from notifyRows); this does what they do:
//   Push        a switch: on asks iOS for notifications (once) and a push token, and registers with the signing
//               server; off unregisters (the server deletes the token and the list) and is remembered, so Push never
//               turns itself on again (core/push.js autoEnablePush)
// SPDX-License-Identifier: GPL-3.0-or-later
import { showHUD } from "../nav/hud.js";
import { getServer } from "../signing-client.js";
import { pushInfo, enablePush, disablePush, setUserTurnedOff } from "../core/push.js";

export function pushActions({ native = globalThis.ifizboxNative } = {}) {
  const deps = () => ({ native, server: getServer() });
  return {
    info: () => pushInfo(deps()),
    async toggle(on) {
      setUserTurnedOff(!on);
      const hide = showHUD(on ? "Turning On" : "Turning Off");
      try { if (on) await enablePush(deps()); else await disablePush(deps()); } catch { /* the footer says */ }
      hide();
    },
  };
}
