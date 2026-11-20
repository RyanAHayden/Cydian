# B175: a finished install log closes when iFizBox comes back or a link arrives

## What I did

- `screens/apprun.js`: `runPage()` hands out the app run's page while it is up: `busy` (the run works, is stopping,
  or iFizBox's own update waits locked for iOS), `aside`, `ended()`, `dismiss()`, `putAside()`. `end()`, the self
  update's finishes and the not-taken path wake `ended()`; a page put aside slides back (`page.show()`) with its result
  when the run ends.
- `followHandoff` got `wind()`: a page closed by `dismiss()` stops listening for visibility but asks iOS once more about
  "Sent to iOS" rows and lets the B156/B170 retries run out, so closing the page on return to the front does not lose
  the record of an app iOS installed while iFizBox was away (the user's own Done still `stop()`s, as before).
- `incoming.js`: `clearRunPage(url)` runs before every link's `handleIncoming` in the take loop. Finished: the page
  closes (the close animation awaited), then the link opens. Running: alert "Install Running" with Open Now / Wait
  (Wait is the cancel/default). Wait waits for `ended()`, closes the page, then opens the link; Open Now hides the page
  (run goes on) and opens the link on top. A page already put aside isn't asked about again. If the run ends while the
  alert is up, either answer closes it and goes on.
- `startIncoming` also listens for `visibilitychange` to visible: a finished, not-aside run page closes (reopened with
  no link).
- Tests: `web/app/incoming-runpage.test.js` (both cases: finished closes first then the IPA page opens; running asks,
  Wait holds the link until the end, Open Now goes on top; reopen closes finished / keeps running; the real
  `runAppRun` handle, aside + show, wind removes the listener).

## Decisions

- Wait is the default (Escape / cancel index), since opening on top hides the run's progress.
- With Open Now there is no button to bring the hidden run page back mid-run; it returns by itself when the run ends.
- Only the app run (Apps/Log) page is covered, as the task names; the apt queue's run page (screens/queuerun.js) and
  the single IPA install page (screens/ipa-install.js) are untouched.
- A finished run with failures closes too (its failed apps stay queued).

## Failed attempts

- none of note (one test expected the hash unencoded; fixed the assertion).

## Not verified

- On a phone (iPhone 7 .deb or a sideloaded Lite build): no device step in this task, and the phones are shared with
  other slots; the order of the shell's "ifizbox:url" and the page's visibilitychange on a real warm open is covered
  only by the fakes (both paths close the same page; dismiss is idempotent).
- The alert's look/wording on device.
