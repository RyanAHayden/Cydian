# B171: Sources > Add opens with no Allow Paste prompt

## What was wrong
In the app, Add opened Enter APT URL and then called `clipboard.read {auto: true}` (Bridge.swift `ClipboardRead`).
In the sideload build, when iOS said a URL was copied, that read pulled the text from another app's copy, so iOS
showed **Allow Paste** over the alert as it opened. The Issuer ID alert (Settings > developer account, Add API Key)
did the same with a plain `clipboard.read` when it opened.

## What changed
- `native/Sources/Bridge.swift`: new bridge call `clipboard.peek` → `{url: Bool}` (`ClipboardRead.hasURL`):
  `hasURLs`, else `hasStrings` + `detectPatterns(for: [\.probableWebURL])`. None of these read the pasteboard,
  so iOS shows no prompt. `clipboard.read` is unchanged (the `auto` path is now unused by the frontend but kept for
  older frontends against a newer shell).
- `web/app/nav/menu.js`: `nativeHasUrl()` wraps the peek; `null` on the website or an older shell.
- `web/app/screens/sources.js` `addFromPasteboard`: the alert opens inside the tap as before, its Paste button is
  hidden (opacity 0, no pointer events, aria-hidden; its room is kept so nothing moves) while the peek runs, and fades
  in only when the peek says a URL is there. The text is read only when Paste is tapped (nav/alert.js, unchanged).
  No URL: no Paste offered (the field's own edit menu can still paste). An older shell without `clipboard.peek`:
  Paste shows, as before.
- `web/app/screens/devaccount.js` `issuerPrefill`: the app no longer reads the clipboard when the Issuer ID alert
  opens (iOS can't tell a UUID without reading, so there's nothing to peek); the field's Paste button covers it.
  The website's granted-permission prefill is unchanged. `docs/signing.md` updated.
- `manage.js` Import > From Clipboard reads only on the user's tap: that's an explicit paste, left as is.

## Decisions
- "Paste suggestion" = the alert's existing Paste button, shown or not. Fading it in (opacity only) instead of
  inserting it keeps the size-changes-slide rule: nothing grows or jumps.
- The jailbreak build peeks too instead of reading silently: on iOS 16+ a jailbreak build can still get the prompt,
  and one rule for both builds is simpler. On iOS 15 this costs one tap (Paste) that used to be automatic.
- devaccount.js was outside the brief's file list, but the brief asks for any other screen that reads the clipboard
  on open; the change is three lines plus its test.

## Tests
`web/app/screens/addsource.test.js` rewritten for the peek: alert before the bridge call, only `clipboard.peek`
called, Paste hidden during the peek and shown for a URL, hidden for none, shown for an older shell;
`nativeHasUrl` answers. `devaccount.test.js`: the app's issuerPrefill makes no bridge call.

## Not verified
- On a phone (sideload build on iOS 16+, where the prompt appears): not tested. The task names no device, and the
  iPhone 7 runs iOS 15.8 (jailbreak), which never shows Allow Paste, so it couldn't show the fix anyway. Check by
  hand: copy a URL in Safari, open the sideload app > Sources > Add: no prompt, Paste fades in; tap Paste: iOS asks
  once, the field fills.
- That `detectPatterns` never prompts is from Apple's documentation (and F146 relied on it already), not measured here.
