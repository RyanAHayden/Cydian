# F209: route #installed/myipas in the jailbreak app

## What I did

- `web/app/screens/installed.js` `pageKind`: a path starting with `myipas` is now `"myipas"` in every mode (checked
  before the jailbreak branch, which used to send every non-root, non-`apps` path to browse.js → Not Found). The old
  non-jailbreak-only check below it is gone (it can't be reached now). The jailbreak app's root (dpkg), `apps`, the
  Wish List and app pages route as before.
- `installed.test.js`: the F77 test now expects `myipas` (also `ipa:…` and `apps` below it) in jailbreak mode, and
  that `#installed/apps` stays the Apps page.

## On the iPhone 7

Built the .deb from this worktree (0.9.7-1364, over 0.9.7-1352, which was from before F208), installed it with apt,
put `tiny-ifizbox.ipa` (a test fixture) in `/var/mobile/Documents/Tiny.ipa`, then opened `ifizbox://myipas` through `tools/ui-7.sh`
(screenshot `ref/7/screens/f209-myipas.png`).

- The Install IPAs page now opens (title, Add, Search Apps, Browse, My IPAs): no Not Found any more.
- **But the IPA in /var/mobile/Documents isn't listed.** `myipas.js` decides "site or phone library" with
  `localSigning()`, which is true only in the sideload build, so the jailbreak app runs the website's version of the
  page (IndexedDB, "kept in this browser"), and its empty-list text offers AltStore/SideStore/Feather, which the jailbreak
  build shouldn't show. The native side is ready: `Bridge.swift` registers SignBridge, and so MyIPAs' `library.*`, in
  every build. Fixing it means changes to myipas.js (and maybe its wording in core/myipas.js), which are outside this
  task's files, so I filed **F212** for it.
- Afterwards I removed Tiny.ipa from the phone again. The new build stays installed (docs/iphone7.md: leave
  iFizBox installed, newer builds go over it).

## Not verified

- F208's swipe/Edit/hold/multi-delete on the phone: the list had no rows to act on, because the jailbreak app doesn't
  read Documents yet (F212).
- Home's Install IPAs tile: `home.js ipasTile` returns null in the jailbreak app, so there is no tile to tap. I
  reached the page through `ifizbox://myipas` instead. Whether to add the tile is in F212.
