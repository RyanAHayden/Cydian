# B174: a tapped .ipa unzips in Files; Open in iFizBox doesn't reach the IPA's page

User report (0.16.0): tapping an .ipa in Files extracts it, and Share > Open in iFizBox brings iFizBox up without
opening the IPA's page.

## Half 1: the type declaration (Files unzipping)

Both Info.plists imported `com.apple.itunes.ipa` with `UTTypeConformsTo` = public.data + **public.zip-archive** (for
ipa and tipa). Files treats anything that conforms to a zip as an archive and unzips it on a tap, so iFizBox never got
the file.

Feather's Info.plist (github.com/khcrysalis/Feather, main, Feather/Resources/Info.plist), read for this:
- `UTExportedTypeDeclarations`: its own `thewonderofyou.Feather.ipa` (extension ipa, MIME application/octet-stream) and
  `thewonderofyou.Feather.tipa` (tipa, application/trollstore-ipa), both conforming to com.apple.itunes.ipa,
  public.data, public.content. No zip. No imported com.apple.itunes.ipa.
- `CFBundleDocumentTypes`: the .ipa type Editor/Owner, the .tipa type Editor/Alternate.

What changed, matching that:
- native/Info-sideload.plist and native/Info.plist export `com.ryha.ifizbox.ipa` (ipa) and `com.ryha.ifizbox.tipa`
  (tipa), conforming to com.apple.itunes.ipa, public.data and public.content. The imported com.apple.itunes.ipa (the
  zip one) is gone. The .deb and .mobileprovision imports stay.
- Sideload: the .ipa document type is Editor/Owner over `com.ryha.ifizbox.ipa` **and** `com.apple.itunes.ipa`. The
  second one is kept so iFizBox is still offered for an IPA another app typed (e.g. Feather's UTI, which conforms to
  com.apple.itunes.ipa) when that app's declaration wins the extension. A .tipa document type, Editor/Alternate.
- Jailbreak: the same types, ranks left at Alternate (Viewer), in-place still off.
- No MIME type on the exported types. Feather's `application/octet-stream` would map every untyped download to
  "iOS App". I left it out on purpose.
- mkipa.py `ipa_type_problems(info)`: the built IPA's check (run by build.sh/Makefile in the gate) now fails when the
  .ipa extension's UTType conforms to an archive type, has no public.data, isn't exported, isn't opened at Owner, or
  in-place opening is off.

## Half 2: the route to the IPA's page

I traced it on paper (no phone; see Not verified): Incoming → SharedInbox/MyIPAs → `ifizbox://shared?route=sign-ipa`
or `ifizbox://myipas?file=` → `notify` → page `startIncoming` take → `handleShared`/`handleIncoming` → `location.hash`
= `#/installed/myipas/ipa:<file>`. I found three places where the route can be lost:

1. **Return Home After overrides it (warm).** app.js: back from the background after the "Return to Home After" time
   (2 minutes by default), `visibilitychange` sends the router to Home's root. Downloading an IPA in Safari or
   browsing Files easily takes 2 minutes, so the return that the hand-off itself causes jumps to Home. When the link
   was handled first, that jump covered the IPA's page (the hash went IPA page → Home). Fix: `web/app/handoffclock.js`
   (`markHandoff`/`handoffRecent`, 15 s). incoming.js marks it on the shell's "ifizbox:receiving" (sent the moment a
   file arrives) and "ifizbox:url", and around each handled link. app.js's Return Home skips when a hand-off is
   recent. When Home comes first and the link after, the IPA page opens on top as before.
2. **The page's take dropped a link that came while a take was out (cold launch).** `startIncoming`'s `take` returned
   at once when busy. On a cold launch the page's start take can be waiting on `app.takeURL` ("nothing yet") just as
   the copy ends and the shell sends "ifizbox:url". That event was ignored, the empty answer ended the take, and the
   link sat in `pending` for ever. Fix: an `again` flag runs one more round.
3. **The shell stopped telling the page after 10 s.** `notify` gave up after 50 × 0.2 s, logging "it takes the link
   when it starts". That's false when the page had already started. Fix: `slowNotify`, every second for up to 2 more
   minutes while the link is still pending. It logs to the trail either way.

The fourth candidate in the brief (the install log page covering it) is B175's.

ShareBridge.swift needed no change: the route and the HUD event it sends were already right. The HUD event is what
now marks the hand-off on the page.

## Tests

- test_share.py `Declared.test_ipa_not_a_zip`: both builds' merged plists export the UTType, have no zip
  conformance and no imported com.apple.itunes.ipa, and `mkipa.ipa_type_problems` is empty. Also checks that the old
  shape is caught.
- test_share.py `Built.test_ipa_handoff` (the built IPA, when fresh): the new shape. Also runs the built Info.plist
  through `plutil -convert xml1`, or libplist's `plistutil` on Linux (plutil isn't on this machine), and compares the
  exported types with plistlib's reading.
- mkipa.py check runs `ipa_type_problems` on every built IPA in the gate.
- web/app/incoming-handoff.test.js: the late-link take round, the hand-off clock, the events marking it, and app.js
  checking it before going Home.

Slip: I trimmed a test out of incoming-handoff.test.js with a python heredoc instead of the edit tool, against the
session rules. The tests ran on the result.

## Not verified

- **On a phone**: no sideload test phone here (the iPhone 15 Pro is read only, the 18 Pro isn't reachable, and the
  run is unattended). So these are unconfirmed on iOS: that Files now hands the .ipa to iFizBox on a tap instead of
  unzipping it, that Share > Open in iFizBox ends on the IPA's page, and which of the three route holes the user
  actually hit. Check: install the build, (a) tap an .ipa in Files, (b) wait over 2 minutes in Files, then Share >
  Open in iFizBox, (c) do (a) with iFizBox closed. Look at Settings > Console Logs > "Open in iFizBox…" if it fails.
- **LaunchServices caching**: iOS may keep the old zip type until the app is reinstalled (or even a reboot). Not
  testable here.
- **Whether `public.content` or Editor matter**: copied from Feather, not measured.
- **The plutil step of Built.test_ipa_handoff** only runs when the built IPA is newer than Info-sideload.plist. The
  gate runs the tests before it builds, so in the gate that test usually skips. mkipa.py's check covers the built
  IPA's types every build.
