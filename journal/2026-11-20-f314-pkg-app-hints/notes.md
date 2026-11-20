# F314 Hint style on package and app pages

Applies the AGENTS.md Hints rule (F311) to the package page, the app page, Where It Comes From, Purchase and
Confirm. Each change is a small exported builder, tested in `web/app/screens/hintstyle-f314.test.js`.

- **browse.js** `installedSections`: Installed Package is Version alone (status row, no footer); Ignore Upgrades its
  own group ("Leaves this package out of Upgrade All.", or, for a dpkg hold read from the site's status file, "Held
  on the phone, so Upgrade All leaves it out. Release the hold there to change it."); Update Automatically its own
  group ("Installs its updates by itself."). `AUTO_MARK_FOOTER` in core/automark.js is no longer imported (left in
  place: not this task's file).
- **browse.js** `paidDebSection`: the site's paid-package note was a footer-only group sitting right above the
  package-ID footer group (two footers glued). It's now a greyed "Download .deb · Paid" row with the note as its
  footer (the fix, where Download .deb would be). `.deb-paid` greys the label (packages.css, one line).
- **altstore.js** `installSections`: Install + Custom Install under "Signed with your certificate on this iPhone."
  (sideload app); jailbreak keeps IPA_FOOTER, itms its line, the site's own-app Install `SITE_INSTALL_FOOTER` minus
  "Download IPA keeps the file.". Download IPA gets its own group, no footer. The website's gate: Install in NAME
  ("Opens in the NAME app, which signs and installs it."), Download IPA, Install on the Website ("Signs here in the
  browser: slower, and can fail on big apps.") — three groups. `SITE_GATE_FOOTER` (websign-gate.js, not my file) is
  no longer used by the app page; left in place.
- **altstore.js** `infoSections`: past the website's size cap, Information splits after Size: TOO_BIG_FOOTER under
  the group ending in Size, the fit detail under the rest (Compatibility). Otherwise one group as before.
- **safety.js** whereFromGroup: Source with the trust footer, then Source Code + Reports with the public-code note
  (only when public). `node` is now a `div.where-from` holding both groups (CSS selectors still match).
- **extras.js** `purchaseSections`: the B183 UDID note is a second, footer-only group after Purchase.
- **queue.js** `waitNoteGroups`: Confirm's wait notes, one footer-only group each, after Modifications.

## Decisions

- "Download IPA its own group, site-only slow note": read as Download IPA with no footer, and the slow note under
  Install on the Website, which only the website shows.
- Purchase's UDID note and Confirm's wait notes have no rows of their own, so they're footer-only groups (as the
  brief says "its own group"). They can't be fixes in-group: the note is about pairing, the wait notes about other
  queued jobs.

## Checks

- `node --test web/app`: 2475 pass, 0 fail (before the journal; the gate reruns it).
- 3x Chromium renders (capture.mjs copied from F311; 402x874@3): `package.png` — jailbreak mode, fake dpkg status
  with one installed-only package, `ifizbox.autoInstall=marked`; `app-info.png`, `app-install.png` — sideload mode,
  iFizBox's own source's app page (Where It Comes From in two groups, Install/Custom Install with one footer,
  Download IPA alone). Run: serve web/app on 127.0.0.1:8761, `node capture.mjs http://127.0.0.1:8761/ <dir>
  package.json --native <phone dir>` / `app.json --mode sideload`.

## Not verified

- Website gate, too-big Information split, dpkg-held footer, paid Download .deb row, Purchase UDID note and Confirm
  wait notes: covered by unit tests only, not rendered (they need the site with a large non-iFizBox app, an uploaded
  status file with a hold, a paid vendor source, or a running queue with waiters; adding an outside AltStore source
  in the render failed silently — quarksources URL didn't add within 25 s).
- Jailbreak-app app page (IPA_FOOTER) not rendered; same builder, unit-tested.
- No phone test: the brief asks for renders only.
