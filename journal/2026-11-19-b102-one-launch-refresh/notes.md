# B102: one launch refresh on the website

## Problem
On the website, F250's `refreshOnLaunch` (Changes' Reloading Data job) ran on every unlocked launch, and app.js
also ran `SCREENS.sources.refreshInBackground` when the visitor had turned Settings > Refresh Sources on Launch on:
two refreshes of the same sources at once.

## Decision
The website keeps F250 only: it refreshes every unlocked launch whatever the setting says. Why not "F250 honours
the setting": the setting defaults off on the site, so F250's own behaviour (the site refreshes by itself, Browse
Anyway / launch) would silently stop for everyone. The app and native shells keep the setting's quiet background
refresh and never run F250's.

## What changed
- `web/app/websign-gate.js`: `siteRefreshesItself({mode, win})` (plain website, no app/native bridge) and
  `launchRefresh({...})`, which picks the one path: site -> `refreshOnLaunch`, else the setting -> `background`.
- `web/app/app.js`: the separate `refreshOnLaunch(...)` call is gone; `refreshAtOpen()` (launchRefresh) runs at
  launch and on a fresh open back from the background (Return to Home After). Side effect: on the site, a fresh
  open after the Return to Home After delay now runs F250's refresh again (the comment there already called it
  "the launch refresh again"); before, the site only did that when the setting was on.
- `web/app/websign-launch-refresh.test.js`: site with setting on/off -> one F250 refresh and no background one;
  locked Home -> none; app/shells -> only the setting's; app.js only starts launch refreshes through launchRefresh.

## Follow-up filed
The Refresh Sources on Launch toggle still shows on the website but no longer does anything there (settings.js,
not this task's files): filed to hide it on the site.

## Not verified
- Not run in a browser or on a phone: the wiring in app.js is checked by the source test and `node --check`, the
  logic by unit tests. No browser session was needed to show the double refresh is gone, but a real site launch
  with the setting on was not watched.
