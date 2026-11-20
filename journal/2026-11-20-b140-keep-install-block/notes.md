# Settings > Installation & Signing keeps its Installation block across repaints

## What changed

Settings > Installation & Signing (sideload) redraws its whole page each time one of its slow calls answers
(asc.key.info, signing.installed, signing.status). Each redraw built a new `installationBlock`, which asked
idevice.status and idevice.developerMode again and put This iPhone's rows back to Checking…

Now `web/app/screens/settings.js` keeps the block for each page element (`keptInstallation`, a WeakMap) and moves the
same element into the new page. The block repaints itself and carries on with the reads it already started. It builds
a new block only when:

- the Install Apps With choice (`installRoute`) changed,
- the app came back from the background (`returnWatcher`'s visibilitychange/pageshow redraw, through a new `back`
  hook, because the pairing or VPN may have changed while it was away). The 2 s / focus status check still redraws
  without throwing the block away,
- the kept block is more than 30 s old (`INSTALL_KEEP_MS`). This means a redraw well after load still reads the status
  again, as it did before.

The rule is a pure function, `keepInstallBox`, and `screens/settings-installkeep.test.js` tests it.
I put the tests in a new file so they stay out of the way of other slots editing settings.test.js.

## Checked

- `node --test` on the new test file and settings.test.js: 21 tests pass.
- Chromium, B133's `shot.mjs` with `ONLY_MAIN=1` (fake sideload bridge, every reply slowed 2.5 s), on the old and the
  new settings.js:
  - old: idevice.status ×3, idevice.developerMode ×3, and the 3rd shot (5 s in) shows Pairing back at Checking…
  - new: ×2 each, and from the 3rd shot on there's no spinner (it settles once).
- The two calls left both start in the same first moment: the page is built twice right after it opens, before
  any of the slow answers arrive. They don't make the rows flicker, so I left them alone.

## Not verified

- On a phone: this was an unattended run with no phone in reach. It's checked only in Chromium with the fake bridge.
- Coming back from the Pair page by Back (no redraw is involved) shows whatever the page showed before, as it did
  before this change. Not affected by this change, and not looked at further.
