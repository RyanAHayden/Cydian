# F105: the app's Sources > Add paste, restored

User 2026-11-18: "the native app's add source paste thing broke again, web page version is good".

## What was wrong
ffaf27e made the app read UIPasteboard through the bridge (`clipboard.read`), then open Enter APT URL once the
reply came. That reply is an async round trip (postMessage, `DispatchQueue.main.async` in Bridge.swift), so the alert
opened outside the tap. WKWebView then shows no keyboard for `field.focus()`, because the shell does not turn off
keyboard-needs-user-action. The native branch also skipped `reset(button)`, the re-insert that drops WebKit's
`:active`, so Add could stay pressed. The website still awaits `readText` inside the tap, which is why it was fine.

## What I did
- `screens/sources.js`: `addFromClipboard` hands the app to a new `addFromPasteboard`. It clears Add (text, blue
  `done`, pressed look, re-insert), opens Enter APT URL **synchronously inside the tap** (showAlert builds the field
  before its first await), then asks `clipboard.read` and puts the cleaned URL in the field. It does that only if the
  field is untouched and still on screen. No URL, an empty clipboard or a refused read leave `https://` to type
  after. The app never falls back to `navigator.clipboard`, which after an await would bring back WebKit's bubble
  without Type.
- `addFromClipboard` is exported with test hooks (`native`, `open`).
- `screens/addsource.test.js`: URL, bare host, no URL, empty, refused (throws), and text typed before the read
  answers. Each checks the alert opened before the bridge call, there were no `readText` calls, and Add is not left
  in Type, blue or pressed.
- Native: no change. `clipboard.read` in Bridge.swift already returns the string, or "" when there is none.

## Tried and dropped
- Reading first and then opening, as ffaf27e did: this is the bug (the alert opens outside the tap).
- Turning off WebKit's keyboard-needs-user-action from Swift: it needs private API or swizzling. Opening the
  alert inside the tap does the job without that.

## Not verified
- On the iPhone: no device run. The task's own check is that the user tries Add in the app. I cannot drive the
  user's phone, and the iPhone 7 needs the task to allow it plus a fresh .deb build. Two guesses there are unchecked:
  that the keyboard comes up, and that iOS 16+'s own "Allow Paste" prompt (shown when `pb.string` reads another app's
  copy) looks fine over the open alert.
- That the missing keyboard and pressed look are exactly what the user saw: they only said "broke again". This
  fixes both, and the fallback path, but the exact symptom is my guess.
- The alert's own Paste button (nav/alert.js) still uses navigator.clipboard, so in the app it shows WebKit's bubble.
  That works, and alert.js is outside this task's files.
