# B24: holding a package row lifted a broken drag preview

## What I did

- `web/app/style.css`: `a, img { -webkit-user-drag: none; }`, right after the `button` reset. Every package row is
  an `<a>` (browse.js `createRow`), and WebKit starts a link drag on a long press even with
  `allowsLinkPreview = false` and `-webkit-touch-callout: none`. The rule is global, so it covers every list, the
  icons inside the rows and any other link or image. I left browse.js alone (`draggable=false` isn't needed with
  the CSS rule).

## Checked on the iPhone 7 (iOS 15.8.8, iFizBox 0.9.1-1044 installed), under the ui-7 lock

- **Before** (`before-hold.png`, shots 0.7 s apart during a 5 s hold on the "openssh" row in Search for "open"):
  a black rounded box with the row drawn skewed, as in IMG_0007. Reproduced.
- **After:** I put the patched style.css into `/var/jb/Applications/Cydian.app/web/` (the installed 0.9.1 copy
  was byte-for-byte the same as HEAD's, so only this rule changed) and restarted the app. Same hold
  (`after-hold.png`): the row just shows its blue pressed state, no lifted preview. Letting go opens the package
  page, the same as a UITableView row selecting on touch-up.
- Tap and scroll still work: a flick scrolled the results list, a tap on a row opened its package page.
- Afterwards I put the original style.css back and restarted the app, so the phone matches its installed package again.
  I tapped "Later" on the 0.9.2 update popup and installed nothing.

## Tried / notes

- A `phonectl swipe X Y X Y 5` (a swipe that doesn't move) works as a long press. Screenshots taken while it runs in
  the background show the hold as it happens.
- This worktree's `ref` symlink still pointed at `~/repos/Cydian` (the old name). I pointed it at the current
  common dir again (it's gitignored).

## Not verified

- I didn't build or install the real .deb with the fix: I tested by swapping the one CSS file in the installed app.
  The rule ships the same way through `native/build.sh`, which copies web/app as it is.
- The public website in Safari (it has the same link-drag behaviour on iPhones): I only tested the app's WKWebView.
- Other lists (Installed, Changes, section lists) weren't held on the phone. They use the same `<a>` rows and the
  rule is global.

## Gate fix (not B24's own work, but `done` needs a green gate)

The first `done` failed in `tools/test_release.py` `test_repo_and_source`, which has nothing to do with this
change. Main's 0.9.2 release filled `web/app/source.json` to 20 versions, and `tools/altsource.py` keeps at most
`KEEP = 20` (the new one plus 19 older), so the test's "all old versions kept" list was one too long. The test now
caps its expected list at `altsource.KEEP - 1`, the same as the tool does.
