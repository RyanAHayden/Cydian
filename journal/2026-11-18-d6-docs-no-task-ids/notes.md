# D6: no task IDs or repo history in README.md and docs/*.md

User 2026-11-18: docs say only what iFizBox is now. No plan task IDs, no "was / overruled / since F.. / R4 found",
no dates of decisions.

## What I did

- Grepped `\b[FBRINTCD][0-9]{1,3}[a-z]?\b` over README.md and docs/*.md (about 190 hits) and rewrote each sentence in
  plain words; dropped decision history, dates and "I checked" research voice.
- **docs/settings.md**: rewritten. "Layout (after F128)", "What went" and "What moved or was renamed" became the
  current layout (the moves folded into the Layout table: Theme page and route `theme`, Compatibility Marks in
  General, Website group), a "Retired keys" table in present tense (what replaces each, `dropRetired`) and "The
  settings and what reads them". The Theme row now says Mode (segmented) + Themes, as `core/settings.js` SECTIONS has
  it (the old row said "checkmarks"; a move-table row said Display was renamed Theme).
- **docs/audit.md**: was the R13 audit report (all history). Now "What looks redundant but stays": how to look for
  unused/duplicated code, where the shared helpers live, and the kept-on-purpose list. The full report is preserved
  verbatim in `journal/2026-11-18-r13-audit/audit.md` (R13's notes.md points at docs/audit.md; left as is).
- **docs/sileo-zebra.md**: was the R11 research with proposals and a ranked follow-up list. Every follow-up shipped
  (B10, F99–F104, F106; checked in plan/DONE.md and the code), so the proposals became "iFizBox" paragraphs in present
  tense; the R12 measurement stays as "Search cost"; the follow-up list is gone; the paid-package device checklist
  stays as "Checking it on a phone".
- **docs/sideload.md**: the Feather / jailbreak-installer reference stays. "What iFizBox reuses", "What N9 needs" and
  "What I2 needs" (plans, partly overruled) are replaced by "What iFizBox does" (own Swift signer, Semi Local split
  with the Signing Server, keep-alive, own update via the server, the IPA build and its entitlements, the jailbreak
  helper's `install-ipa`). Facts corrected while doing so: the sideload entitlements also hold the App Group (the
  old text said `get-task-allow` only), Info.plist has no TrollStore hand-off used. The Not verified list lost the
  CA question (answered: iOS ignores a hand-trusted root; now stated in "What iFizBox does").
- **docs/native.md**: "decision" framing, "R3 answers" heading → "How it's built"; N1/N2/N4/N5/N6/R8/B8/F198 IDs out;
  the Links out section now describes the shell's `LinkOut` delegates (the pre-fix WebKit analysis is one sentence of
  why). Corrected: the .deb is built (`native/mkdeb.py`, signer found by build.sh) instead of "not built here /
  neither installed yet"; the bridge client is `native/bridge.js` + `native/Sources/Bridge.swift`; iFizBox runs on
  palera1n on the iPhone 7. Updated the two pointers to the renamed heading in `native/README.md` and
  `native/spike/README.md` (only the quoted heading).
- **docs/signing.md**: IDs and history out ("as before F89", "until F92/F95", "Removed (F75)", "the old signer");
  the two "The page's side" headings became "… setting up" / "… installing"; the intro link now `#on-the-phone`.
- **docs/iphone7.md**: IDs out; the ui-7.sh example uses `$ID` instead of N6; the keyboard coordinates are copied in
  from `journal/N6/notes.md` (so the doc needs no journal path); dated "since 2026-11-18" notes, the stale
  "v0.9.2 still ships the old ID" paragraph and the pinned installed build/commit dropped (the dpkg-query command
  stays); "a build from before F171" became "a build under the project's old name" (I first spelled the old ID out;
  native/test_brand.py forbids the old name outside plan/, journal/ and docs/concepts, so it's described, not named).
- **docs/release.md**, **docs/cydia.md**, **docs/account.md**, **docs/shortcuts.md**: IDs out. release.md's intro
  said "once a day and offers to install it", contradicting its own later section (every launch, a row in
  Changes); made it agree and gave that section a heading ("How the app finds it").

## Kept matches of the grep

- `T490` (docs/iphone7.md, 4×): the ThinkPad model the phone is plugged into.
- `D1` (README.md:152): Cloudflare D1.

## Not verified

- Facts I introduced while removing history (Theme page contents, sideload entitlements, the share-sheet pointer in
  shortcuts.md, Blocked in Settings > General, Recent searches, Wish List, Installed's User/Expert/Recent) were
  checked against the source by grep only, not by running the app or looking at a screen: no device task.
- I didn't audit the rest of each doc for accuracy (that's the separate docs-accuracy task); e.g. native.md's
  "Not verified until it runs on a phone" for the offline bundle and settings.md's `about` route are as they were.
- The rendered Markdown wasn't viewed; only the one in-repo anchor (`docs/cydia.md#ui-strings`) and signing.md's own
  `#on-the-phone` were checked by reading.
