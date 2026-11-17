# F36: second tap on the Search tab at its root focuses the field

## What I did
- `web/app/nav/tabbar.js`: `tapTab(tab, current, { selectTab, reselect })`. Current tab at its root and the screen
  has `reselect` -> call it; otherwise `selectTab` (switch tab, or pop to root as before). Synchronous throughout.
- `web/app/screens/search.js`: keeps the root page's `<input>` and exports `reselect()`, which calls
  `input.focus()` (returns false if there is no root field in the DOM yet).
- `web/app/app.js`: the tab bar's click handler calls `tapTab` with `SCREENS[tab].reselect`, so `focus()` runs
  inside the click handler itself, with no await or timer before it, which is what iOS needs before it shows the
  keyboard. Other screens can opt in later by exporting `reselect` (for example, scroll to top).
- `web/app/nav/tabbar.test.js`: node tests. A tap at root calls reselect (synchronously, route left alone); below
  root it pops first and the next tap focuses; another tab or no reselect -> select; Search's reselect is a no-op
  before render.

## Checked
- Headless Chromium over CDP against the Flask server (real mouse events on the tab item): on `#/search`, a tap
  focuses the search input; from `#/search/package:…` the first tap pops to `#/search` without focusing, the
  second focuses; from Home a tap switches to Search without focusing. (8080 and 9333 were taken by other programs
  on this machine, so I used ports 8473/9471. The scripts were scratch files and are not committed.)

## Not verified
- **The keyboard on a real iPhone.** The brief asks for a hand check. This was an unattended run with no iPhone
  attached (the 4S runs iOS 6 Safari, which can't run this ES-module app), so nobody has watched the keyboard come
  up. To check: on an iPhone (Safari and the Home Screen web app), open Search, tap the Search tab again, and the
  keyboard should appear. Also try it after popping back from a package page.
