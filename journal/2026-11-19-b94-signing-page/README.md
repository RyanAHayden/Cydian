# B94: Signing page after a pick (site and sideload)

## What changed

1. **No "password is wrong" before a password.** `core/signing.js` `summary()` takes the `password` the caller has;
   a `.p12` checked with `""`/`null` (picking one runs `recheckPassword` with `""` and saves `passwordOk: false`) adds
   no problem. Callers that pass no `password` keep the old rule. `drawSiteSigning` passes `id.password`. The
   Password group's `waiting` footer ("test.p12 is locked. Type the password…") is what the page says instead.
2. **Read From a .txt File hides once the password is right or not needed.** The row is `li.sign-pw-txt-cell`;
   `paintPasswordState` (which runs on every check while typing, no redraw) sets its `hidden` from
   `wantsPasswordFile(state)`, so it comes back when a typed password turns wrong. CSS
   `.sign-pw-txt-cell[hidden] { display: none; }` in `ios6.css`.
3. **Certificate group not stuck on Incomplete (site).** Typing the right password only repainted the Password
   group, so the page kept "Incomplete" and the files until something redrew it. `passwordBlock`'s save now
   redraws the website's page when `siteBecameReady(before, now, done)`: the password now opens the .p12, or (a
   .p12 that can't be checked here) the entry is finished and the identity became ready. Never per keystroke, so
   the field keeps its focus while typing.
   Sideload: already right in the code. `save` runs `importIfComplete` as soon as `passwordOk` is true, and a
   successful import clears the staged picks (only the names stay, for the walkthrough's rows) and redraws, so
   `kept` gives the Keychain's rows. `deviceSigningSection`'s Settings row was checked: `statusReady` first, then
   Incomplete only while picks are staged. Nothing changed there.
4. **No files/Password group once the certificate is good.** `signingLayout` turns `files` off for `site && ready`
   even if a caller still counts picks as staged. Sideload: `staged` is false after the import cleared the picks.
   Replacing a kept certificate with new picks still shows the group, as it should.

Tests: `web/app/screens/signing-b94.test.js` (summary with no/empty/wrong/right password, `wantsPasswordFile` per
state, `signingLayout` site ready / sideload kept, `siteBecameReady` per keystroke vs right vs finished entry).

## Screenshots (headless Chromium, `capture.mjs` + `shots.json`, web/app served at 127.0.0.1)

- `1-p12-no-password.png`: `test.p12` + `test.mobileprovision` picked through Import Certificate, no password.
  Certificate says Incomplete with the "Choose your .p12…" footer (no red wrong-password note). Password group
  shows `waiting` with Read From a .txt File.
- `2-right-password.png`: `hunter2` typed (change event). Certificate group shows Name/Team/Expires and Replace
  Certificate. No Files or Password group.
- The walkthrough page (How Signing Works) after that: DOM check gave `.sign-pw-cell` state `right`, txt row
  `hidden` with computed `display: none`. Step 1 was collapsed, so the PNG showed nothing useful and was dropped.

## Tried and failed

- Nothing failed. The first edit to `core/signing.js` went through a python heredoc against the session rules; every
  edit after that used the edit tool.

## Not verified

- **Sideload build on a phone**: not run. The task didn't call for the iPhone 7, and the sideload IPA can't be built
  or run here. Items (3)/(4) for sideload rest on reading `importIfComplete` and `drawDeviceSigning` plus the
  `signingLayout` test. An import that fails (not a wrong-password failure) still leaves the picks staged, so the
  page says Incomplete. That is deliberate: the certificate isn't in the Keychain.
- **The debounced input path** (typing without blur) on the site: the screenshot used the change event;
  the redraw rule for the debounced path is covered only by the `siteBecameReady` unit test.
- **Safari/iOS rendering** of the hidden txt row: checked only in headless Chromium.
