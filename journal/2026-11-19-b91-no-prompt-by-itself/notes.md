# B91: never open iOS's Install prompt again by itself

Brief (with the user's 2026-11-19 change): B89's freeze fallback opened a second "Install?" unasked. iFizBox can't
tell the user's Cancel from a frozen server, so after a prompt was shown and closed only the user's tap may open
another. The row ends Failed ("iOS didn't download it"), not Cancelled; its Try Again opens the prompt again (the
Signing Server's link when the listener froze). "Cancelled" stays for iFizBox's own Stop / Cancel.

## What changed

- `native/Sources/InstallPrompt.swift`
  - `everShown` on each entry (set by the willResignActive observer, never cleared) and
    `mayOpenByItself(everShown:)`. `attempt` takes `user:`; an automatic attempt (the first open's retries,
    `checkShown`'s "no prompt after 8 s") stops once a prompt was shown. `reprompt` (the user's tap) passes `user: true`.
  - `rehost(bid, link)`: swaps the link the next reprompt opens (Signing Server copy) and opens nothing. `links` keeps
    every link of the IPA so `end()` matches either (the job's Cancel ends with the local link).
  - The dismissed log line no longer says "taken as Cancel".
- `native/Sources/Sideload.swift`
  - `hostAfterFreeze`: `InstallPrompt.rehost` instead of `InstallPrompt.open(hosted…)`.
  - `progress`: a dismissed prompt no longer cancels the tag's job, so the IPA stays served (and the hosted copy
    stays polled) for the row's Try Again. The tag's Stop / Cancel or the 15-minute expiry ends it.
- `web/app/core/apprun.js`: `dismissed` ends the row `failed` with `DIDNT_DOWNLOAD` ("iOS didn't download it").
  `retry` / `retryAll` send such a row (when a reprompt lane exists) straight to "signed" with `again: true`; the
  install lane calls `install(row, { again: true })`. An install that throws code `gone` (not served any more) puts
  the row back to "waiting", which signs it again.
- `web/app/screens/apprun.js` `phoneLanes`: `again` reuses the row's last install tag (so Stop on the re-prompted
  row stops that serving) and passes `again` to `openPrepared`.
- `web/app/signing-client.js` `openPrepared({ again })`: `signing.reprompt` instead of `signing.open`, then the same
  `signing.progress` watch; throws code `gone` when reprompt answers false. (Not on the brief's file list; one
  small function, needed for the web side.)
- `docs/signing.md`: freeze paragraph and IPA-run paragraph match.
- Tests: `native/test_install_server.py` `test_freeze_after_the_prompt_closed_opens_no_prompt` (source test: no
  open in hostAfterFreeze, one `InstallPrompt.open` in Sideload, `everShown` gate before `UIApplication.shared.open`,
  every `attempt` names who asked, rehost opens nothing, dismissal cancels no job). `native/test_sideload.py`
  updated for the dropped `SignJob.cancel(tag:)`. Node tests in `core/apprun.test.js` and `screens/apprun.test.js`
  for the Failed row, Try Again without re-signing, the `gone` fallback, tag reuse and `openPrepared({again})`.

## Decisions

- Try Again on a dismissed row is a re-prompt of the IPA that is still served, not a re-sign: the brief says the
  tap opens the prompt again with the hosted link after a freeze, which needs the served/hosted copy kept. Falls back
  to a full re-sign when the shell says it isn't served (expired, fetched, or iOS had asked for it).
- The row's tap still only retries once the run has ended (as for every failed row), so a re-prompt can't land on
  top of the next app's prompt. Retry All does the same per row.
- A dismissed row's IPA stays served (KeepAlive held) up to its 15-minute expiry if the user never taps Try Again
  or closes the run page. Accepted: that is the cost of being able to re-prompt without signing again.

## Not verified

- On the phone (iPhone 7 / an iOS 27 phone): Cancel on the prompt gives "Failed: iOS didn't download it" with no new
  prompt, Try Again installs, also after the phone locked (freeze → hosted link). Not run: unattended session, and
  the 7's screen needs `tools/ui-7.sh` under a lock with someone to judge the prompts; the freeze itself was seen
  on iOS 27, not the 7's iOS 15.
- InstallPrompt's runtime behaviour is checked only by reading the source (it is UIKit; no host test can drive
  willResignActive / UIApplication.open). The Swift compiles in the gate's native build.
