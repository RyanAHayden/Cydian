# F145: Website lock fixes

## What I did
1. **Browse Anyway redraws Home at once.** `screens/home.js` `followBrowseLock` (exported, tested): Home's root listens
   for `cydian:browse-lock` (websign-gate.js `setFirstVisit` fires it). When the lock flips from what the page was drawn
   with, it removes the root and runs `renderRoot` again, keeping the scroll position. This covers Browse Anyway from a
   locked Home row, a locked tab or Settings, and locking again with Settings' switch. The old in-place unlock (it
   removed classes on that one page only, so Browse Anyway from a locked tab left Home locked) is gone. The tab bar
   already followed the event (`app.js lockTabs`), so it needed no change.
2. **New place.** `screens/website-settings.js` `websiteSection` builds Settings > General > **Website** (Lock Home
   Until Cydian Is Installed) and **Other Apps** (Install on the Website), website build only. `groupPage("general")`
   appends it. `websiteInstallsSection` came out of `drawSiteSigning` and was deleted. docs/settings.md and the
   websign-gate.js comments are updated.
3. **Locked rows.** While `browsingLocked`, Install on the Website is drawn with no switch, as a `.home-locked` group
   (home.css: dimmed text, a padlock where the chevron goes). A tap runs `askToBrowse` (Install Cydian / Browse Anyway (5)
   / Cancel). The section redraws itself on `cydian:browse-lock`.
   Decision: the **Lock Home switch itself stays usable while locked**. It is the lock's own control: turning it off
   is Browse Anyway, and padlocking it would hide the only way back. Only the website-installs row gets the lock.
4. F134 has not landed (still open), so this builds on the current Signing page. F134 only has to leave out what this task removed.

## Tests
`web/app/screens/websitelock.test.js`, with a small fake DOM and an EventTarget for globalThis:
- the re-render on Browse Anyway, no re-render on Cancel or a repeat of the same state, and the re-render on re-lock
- a Home page that's gone stops listening
- General has the Website groups, other pages and builds don't, and Signing's code no longer draws them (a source check:
  the Signing page needs IndexedDB, which the fake DOM doesn't have)
- the locked row: padlock, no switch, the alert's title, buttons and countdown, Cancel, Install Cydian, Browse Anyway
  unlocking and Lock Home re-locking

## Checked by hand
Headless Chromium against `python3 -m http.server` on web/app. A harness iframe toggled `cydian.firstVisit` and fired
the event. Home went from 7 `.home-locked` and 4 `.tab-locked` to 0/0 after Browse Anyway, and back to 7/4 after
re-locking, with one `.home` (no duplicate). General > Website showed both rows, padlocked while locked and as switches
after Browse Anyway. A screenshot showed the padlocked row looking like Home's.

## Not verified
- On a real iPhone in Safari: not run (no task permission to use the phones for the website, and the headless check covers the DOM).
- A real tap through the alert's 5-second countdown in the browser: the alert's countdown is covered by websign-gate.test.js, and this task's tests use a fake alert.
- The label "Lock Home Until Cydian Is Installed" gets cut off ("…Ins…") at 390 px beside the switch. It did the same on the Signing page; I kept the brief's wording rather than rename it.
