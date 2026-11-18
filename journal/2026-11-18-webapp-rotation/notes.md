# Home Screen web app: landscape and back broke the layout (iPhone 7, iOS 15.8.8)

What happens (measured with an on-screen readout in a test web clip served over `ssh -R`):

- Fresh launch, portrait, opaque `black` status bar: `innerHeight` 647, `documentElement.clientHeight` 647.
- After landscape and back: `innerHeight` 647 but `clientHeight` 667. The web clip's view is screen-tall again but still
  starts 20pt below the status bar, so its bottom 20pt hang off the screen. Fixed bars are laid out in 667: the tab
  bar is cut off at scroll 0, and the 20pt overflow makes the whole document natively scrollable (nav bar included)
  despite `overflow: hidden`; iOS itself scrolls it (seen at 20 and 46) about a second after the rotation.
- `env(safe-area-inset-top)` stays 0 throughout; the view never goes under the status bar.

Tried and rejected:

- Re-setting the viewport meta: `clientHeight` stays 667.
- `location.reload()`: still 667 after the reload (the state is in the web clip's view, not the page).
- `black-translucent`: worse; a fresh launch already has a 647pt view and a black 20pt band under the tab bar.

Fix (theme-boot.js, style.css `--safe-bottom`): in the Home Screen app, portrait, `gap = clientHeight - innerHeight`
becomes `--vgap`, added to every bottom inset; `html` gets the visible height and the document is kept at scroll 0.
Checked on the phone after rotating, dragging, opening a subpage and going back.

Testing a status-bar style needs the icon re-added (iOS reads the meta at Add to Home Screen).
