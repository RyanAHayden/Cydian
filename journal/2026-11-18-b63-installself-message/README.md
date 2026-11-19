# B63: installSelf points at the site's own signer

- `web/app/core/essential.js` `installSelf`: the alert shown when the app can't sign its own update now reads
  "Open ifizbox.com in Safari and tap Install iFizBox Lite: it signs iFizBox with your certificate." instead of
  sending the user to AltStore, SideStore or Feather. The words match the website Home row (`home.js` `APP_ROW`,
  `Install ${NAME} Lite`); core/ stays free of screen imports, so the label is spelled from `NAME` inline.
- The comment above it no longer says the website signs nothing.
- `essential.test.js`: checks the domain, "Install iFizBox Lite", "your certificate", and that no other sideloader
  is named.

**Not verified**: the alert on a phone (no device run; only reached in the sideload build when it has no bridge
to sign with, which the unit test covers).
