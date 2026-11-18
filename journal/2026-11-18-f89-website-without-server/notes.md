# F89: the website without a server of its own

User 2026-11-18: the NAS server, its signer and Web Push are gone; cydian.dev is one Cloudflare Worker. The server
side (web/app.py, web/signer/, web/push.py, web/fetch.py) had already been deleted in 9905b05. This task took out
everything in web/app that still needed it, and gave the website hand-offs instead.

## What I did

**Website signing removed**
- `signing-client.js`: no IndexedDB identity, no POST /sign, no job polling (`pollJob`), no `signingAvailable`,
  no Bring My Certificate (`getBring`/`setBring`), no Import from Safari (`importFromSafari`, `finishSafariImport`,
  `exportToApp`). The picks on Settings > Signing are in-memory only now, as the sideload build already did.
  `signAndInstall` signs on the phone in the sideload build. Anywhere else it only shows an alert, as a guard.
  `getServer()` defaults to `APP_SERVER` (sign.cydian.dev) everywhere. A saved `https://cydian.dev` (the website's
  old signer, now `LEGACY_SERVER` in core/signing.js) counts as the default.
- `core/signing.js`: `signBody`, `errorText` and `DEFAULT_SERVER` are gone. `LEGACY_SERVER` is added.
- `screens/settings.js`: removed the website's Signing row and page (certificate rows, Signing Server, Check
  Server's zsign answer, Remove Certificate), Install Cydian App row and alert (`offerApp`, `appOfferSection`),
  Bring My Certificate, the `signing-export.<key>` page (Import from Safari's website half) and the push section.
  On the website, `#/settings/signing` now says apps are signed in the Cydian app. The sideload pages are the same,
  except that the walkthrough no longer passes `importSafari`. Its "Default" subtitle now compares against
  `defaultServer()`. Before, it compared against the website's DEFAULT_SERVER, so it never said Default in the app.
- `screens/signing.js` and `signing.css`: removed the Import from Safari button and its styles.
- `core/transfer.js`: removed the Import from Safari crypto (key, seal and open, `signing-import` links).
  Send Settings' payload carries no `server` and no `identity` any more. Old links that have them are read without
  them.
- `screens/importlink.js`: Send Settings sends sources, settings and holds only. The app's import no longer calls
  `signing.import` and no longer sets a server.
- `incoming.js`: removed `cydian://signing-import`.
- `app.js`: removed the first-launch `transfer.link` import (the signer's `bring` + `transfer`).
- `core/appoffer.js`: `homeOffer` is now `{ action: "sideloaders" }` (Not Jailbroken) or `{ action: "deb" }`.
  Removed `certificateWorks`, `signingRowShows`, `offerAfterImport` and `IMPORT_ALERT`.
- `essential-ui.js` and `core/essential.js`: removed `installSelf`'s server branch (`exportIdentity`,
  `signOnServer`, `SERVER_OK_KEY`, `SELF_REASON`). It only fires when the app can't sign itself (no bridge), and
  then sends the user to cydian.dev, as before.

**Web Push removed**
- Deleted `push-client.js`, `sw.js`, `sw-device.js`, `device-check.js` and `core/altnews.js` (used only by
  device-check), with their tests (push-client*.test.js, device-check.test.js).
- `app.js`: instead of `startPush`, the site unregisters any service worker left over from F10, 3 s after launch,
  so iOS stops waking the old push worker.

**Hand-offs on the website** (`screens/handoff.js`)
- `installLinks(ipa, { name })` returns:
  - Open in Cydian: `cydian://install?url=&name=`
  - Get in AltStore: `altstore://install?url=`
  - Get in SideStore: `sidestore://install?url=`
  - Get in Feather: `feather://install/<https url>` (https only)

  These are the same install-link shapes core/otherlinks.js parses (a test checks the round trip).
- `sourceHandoffs(url)` returns the add-source links for AltStore, SideStore and Feather (core/handoff.js
  ALT_MANAGERS).
- App page (`altstore.js installRows`, option `site`, default `detectMode() === "site"`): the rows are Open in
  Cydian, Get in AltStore, Get in SideStore, Get in Feather (each marked `handoff: true`, each records the app as
  Install did), then Download IPA. A source's own itms link still comes first. The footer explains the choice.
  `appPageAction` queues only in the sideload build, so the website no longer queues. browse.js's nav Install lists
  hand-off rows in an action sheet; it no longer runs only the first row. Version History's sheet uses the same
  rows.
- Home: Install Cydian App opens an action sheet: Add to AltStore, Add to SideStore, Add to Feather (Cydian's own
  source, `APP_SOURCE_URL`), then Download IPA (`home.js appInstallChoices`). Its subtitle changes for the .deb
  case. Send Settings stays, with the subtitle "Your sources and settings". The Signing tile shows only in the
  sideload app (`showsSigningTile`), so on the website Featured fills the row.
- My IPAs on the website: Install uses the same hand-offs (`siteInstallChoices`). The texts no longer mention the
  Signing Server.
- `incoming.js`: new `cydian://install?url=…&name=…` link. It opens Install IPAs, shows the "Install IPA" alert
  (the alert F83's other-install links use, now shared as `confirmInstall`), then calls `signAndInstall`.
  `installAsk` reads only http(s) URLs.
- Native: the shell passes only `IncomingLink.hosts` to the page. I added `install` there and removed the dead
  `signing-import` (`native/sign/Handoff.swift`, plus its Swift test and App.swift comments). Without this, Open
  in Cydian would do nothing.

**Docs**: `docs/signing.md`: replaced the website-signer half (how it works, storage, limits, running your own,
the server's tests) with a short "The website signs nothing (F89)" section. Fixed sign.cydian.dev as the default,
F73 (Cydian's update is now hosted on the Worker; no signing.export) and "From the website to the app".
`docs/release.md`: updated the self-update paragraph to match.

**Tests**: new `screens/siteinstall.test.js` (8 tests: the website's rows, their links and records, itms and
jailbreak unchanged, sideload unchanged, the default with no bridge, the links parsed back by otherlinks.js,
Home's sheet, My IPAs' choices). incoming.test.js gained cydian://install tests. I trimmed or adjusted
appoffer, essential, transfer, signing, signing-client-device/-library, custominstall, appqueue and myipas tests.
`node --test web/app` passes: 674 tests.

## Decisions (no one to ask)

- **Import from Safari removed from the app too.** It pulled the certificate from the website's own storage, and
  the brief removes the website's certificate settings. Without them the button would open a dead page. Signing in
  the app is otherwise untouched: Keychain import, walkthrough, Signing Server, install, My IPAs, Custom Install.
- **Open in Cydian shows for everyone.** Safari can't tell whether an app is installed. Its subtitle says "If you
  have the app". Without the app, Safari shows its own "address is invalid".
- **Install links, not add-source links, on an app page.** They install that app directly. AltStore and SideStore
  read `install?url=`, and Feather reads `install/<url>` (sources checked in F83). Home uses add-source links for
  Cydian's own source, as the brief asks, so the sideloader keeps Cydian updated.
- Hand-off rows record the app in Installed, as tapping Install did (F30). Download IPA doesn't record it.

## Tried and failed

- My first test IPA URL had a space in it. `installOptions` drops such URLs, so the rows came out empty. The test
  now uses a URL without a space.

## Not verified

- **On the iPhone (the user's step in the brief):** the website's app page hand-offs, Home's sheet, and whether
  AltStore, SideStore and Feather accept those links today. I had no device in this task (AGENTS.md: the 4S runs
  iOS 6 and is only touched when a task says so).
- **Open in Cydian needs a new app build.** An installed Cydian built before this change drops `cydian://install`
  in the shell (IncomingLink). The native build wasn't run here: the gate builds it only where the toolchain is,
  and `native/sign/tests/sideload/main.swift`'s new check runs only there.
- **The app page wasn't seen in a browser.** The website's repo fetches go to `/api/fetch`, which went with the
  server, so a local static serve lists no sources. Home and Settings were checked in headless Chromium at 390 px:
  Home has the green Install Cydian App | Send Settings card and Featured alone in its row; Settings has no Signing
  or Upgrade Alerts. The rows themselves are covered by node tests.
- **The service worker unregister** wasn't checked on a phone that has the old push worker.

## Follow-ups filed

- F90: the website's fetch proxy (`/api/fetch`) is gone with the server. Without it the website lists no sources.
- T8: native/test_sign.py and test_sideload.py import the deleted web/signer/testkit.py and skip silently.
- C3: native leftovers (BundledIdentity launch import, signing.export).
- C4: launch.js's `?launch=push` mark; AGENTS.md still describes web/app.py.
