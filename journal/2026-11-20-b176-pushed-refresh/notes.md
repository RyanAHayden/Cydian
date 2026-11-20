# B176: pushed Sources / Changes keep Refresh

## Decision
Refresh goes to the right end of the bar on a pushed copy (Back keeps the left, as on every pushed page). I did not
make the link start a refresh on open: the green tile's Loading Sources already has a run going, and What's New is
a plain look at Changes, so an automatic refresh there would be a surprise; a button covers every entry point.

Pushed Sources would have had Back + Add + Manage + Refresh beside the title, too wide for a 320-375 pt bar, so
its Add is left out of the pushed copy (Manage has its own Add). On its own tab Sources is unchanged. Pushed
Changes shows Upgrade (N) then Refresh; on the website (no Upgrade) only Refresh.

## What changed
- `web/app/nav/navbuttons.js` (new): `navButtons(info, pushed)` picks the bar's buttons. A left spec with
  `pushed: "right"` moves right when pushed (flagged `moved`, class `nav-moved`); a right spec with `pushed: false`
  is dropped when pushed. Screens without these fields behave as before (Home's About still gives way to Back).
- `app.js` makePage uses it.
- `sources.js` / `changes.js` nav: the flags. `changes.js` drawUpgradeButton now skips `.nav-moved`, otherwise on
  the website (no Upgrade button) it would have relabelled the pushed copy's Refresh as "Upgrade" and hidden it.
- `web/app/nav/navbuttons.test.js`.

## Tried and failed
nothing.

## Not verified
- No render or phone check of the pushed bar's width (Back "Home"/"Help" + "Sources" + Manage + Refresh): no
  screenshot run in this session; the layout is reasoned from button widths only. A long Back label truncates with
  "…" (style.css .nav-left), so the bar should not overflow.
- Refresh tapped on the pushed copy wasn't exercised in a browser; it calls the same `refresh(ctx)` as the tab's.
