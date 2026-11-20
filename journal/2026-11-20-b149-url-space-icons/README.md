# B149: YouMod shows no icon (a raw space in the source's iconURL)

YouMod's source (`https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/apps.json`) gives
`iconURL: ".../assets/YouTube Icon.png"`, with a raw space.

## Cause

Not (only) iOS. `core/altstore.js httpUrl`, which every AltStore-format field goes through when a source is parsed
(`parseAltSource`, and `core/sources/ipa.js` for the other formats), refused any URL containing whitespace
(`/^https?:\/\/[^\s]+$/`), so `iconURL` became `null` at parse time. Every screen then had no icon: the source's All
Apps list, the app page, and every record made from the app (Installed / My IPAs keep `icon: app.iconURL`, the
appqueue, manage.js previews). Reproduced in headless Chromium (sideload mode, native fake bridge): before the fix
All Apps and the app page drew no `<img>` for YouMod at all (`before-all-apps.png`). The iOS side was a second
layer: had the URL got through, `Apt.httpURL`'s `URL(string:)` returns nil for a space before iOS 17, so `net.icon`
(Icons.swift) and the IPA download paths would have answered `bad_url`.

## What changed

- `web/app/core/urlencode.js` (new): `encodeUrl(s)` percent-encodes (UTF-8) characters a URL can't hold after the
  host (space, quotes, `<>{}|^\``, `[ ]`, non-ASCII, a `%` not starting `%XX`), keeps existing `%XX` escapes (so it
  never double-encodes, and is idempotent), leaves scheme and host alone, and leaves non-URL text as is.
- `core/altstore.js httpUrl` encodes first (a space in the host is still refused). Screenshot string entries now
  keep the encoded URL. `downloadURL` is encoded too, so an IPA link with a space reaches the shell's
  `httpURL` in a form iOS 15 takes.
- Backstops: `screens/depiction.js mediaUrl` (every `<img>` for remote media: altstore.js, myipas.js,
  installed.js, extras.js) and `backend-native.js iconBytes` (before `net.icon`) encode as well, for URLs stored
  before this fix or coming from elsewhere.
- Swift: `native/Sources/URLEncode.swift` (`URLText.encoded`, Foundation only, same rules) and `Apt.httpURL` calls
  it before `URL(string:)`, so every shell entry point that takes a URL from the page (net.icon, net.fetch,
  ipa.install, My IPAs, Sideload, Paid, SignAhead) takes a raw space on iOS 15/16.

## Checks

- `node --test web/app/core/urlencode.test.js`: space -> %20, %20 kept, double encode is a no-op, stray %,
  other characters, host untouched; parseAltSource gives YouMod's iconURL/screenshots/downloadURL encoded; the
  native backend's iconBytes hands net.icon the encoded URL. Whole `node --test web/app`: 2126 pass.
- `native/test_urlencode.py`: builds `URLEncode.swift` with `native/tests/urlencode/main.swift` on the Linux Swift
  toolchain (same cases, plus `URL(string:)` taking the result); checks `Apt.httpURL` calls it.
- Chromium, sideload mode, native fake bridge (`capture.mjs`, B129's with a `net.icon` that refuses a raw space
  like iOS 15's `URL(string:)`; `youmod.json` adds the source through Sources > Add, opens All Apps and YouMod):
  after the fix the icon loads on All Apps and the app page from `.../YouTube%20Icon.png` (natural width 120)
  (`after-all-apps.png`); before, no icon on either (`before-all-apps.png`, run against a scratch worktree of the
  branch point on a second port).

  ```sh
  PORT=8841 HOST=127.0.0.1 REVIEWS_DB=off node worker/node.mjs &
  node capture.mjs http://127.0.0.1:8841/ OUT youmod.json --mode sideload
  ```

## Gate fix on the way (not B149's code)

The first `run done` failed in `tools/setup/test_setup.py` `test_cli_builds`: the cargo target dir is shared
across worktrees (`~/.cache/ifizbox/setup-target`), and cargo reused `tools/setup/cli`'s build script compiled in
the since-deleted `take-F285` worktree, whose `env!("CARGO_MANIFEST_DIR")` pointed there, so it panicked on a
missing `native/brand.env`. `build.rs` now reads `CARGO_MANIFEST_DIR` at run time (cargo sets it for every build
script run), so a stale script from another worktree finds this worktree's brand.env. The test passed after it.

## Not verified

- On a phone (iOS 15 iPhone 7 or the user's sideload phone): not touched by this task. The Swift change was built
  only as the standalone Foundation file on Linux; Apt.swift itself compiles only in the iOS build
  (`tools/check.sh`'s native build, which runs only where the iOS SDK is set up; see the gate output).
- Installed / My IPAs rows recorded before this fix keep `icon: null` (the old parse dropped it) until the app is
  updated or re-added from its source; nothing migrates them.
- Redirect `Location` headers in Icons.swift (`URL(string: loc, relativeTo:)`) are not encoded: servers send them
  encoded, and a relative one isn't a full URL for `URLText`. Not seen as a problem, left alone.
- A record's `downloadURL` is now the encoded form; a record stored with a raw-space downloadURL from before (only
  possible if such an install worked at all, which on iOS < 17 it couldn't) would not match the new one.
