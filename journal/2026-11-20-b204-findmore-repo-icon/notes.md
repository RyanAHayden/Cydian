# B204: Find More repo page, broken head icon

## Cause
`renderRepo` (screens/findmore.js) puts `source-icon.js`'s `<img>` into the head row's `.cell-icon`, but that row
has class `find-head`, not `source-row`. The sizing/clipping rules in sources.css (`.source-row .cell-icon img`:
absolute, inset 0, 100%, cover, hidden until `.loaded`) never applied, so the icon drew at its natural size,
out of the 29px slot, under and over the title and URL. The grey square was the letter slot's background with
the letter covered by the oversized image; Find More's list rows were fine (they get `source-row`).

## Fix
sources.css, Find More section: the same rules for `.find-head .cell-icon` (relative, overflow hidden) and its
`img` (absolute, inset 0, 100%, object-fit cover); in the look-only stretch, white behind the icon and
`opacity: 0` until `.loaded`. A failed icon: source-icon.js removes the `<img>` when no URL answers, and until it
loads it is invisible, so the letter shows. findmore.test.js checks the head row keeps its slot and the CSS rules.

## Checked
3x headless-Chromium renders of the repo page (`renderRepo` with a fake Canister API; fake `/api/fetch`
answering a 180x180 green-blob PNG for Packix's CydiaIcon.png, 404 for the other repo):
- before (main's files): grey square, green blob spilling below over the URL, a white dot over the "x" of Packix:
  the user's report reproduced.
- after: Packix's icon clipped in the slot, title and URL clear of it; the no-icon repo shows the "N" letter.
Harness: a throwaway node server in the session scratchpad (not committed). Tried first on ports 8731/8732:
another process on the machine held them, and my server crashed on a directory request (headers sent twice);
fixed the harness and moved to 47913.

## Not verified
- Not seen on a real phone (the iPhone 7 .deb or the Lite IPA): the task asked for a 3x render, and the bug is
  pure CSS that Chromium renders the same way.
- Not rendered under the iOS 7 / iOS 13 looks: the layout rules are outside the look-only stretch, so they apply
  in every look; the white backing and hide-until-loaded are iOS 6 look-only, matching `.source-row`'s.
