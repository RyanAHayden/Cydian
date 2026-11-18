# F146: the app's Sources > Add works like the website's

User 2026-11-18: "the native IPA add to type button still doesnt work. just go over to how ipa does it on web too.
the single button pops up the input and the native paste button is there. obviously in the app it should take
straight from clipboard asking once, and jailbroken doesnt have to ask".

## What I did
- `web/app/screens/sources.js`: in the app, the Add bar button has no `onPress` at all. That was the touch-down
  "Type" switch, which is for Safari's Paste bubble only. Add opens Enter APT URL inside the tap, as F105 did, and
  then fills the field from the bridge. It now asks `clipboard.read` with `{auto: true}`. The website's flow is
  unchanged.
- `web/app/nav/alert.js`: the alert's own Paste button reads the bridge in the app (a tap, so no `auto`). Before
  this it used `navigator.clipboard`, which in WKWebView brought back WebKit's Paste bubble: a second, separate
  paste UI. It falls back to `navigator.clipboard` on the website or in a shell without `clipboard.read`.
- `web/app/nav/menu.js`: `nativePaste(native, params)` passes params through. Default `{}`, as before.
- `native/Sources/Bridge.swift`: `clipboard.read` now goes through the new `ClipboardRead`:
  - Jailbreak build: reads `UIPasteboard` straight away, without asking.
  - Sideload build: `hasStrings`/`hasURLs`/`changeCount`/`detectPatterns` never prompt. An auto read goes ahead
    only when iOS says a web URL was copied (`detectPatterns` with `\.probableWebURL`, the iOS 15 key-path form)
    and this copy (`changeCount`) wasn't read before. So iOS 16+'s Allow Paste comes up at most once per copy.
    A "Don't Allow" (`string` is nil on iOS 16+) is remembered in UserDefaults (`clipboard.pasteDenied`), and
    auto reads stop asking from then on. A tap on Paste always reads, and a read that works clears the No.
- Tests: `screens/addsource.test.js` gains the auto read with and without a clipboard URL, and checks the website
  has the Type `onPress` but the app doesn't. The new `nav/alert-paste.test.js` (fake DOM) checks the alert's Paste
  reads the bridge in the app and Safari's clipboard on the website or an old shell.

## On the iPhone 7 (jailbreak build 0.4.0-873, this branch)
Installed with `apt-get install`, driven with `tools/ui-7.sh`. There is no pbcopy on the phone, so I put the
clipboard there through Cydian itself: a long-press on Havoc's row, then Copy URL.
- `add-with-url.png`: Add opened Enter APT URL already holding `https://havoc.app/`, with the keyboard up and Add
  not left as Type or pressed.
- `erased.png` → `paste-button.png`: with part of the URL deleted, tapping the alert's Paste filled it again from
  the bridge. No WebKit Paste bubble appeared.
- `add-no-url.png`: with a plain word copied (via the field's own Copy menu), Add opened with `https://` and the
  keyboard up.
I cancelled every alert, so nothing was added.

## Found along the way
- After a tap on the alert's Paste, the keyboard goes down. The `focus()` comes after the bridge's await, so it is
  outside the gesture, and WKWebView then doesn't raise the keyboard. The field still has the text. I left this
  as it is: the task is the Add flow, and the auto fill (the main path) keeps the keyboard up.

## Not verified
- The sideload build on a phone, including the iOS 16+ Allow Paste prompt, "asked at most once per copy" and the
  remembered No. There is no non-jailbroken iOS 16+ phone here, and the iPhone 7 runs iOS 15.8.8, which has no
  paste prompt. Only the build (`native/build.sh all`, the IPA too) and the node tests cover it.
- The jailbreak build on iOS 16+. The brief allows "entitlement or private API as already used". Nothing in the
  tree already uses one for the pasteboard, and I didn't want to guess at an undocumented entitlement. So on iOS 16+
  the jailbreak build does a plain read, and iOS may show its own prompt there. No iOS 16+ jailbroken phone is here
  to check. If it does prompt, a follow-up could find the right private switch.
- Whether a copied bare host (`repo.example.com`, no scheme) counts as `probableWebURL` in the sideload build. If
  it doesn't, an auto read skips it, and Paste still works.
