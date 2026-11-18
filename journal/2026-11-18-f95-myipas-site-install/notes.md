# F95 My IPAs' website Install: only Install and Download IPA

- `myipas.js`: `siteInstallChoices` (the F89 hand-off action sheet) is gone; `siteInstallSheet(entry, { alert, open })`
  is now exported and calls `altstore.js siteCertificateAlert`, whose Download IPA opens the link. Same as an app
  page and Home's Install Cydian App since F92.
- With that, nothing used `handoff.js installLinks` (or `HANDOFF_APPS`, `INSTALL_LINK`): removed. The brief said
  "then" after F93; read as "once nothing uses it", which is now, since F93 only changes what Install does, not
  whether hand-offs come back (user 2026-11-18: no hand-offs on the website's Install).
- `browse.js`: the dead `rows[0].handoff` branch and its sheet title removed. `appoffer.js`: the F89 comment
  updated to F92's behaviour (the `"sideloaders"` action name kept, since home.js and appoffer tests use it).
- `siteinstall.test.js`: My IPAs case rewritten for the alert; the hand-off link round-trip test replaced with one
  that checks `installLinks` is gone. `incoming.test.js` still covers reading `cydian://install` links.
- Stale comments outside the task's files (incoming.js header, docs/signing.md) filed as D3.

**Not verified**: the My IPAs Install alert in a real browser / Safari on the phone (no device step in the task; the
node test drives `siteInstallSheet` with a fake alert).
