# F96: the website pushes Cydian first

Brief: `plan brief F96` printed nothing: the task reached main (commit 87a169b) after this worktree branched. The gate passed but `done` could not find F96, so task/F96 (no commits of its own yet) was fast-forwarded to 87a169b; main itself was not touched.

## What changed
- `web/app/websign-gate.js` (new): the state (localStorage `cydian.websiteInstalls` = "on" once the warning is
  accepted; `cydian.firstVisit` = "later" | "installed"), the countdown warning (`acceptWebsiteInstalls`), the
  rows for other apps (`siteGateRows`), `cydian://package?id=` (`packageLink`/`packageIdOf`), and the first-visit
  prompt (`promptFirstVisit`).
- `nav/alert.js`: `countdown: { button, seconds }` greys a button out with "(n)" ticking down; `sources.css`
  `.alert-button:disabled`.
- `screens/altstore.js` `installRows`: on the website any IPA that isn't Cydian's own (`isSelfIpa`) gets Install in
  Cydian, Download IPA, Install on the Website (greyed: `.websign-off` in altstore.css; tap = warning, accept =
  remembered and installs). Cydian's IPA keeps Install (and marks Cydian installed). The app page's footer says why.
  The nav-bar Install (browse.js, unchanged) runs rows[0], which is now Install in Cydian. The website's Downgrade
  (siteInstallVersion) signs on the website once accepted, else Install in Cydian.
- `screens/home.js`: `init()` asks "Install Cydian First" 600 ms after launch on the website (any tab);
  Install Cydian runs `installCydian()` (the Home tile's flow, now shared: browser-signed IPA, or the .deb when
  jailbroken). Install Cydian App's success (onInstalled) or the .deb's Download marks Cydian installed, which stops
  the prompt. Without a certificate installApp goes to Settings > Signing and the prompt keeps asking next launch
  (the user neither installed nor said Not Now).
- `screens/settings.js`: the website's Signing page has "Other Apps > Install on the Website" (createSwitch). Off
  puts the warning back; on shows the countdown warning first, and Cancel leaves it off.
- `incoming.js` handles `cydian://package?id=` (opens `#/search/package:<id>`), and the shell lets the `package` host
  through (`native/sign/Handoff.swift` IncomingLink, plus a check in `native/sign/tests/sideload/main.swift`).
- `docs/signing.md`: "Cydian first" under From the website to the app.

## Decisions (unattended)
- The id for Install in Cydian: `appId` from renderApp; the nav button and Version History (browse.js, not in this
  task's files) don't pass it, so the gate reads it from the page's hash (`package:<id>` / `versions:<id>`).
- Install on the Website is drawn greyed but stays tappable: a tap is how the user reaches the warning.
- No "Cydian isn't installed" fallback after opening cydian://: Safari's own error shows if the app isn't there
  (a visibility timer would race Safari's "Open in Cydian?" prompt).

## Tests
`web/app/websign-gate.test.js` (first-visit state and prompt, rows for Cydian vs others, accepted vs not, the
countdown in showAlert through a small fake DOM with mock timers, the link and incoming route);
`screens/siteinstall.test.js` updated to the new rows. Headless Chromium render of the rows and the alert mid-count
looked right (greyed row label; dimmed "I Understand (3)").

## Not verified
- On the iPhone (cydian.dev): the task's own "the user tries cydian.dev on the iPhone" is for the user; not
  deployed from here.
- That the app finds the package when its sources don't include that app's source: the page then says it isn't
  found (the link carries only the id).
- The Swift `IncomingLink` check runs only where the native toolchain is (tools/check.sh skips it otherwise; see the
  gate output for whether it ran here).
- The Settings switch and the first-visit timer in a real page: no DOM test (the logic under them is tested).
