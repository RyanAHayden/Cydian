# C12 Shared small helpers instead of per-screen copies

## What changed

1. **`note(text)`** in `web/app/nav/ui.js` (`<p class="empty">`). Removed the copies in `screens/changes.js`,
   `installed.js` and `myipas.js`, and switched every inline `el("p", "empty", …)` and
   `Object.assign(document.createElement("p"), { className: "empty", … })` in `screens/` (manage, home, altstore,
   browse, sources, myipas) to it. Browse's searchable list kept a local variable named `note` for its hidden note:
   renamed it `none` there so it can call the import. `installed.js`'s `installIpasNote(…, "empty")` is a different
   helper (a note with a link inside) and stays.
2. **`alertOK(title, message, alert = showAlert)`** in `web/app/nav/alert.js`. account.js and settings.js use it
   as before; signed-apps.js passes its injected `alert` as the third argument (it was the first argument before).
3. **`selectButton()`**: My IPAs' and Installed > Apps' were the same flow (something picked: deselect, no sheet;
   else a preset sheet, then the preset's rows replace the selection; Cancel: null). Only the state differs (My IPAs
   steps its list controller, Installed sets `view.selected` and syncs). Shared as `selectPreset({ selecting,
   options, apply, clear, sheet })` in `web/app/nav/selection.js`; both screens keep their exported `selectButton()`
   (tests and the bar buttons call it) as a thin wrapper. One small difference folded in: Installed's copy didn't
   guard against a sheet index past the options (it would have thrown); the shared one returns null like My IPAs'.

Check: `grep -rn "function note\|const note = (\|const alertOK\|async function selectPreset" web/app` shows one
definition each. `node --test web/app/screens/ web/app/nav/`: 728 pass. `node --check` on every changed file.

## Tried and failed

none

## Not verified

- No visual check on a phone or in a browser: the change is meant to produce the same DOM (same `p.empty` element,
  same alert options), and the screen tests cover the selection flows and signed-apps alerts. The iPhone 7 wasn't
  in this task's scope.
