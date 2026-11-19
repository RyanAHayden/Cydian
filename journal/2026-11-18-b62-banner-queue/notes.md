# B62: banners queue instead of replacing each other

## What was wrong
`nav/banner.js` kept one `current` banner and every `showBanner` hid it first. On launch the update check
("iFizBox X is out.", Upgrade, 8 s) finishes before the source refresh, so the refresh's "Source Failed to Refresh"
banner (palera1n on the iPhone 7) replaced it 2-3 s in. The update banner shows once per version per session, so it
did not come back.

## What changed (web/app/nav/banner.js only; no caller changed)
- `bannerQueue(present, { max })`: pure queue logic, no DOM, unit-tested. `showBanner` = one queue over `present`
  (the old drawing code, which now calls back when its slide-out animation ends).
- A new banner waits until the one up has gone (timer, tap, swipe, back from iOS), then slides in.
- `wait: true` banners (Press Open / Press Install) can't wait, because iOS's prompt is up now: they go up at once.
  A timed banner they push off goes back to the front of the queue and comes back afterwards with its full time.
  A pushed-off `wait` banner is dropped (a stale "Press …" makes no sense).
- A banner with the same title + message as one up or queued isn't added twice (repeated refresh failures don't pile
  up). Queue holds `MAX_WAITING` (3); more are dropped.
- The hide function `showBanner` returns works on a queued banner too: it takes it out of the queue.

Why the queue and not "put the update banner after the failure one" in home.js/essential-ui.js: the order on
launch depends on network timing, and any two banners can collide (import, signing, update). The queue fixes
every case in one place. home.js and essential-ui.js didn't need a change.

## Tests
`web/app/nav/banner.test.js`: two banners in a row both shown (update, then failure); a queued banner's hide and
twin dedupe; a Press banner preempts and the pushed-off one comes back; the queue's cap.

## iPhone 7 check
The 7 runs 0.9.7, the newest release, so there is no update banner. Instead of installing an older .deb I swapped
web files (memory: iphone7-no-altstore-source): my `nav/banner.js`, plus a phone-only copy of the installed
`essential-ui.js` with `appVersion` pinned to "0.9.6". Then I launched with `ifizbox://home` and took a shot every
~1.5 s:
- `b62-t1.png`, `b62-t3.png`: "iFizBox 0.9.7 is out." with Upgrade, its timer line running down (≈69% → ≈23%)
  while the refresh had already failed (Home's "1 Source Failed to Load" row is up in t2/t3).
- `b62-t5.png`: "Source Failed to Refresh / palera1n" comes after the update banner has run out.
- `b62-t8.png`: both gone.
Afterwards I put back the original files (grep confirms no `bannerQueue` / patch left) and closed iFizBox from the
switcher. Note: two separate `tools/ui-7.sh home` calls are too far apart to open the switcher. One
`ssh 7 'phonectl home; sleep 0.15; phonectl home'` works.

## Not verified
- I did not install a real older .deb: an older build would need a lower `native/VERSION`, and that file isn't
  B62's. Pinning `appVersion` in the web layer exercises the same banner code path.
- Upgrade was not tapped on the 7 while queued (B44's path is unchanged; the banner object is the same).
- The Press Open / Press Install preemption was checked only in node tests, not on a device (it needs an import link
  or a sideload install while another banner is up).
