# B163: an .ipa opened from Safari's download preview does nothing (sideload app)

User report (0.13.0 Lite): Yingxia-1.8.26-ios.ipa (184.8 MB) in Safari's Quick Look, tap the "iFizBox" open button:
iFizBox comes forward on Home and nothing else happens.

## The path, traced

`SceneDelegate` (willConnectTo / openURLContexts) -> `Incoming.receive` -> `SharedInbox.receive`
(native/share/App/ShareBridge.swift). Every file URL except an IPA already in our Documents goes there;
`MyIPAs.receive` only sees Documents' own files. `SharedInbox.file` ran on its queue: it started the security
scope there, read 512 bytes to classify, then `library.add` (one `copyItem`), then handed the page
`ifizbox://shared?route=sign-ipa&file=…`.

What was wrong for this case:

- The sideload build has `LSSupportsOpeningDocumentsInPlace = true` (Files' On My iPhone needs it with
  `UIFileSharingEnabled`, so it stays). iOS then hands over Safari's own file (Files > Downloads, usually iCloud
  Drive), not a copy in our Documents/Inbox. That file is only reachable through the URL's security scope and,
  being a file provider's file, should be read under an `NSFileCoordinator`. The scope was started late (after a
  queue hop) and no coordinator was used.
- When the read failed, the 512-byte head came back empty, and the result was either the misleading "named .ipa
  but isn't an IPA" alert or, on the MyIPAs path, `try?` and a silent `return`.
- The copy was one `copyItem` with nothing on screen: 185 MB from a file provider takes long enough to look like
  nothing happened.
- `inbox` was any folder named "Inbox": a user's own iCloud "Inbox" folder would have been moved/deleted.

I couldn't reproduce it on a phone (see Not verified), so I can't say which of these was the cause. The fix covers
all of them.

## What changed

- `SharedInbox.receive` and `MyIPAs.receive` start the security scope on the main thread as iOS hands the URL over,
  and end it after the copy.
- `SharedInbox.file` reads under `NSFileCoordinator(...).coordinate(readingItemAt:options: .withoutChanges)`. A
  coordinator error, an unopenable file and a failed copy each end in a "Couldn't Open" alert in plain words
  (`ShareInbox.unreadable`: save it to Files first).
- IPAs go into My IPAs through `ShareInbox.copyIn` (native/share/Share.swift, tested on Linux): 4 MB pieces into a
  hidden `.<name>.part` beside the destination, renamed at the end. It reports progress once per percent and caps
  the size (8 GB). Nothing is left behind on failure. iOS's own Inbox copy is still moved (instant).
- Progress reaches the page as `ifizbox:receiving` {name, progress} (`Incoming.receiving`, App.swift).
  web/app/incoming.js `onReceiving` shows a live HUD "Copying <name>… 42%" and hides it on progress null. Then the
  usual link opens the IPA's page in Install IPAs (or the alert).
- `ShareInbox.isOurInbox`: only `Documents/Inbox` counts as iOS's copy.
- Info-sideload.plist: the .ipa document type is `LSHandlerRank` Owner, not Alternate. The user said iFizBox isn't a
  proper option beside Feather/SideStore. From memory, AltStore/SideStore declare Owner (I couldn't check their
  plists offline). Quick Look already offered iFizBox, so this is only about how high it's ranked.

Tests: native/share/tests/main.swift "B163: …". It covers a 40 MB file opened in place outside Documents, copied
in 1 MB pieces. The original stays, the copy is equal, progress runs 0…1 once per percent and no .part is left.
It also covers too big, empty and unreadable files (plain words, nothing left) and `isOurInbox` against a user's
Inbox folder. test_share.py Wiring.test_in_place_file checks that the scope starts before the queue hop, the
coordinator, copyIn, no `try?` in MyIPAs.receive, the event on both sides and the Owner rank.
web/app/incoming-receiving.test.js covers the HUD.

Slip: I made one edit to incoming.js with a python heredoc instead of the edit tool. The result was checked by the
tests.

## Not verified

- **On a phone**: no test phone for the sideload build was free in this unattended run. The iPhone 7 runs the
  jailbreak .deb, the iPhone 15 is read-only and the 18 Pro isn't reachable from here. So the actual Safari Quick
  Look → iFizBox flow, the security scope and the coordinator behaviour on iOS are untested. Which of the causes
  above was the user's is unconfirmed. Check: open a big .ipa from Safari's download preview in the Lite build. The
  Copying HUD should run, then the IPA's page in Install IPAs. Do it once with a file in iCloud Drive's Downloads
  and once in On My iPhone.
- **Share sheet app row**: whether iFizBox now shows in the share sheet's app row like Feather/SideStore. Document
  types decide that, and so does iOS's ranking (Owner vs Alternate). The share extension only takes web links and
  text, on purpose: an extension can't open the app with a file. Needs a phone.
- `Security-scoped` access can't be tested on Linux (no sandbox). The Swift test covers the in-place copy itself, not
  the scope.
