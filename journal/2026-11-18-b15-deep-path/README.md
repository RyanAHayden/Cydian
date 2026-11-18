# B15: deep paths on cydian.dev load unstyled

**Problem.** https://cydian.dev/settings/signing gets index.html from the Worker's SPA fallback, but its relative
files resolve to /settings/style.css, /settings/app.js…, which the fallback also answers with index.html: no CSS, no
JS, stuck on "Loading".

**Fix.** An inline script at the top of `web/app/index.html` (`<script id="deep-path">`, before any relative file):
on http(s), when the path has a directory (`lastIndexOf("/") > 0`), `location.replace` to the root with the path as
the hash route: `/settings/signing` -> `/#/settings/signing`; a hash already there wins; `/x/add?url=…` ->
`/add?url=…` (keeps the add-source link app.js reads from the path). Root and one-level paths (`/`, `/add`,
`/index.html`) and the app's `cydian://app/index.html` are left alone.

**Why not `<base href="/">`.** Considered and dropped: the router writes `history.replaceState(null, "", "#/…")` and
the UI has `#…` links; with a base they resolve to `/#/…`, which in the app moves off `cydian://app/index.html` (a
link would navigate to a different document). The redirect touches nothing the app loads.

**Checked.**
- `web/app/deep-path.test.js` runs the inline script under `node:vm` with fake locations (deep, trailing slash, query,
  existing hash, deep /add, root/one-level/app scheme stay).
- Headless Chromium against a local static server with an SPA fallback (like the Worker's):
  `/settings/signing` drew the styled Signing page under Settings.

**Not verified**
- On the iPhone 7 / real cydian.dev: not deployed from a task (the runner publishes after merge), and the task didn't
  ask to drive the phone.
- In the jailbreak app's WKWebView: no device run. The script returns at once for the `cydian:` scheme (covered by
  the unit test), and no CSP blocks inline scripts there (none set in native/ or index.html).
- Real Wrangler/Workers assets fallback: not installed here; the local server mimics `not_found_handling =
  "single-page-application"`.
