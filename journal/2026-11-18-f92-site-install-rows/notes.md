# F92: the website's Install offers only Install and Download IPA

User 2026-11-18: "the webpage install still shows open in and get in all these apps. we shouldnt".

## Done
- `screens/altstore.js` installRows: on the website an IPA's rows are now `Install` (subtitle "Needs your
  certificate", marked `needsCertificate: true`) and `Download IPA`. F89's Open in Cydian / Get in AltStore /
  SideStore / Feather rows are gone. Tapping Install calls `siteCertificateAlert`: an iOS 6 alert "Certificate
  Needed" with OK and Download IPA. Nothing gets recorded on the Installed tab, because nothing was installed (F89's
  hand-offs recorded the app). The footer (`SITE_INSTALL_FOOTER`) says browser signing is on the way.
  The `open` option went away and `needsCertificate` took its place (tests inject it).
- `screens/home.js`: Install Cydian App (website, Not Jailbroken) shows the same alert and its Download IPA opens
  APP_IPA_URL. Subtitle: "With your certificate, or the IPA". `appInstallChoices`/`APP_SHEET_TITLE` are removed,
  along with the now-unused showActionSheet/APP_SOURCE_URL imports.
- `screens/handoff.js`: `sourceHandoffs` is removed (only Home's website sheet used it). `installLinks` stays because
  My IPAs (`myipas.js siteInstallChoices`) still uses it. Share's sideloader hand-offs are unchanged.
- `screens/siteinstall.test.js` is rewritten for the new rows, the alert, and Home.

## Decisions
- I used an alert with "Download IPA" next to OK, not a dead row. That way browse.js's nav-bar Install (which runs
  rows[0].onClick when it isn't a hand-off) still leads somewhere useful, and browse.js needed no change.
- F93 (sign in the browser) will replace `siteCertificateAlert` as the site row's onClick (or swap in the
  `needsCertificate` default).
- My IPAs' website Install also still shows the hand-offs. It is outside this task's files, so I filed it as F95
  (after F92), together with browse.js's dead `handoff` branch and core/appoffer.js's outdated F89 comment.

## Not verified
- I have not seen the alert or the rows in a browser or on the iPhone. This was an unattended run with no screen
  driving. Only the node tests check them.
