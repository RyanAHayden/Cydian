# B20 Settings > Signing > Signing Server row does nothing when tapped

## Cause
The row's wiring was fine (grouped() wires `onClick` on a `<button class="cell-inner">`, askServer's alert works).
`watchReturn()` (settings.js) redrew every open Settings page on **window `focus`**, as well as visibilitychange
and pageshow. In headless Chromium (sideload mode, a fake `cydianNative`) a stack trace on `signing.status` showed
the tap itself firing `focus` -> `redrawAll()` -> `drawDeviceSigning`, which replaces the whole Signing page.
WKWebView gives the page window focus back on an ordinary tap (the first one after the keyboard or a native sheet
went away), and when the content under the finger changes during the tap, iOS WebKit drops the click. So the row
"can't be tapped". In Chromium the click still lands, which is why it looked wired.

## Fix
- `returnWatcher()` (exported, injectable): `focus` now only re-reads signing.status and redraws when it changed
  (the same check as the 2 s timer). visibilitychange and pageshow still redraw at once (those never come from a tap).
- `askServer()` (exported, injectable): after Save it stores the URL (empty = default) and **runs Check Server**, as
  the brief asks.
- `serverRow()`: the row reads as a field like F149's password: label "Server", the host on the right in
  `--field-text` (your own server) or `--field-hint` grey with subtitle "Default" (the default, what the empty field
  falls back to). CSS in ios6.css (`.cell.server-field`, `.cell.server-field-default`).
- Tests in settings.test.js: tapping the row opens the alert with a url field (empty for the default, the default
  as placeholder), Save stores the trimmed URL, redraws and checks; empty Save goes back to the default; Cancel
  does nothing. And: window focus doesn't redraw unless the certificate status changed; visibilitychange does.

## Website
The row is only on the sideload build's Signing page (`signingLayout`: `server` only for mode "sideload"). The
website's walkthrough shows `location.host` as a plain row on purpose: there the site itself holds the signed app,
so there is no server to change. No website change. The jailbreak build has no Signing page either.

## Checked
- Headless Chromium, 375x667 @2x, touch emulation, `cydianNative.mode = "sideload"`: before the fix, the tap ran a
  full redraw (trace: `again` -> `redrawAll`); after, only status reads, and the alert with the field opens.
  Screenshots looked fine (row: "Server / Default", grey host, chevron; alert: field with the default as placeholder).
- `node --test web/app/screens/settings.test.js`: 9 pass.

## Not verified
- **On the iPhone 7**: it has the jailbreak build 0.5.0 installed (`com.ryha.ifizbox`), which has no Signing page
  (Signing Server exists only in the sideload build). Checked by opening Settings on it (tools/ui-7.sh). Building
  and installing the sideload IPA there is outside this task. So the iOS tap itself, the theory that WKWebView's
  window focus on tap is what fired the redraw, is inferred from the code and the Chromium trace, not seen on iOS.
  A person should tap Settings > Signing > Server in the sideload app, also right after closing the keyboard.
- **Safari**: the website has no Signing Server row (see Website), so nothing to tap there.
