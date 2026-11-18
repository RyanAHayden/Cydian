# R8: do links out of the app work? (2026-11-17)

**Answer: no, except F72's `app.openURL`.** The whole table is in docs/native.md, "Links out of the app".

## What I did
- Listed every way the page leaves the app: `window.open` in home.js (Source Code), browse.js (More Information)
  and altstore.js (Website, `installRows`' default opener). `location.href` in altstore.js (Install with
  itms-services, Get, Open in), handoff.js (Open in), signing-client.js (itms) and essential-ui.js (`openOutside`'s
  fallback).
- Read the shell: `WebController` is a `WKNavigationDelegate` for the launch cover only (didFinish/didFail), with
  no `decidePolicyFor` and no `WKUIDelegate`.
- Read WebKit's source from GitHub (main): `UIProcess/Cocoa/UIDelegate.mm` `createNewPage` (with no
  createWebViewWith delegate method, the completion gets null, so `window.open` does nothing) and
  `NavigationState.mm` `decidePolicyForNavigationAction` (with no delegate method, schemes `NSURLConnection` can't
  load get `listener->ignore()` on iOS, since only macOS hands them to NSWorkspace; https gets `use()`, so the web
  view navigates away unless a universal-link app takes it).
- Filed B8 to fix it in the shell (WKUIDelegate plus decidePolicyFor that hand non-`cydian:` URLs to
  `UIApplication.shared.open`).

## Tried that failed
- `plan add B …` refused at first: it matched R8 itself. Filed again with `--force`, since the fix is different
  work from this check.

## Not verified
- **Nothing was tapped on a phone.** The task said "check on the iPhone", but no iOS 15+ device is reachable
  from an agent run. The 4S runs iOS 6 and never runs Cydian (docs/native.md Targets). So the answer is read
  from WebKit's main branch, not seen on the phone's iOS 15–27 builds. The code paths involved
  (createNewPage's null return, the default policy's iOS `ignore()`) have stood for years, and the behaviour is
  well known for WKWebView without delegates, but I didn't check a specific iOS build's WebKit tag.
- Whether a universal-link app (e.g. GitHub) catches the https case on a real phone: that depends on what's
  installed.
- docs/native.md has a phone checklist for after B8 lands.
