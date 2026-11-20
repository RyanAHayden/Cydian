# D19: task IDs out of the native/ and worker/ READMEs

## What I did

Rewrote the tracked READMEs under `native/` (app, helper, daemon, intents, share, widget, spike) and
`worker/README.md` to state what is, without task IDs or repo history:

- Dropped every `(N4)`, `(F63; below)`, `I3's list`, `N7's daemon`… tag; where the ID stood for a thing, named the
  thing ("the daemon", "the automatic updates' notes", "the root helper", "app updates").
- Cross-references that pointed at doc sections by task ID now point at the real headings: docs/native.md
  "1. Navigation", docs/signing.md "On the phone". docs/sideload.md has no "What I2 needs" section any more, so
  native/README.md names the `Info-sideload.plist` overlay directly.
- History rewritten as current state: helper "as before" dropped, the self-install SIGPIPE paragraph turned
  conditional ("Were apt writing straight into the app's pipes…"), share's "now declares" → "declares", the intents'
  dated llios check undated.
- Removed the "None of this has run on an iPhone yet: see journal/…" lines in intents/ and share/: they point at
  repo history (journal dirs named by task), and I could not confirm whether they are still true.
- Stale fact fixed: daemon/README.md said the package page's Roll Back was "a follow-up task"; it exists
  (`web/app/screens/rollback.js`, helper `rollback`), so it now says Roll Back installs a stored .deb through
  `ifizbox-helper rollback`.

Check: `grep -nE '\b[A-Z][0-9]{1,3}[a-z]?\b'` over the tracked READMEs finds only regex classes like `[A-Za-z0-9.-]`
and Cloudflare's "D1" database product, which is not a task ID. `native/build/**` READMEs are build output
(untracked copies of web/app files), not touched.

## Tried that failed

Nothing.

## Not verified

- Whether intents/ and share/ have now run on an iPhone: I removed the "not run yet" lines rather than restate
  them, since checking needs a device. Their journals (2026-11-17 n8/n9) still hold that note.
