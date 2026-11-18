# F156: help, guides and credits stay open on the locked website

## What I did
- `web/app/screens/home.js`: Home's link list is now locked row by row, not group by group. The new
  `openWhileLocked(href)` says which rows stay open: Settings, `home/help`, `home/guides/*` and `home/credits`.
  `lockHomeLinks(groups, links)` puts `.home-locked` on each locked row's `li`, or on the whole group when every row
  in it is locked. The help group is mixed: Upgrading & Jailbreaking Help is open, Find Extensions for Applications
  and More Package Sources are locked. The browse, IPA, state and locked Featured rows stay locked as before.
- The tap handler moved into `askOnLocked(box, ask)` without changing what it does, so the test runs the real code.
- Deep links: nothing in the router or in Home's `render()` checks the lock. Only locked rows, locked tabs (app.js)
  and Settings' padlocked row ask. So `#/home/help`, `#/home/guides/*` and `#/home/credits` already opened without the
  alert. No code change was needed there, and a test now pins it.
- home.css needed no change: its `.home-locked .cell-…` selectors match a locked `li` as well as a locked group.
- `web/app/screens/homelock.test.js`: draws `grouped(homeLinks())` in a fake DOM and locks it. It checks that the
  seven open rows have no `.home-locked` ancestor and their taps don't ask, and that the two locked rows have one and
  their taps ask. It also checks the routes `openWhileLocked` lets through, and that no route gate exists.

## Tried and failed
- My first test imported home.js after setting the fake `document`. signing.js then ran its stylesheet code against
  the fake document, which has no `head`, and crashed. Fixed by importing the modules at the top of the test.

## Not verified
- I didn't look at it in a browser. The padlock and dimming on a single `li` inside a group that mixes open and
  locked rows (the help group) is checked by CSS selector only. No render was taken because this run has no
  browser session or screenshot step for the site.
