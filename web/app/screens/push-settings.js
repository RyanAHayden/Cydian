// F280: Settings > Updates > Push Notifications, the sideload build only (core/push.js, docs/push.md):
//   Push        a switch: on asks iOS for notifications (once) and a push token, and registers with the signing
//               server; off unregisters (the server deletes the token and the list)
//   Last Push   when the server last had a push accepted by APNs for this iPhone
//   Test Push   one push now
// When push can't work the group shows only the switch and a footer saying why (renamed by its signer, no
// aps-environment in the profile, notifications off, a server without an APNs key), and that update alerts still
// come from the background check.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { detectMode } from "../core/settings.js";
import { showHUD } from "../nav/hud.js";
import { alertOK } from "../nav/alert.js";
import { getServer } from "../signing-client.js";
import { pushInfo, pushRows, enablePush, disablePush, testPush } from "../core/push.js";
import { createSwitch } from "./settings.js";

export function pushSection({ mode = detectMode(), native = globalThis.ifizboxNative } = {}) {
  const box = document.createElement("div");
  box.className = "push-settings";
  if (mode !== "sideload" || !native?.call) return box;
  const deps = () => ({ native, server: getServer() });
  const redraw = () => box.replaceWith(pushSection({ mode, native }));
  pushInfo(deps()).then((view) => {
    const g = pushRows(view);
    const rows = g.rows.map((r) => (r.test ? { label: r.label, onClick: async () => {
      const hide = showHUD("Sending");
      const t = await testPush(deps());
      hide();
      alertOK(t.ok ? "Test Push Sent" : "Test Push Failed", t.text);
      redraw();
    } } : r.toggle ? { label: r.label } : r));
    const frag = grouped([{ ...g, rows }]);
    const li = frag.querySelector(".cell");
    const sw = createSwitch({ label: "Push", checked: g.rows[0].on, onToggle: async (on) => {
      const hide = showHUD(on ? "Turning On" : "Turning Off");
      try { if (on) await enablePush(deps()); else await disablePush(deps()); } catch { /* the footer says */ }
      hide();
      redraw();
    } });
    li?.querySelector(".cell-inner")?.append(sw);
    li?.querySelector(".cell-inner")?.classList.add("has-switch");
    box.replaceChildren(frag);
  }, () => {});
  return box;
}
