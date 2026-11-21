# B285: jailbreak URL install replaces the My IPAs record

- `screens/ipa-install.js` rememberIpa: an existing record for the app is kept only when it isn't a My IPAs record
  (`library:` key and no source). A My IPAs record is overwritten by the URL install's own (no key, no source, no
  version; I4's installed version fills it in), so the app page's Source row no longer reads My IPAs.
- This covers every caller of rememberIpa: ifizbox://install and other sideloaders' links (incoming.js
  defaultInstall), Settings > Install from URL and tapped .ipa links.
- B283's dropMyIpasRecord still runs in the jailbreak build but returns false (no signed record), and would not touch
  the new record anyway (its key is null). incoming.js got a comment line only.
- Test: ipa-record.test.js, a My IPAs record gives way; a `library:` key with a source is kept.

**Not verified**
- On the iPhone 7: not run (low-priority follow-up; the change is one condition covered by the unit test, and a phone
  run needs a My IPAs install then a link install of the same app).
