# B177: a failed source opens its page, with the error and what to do; BigBoss reads again

## Why BigBoss failed (our side, fixed)

BigBoss (`http://apt.thebigboss.org/repofiles/cydia/`, suite stable/main) serves `Packages.bz2` alone. `.xz`, `.gz`
and `.zst` are 404s, and plain `Packages` is a **302 to an HTML page** (`thebigboss.org/hosting-repository-cydia`) that
begins with `\r\n\r\n\r\n <!-- Start header.php -->`. Checked with curl on 2026-11-20. The Release is fine over http.
https doesn't work there (the certificate is for another host).

- **Sideload app (Tweak Sources)**: the shell's `net.packages` (native/Sources/Apt.swift) tries .xz, .gz and plain only.
  Its "an HTML page is no index" check looks at the first byte only (`<`), so the redirect page, which starts with
  blank lines, went through as the index. The result was 0 packages (or `not_found: no Packages index in …` where the
  page is skipped). A real phone wasn't checked to see which of the two the user got. Both are fixed.
- **Website**: the Worker's `kind=packages` reads Packages.gz, then plain Packages (no decompressor for bz2), and so
  hits the same HTML page.
- **Jailbreak app**: apt reads `.bz2` itself, and backend-native reads apt's list first. It wasn't affected unless apt
  had no list.

Fix, all in web/app (the task's files):
- `backend-native.js` `packages()`: a `not_found` from net.packages, or an answer that starts (after whitespace) with
  `<`, falls back to `packagesInJs`. That fetches `Packages.bz2`, then `Packages.zst`, through `net.fetch`, and unpacks
  them with `core/unpack.js` (which already had bunzip2 and unzstd).
- `backend-http.js` `packages()`: the same fallback, through the proxy's plain `?url=` fetch.
- Measured on desktop node: BigBoss's 1.3 MB bz2 unpacks to 8.2 MB in about 420 ms. `countInjectable` gives 4362.
  In the Chromium harness (sideload mode, a fake shell that copies Swift's first-byte check), BigBoss went from 0 to
  **4,362**.

## Failed source page

- Sources: a tap on a failed row now **pushes its source page** like any other row. F233's tap-to-retry is gone (it
  looked like nothing happened when the retry failed again). The chevron is back on failed rows. The hold menu's
  "Open" became "Refresh" (the old retry). The row's aria-description says a tap shows the error.
- `screens/sourceerror.js` (new) adds a "Refresh Failed" group at the top of the source page: every distinct error in
  full (the live reason from this session's run, the record's `error`, apt's `aptError`, the catalog status), wrapped
  and selectable. It uses Cydia's package-warning look (rows on #fdd, docs/cydia.md), with the URL tried as the footer.
  Below that come **Refresh Source** (sources.js `retrySource`: the row spins and the badge counts; then the catalog
  loads and the page redraws), **Edit Source** (Manage's Enter URL alert with the URL filled in, titled Edit Source /
  Save; a new URL that verifies replaces the old source and its page opens), **Copy Error**, **Share Error** (the share
  sheet, or the clipboard where there is none), and **Remove Source** (red, after an alert; the page goes Back). Built-in
  sources get no Edit or Remove.
- Used on both kinds of source page: APT (browse.js drawSections, which replaces the old grey error note and the
  aptError line) and app sources (altstore.js, including one that never loaded: the group plus Share replace the bare
  note).
- `retrySource` works without a run's rows (from the page after a relaunch). manage.addSource returns the saved
  record and takes an `edit` option.
- sources.js passes its state to sourceerror.js through `setSourceErrorHooks` (an import would make a cycle with
  browse.js).

## 3x render

`capture.mjs` here is the B129 harness plus `FAIL=host` (net.fetch and net.packages fail as for a dead host), with the
fake net.packages copying Swift's first-byte HTML check. Run with `--mode sideload FAIL=havoc.app`. Shots:
`failed-page.png` (light), `failed-page-dark.png` (dark), `sources.png`. The error cell's border and corners were
zoomed in and look clean. The dark theme tints the palette's cell with `color-mix`, falling back to the plain cell on
iOS 15, which lacks it.

## Tests

`backend-native-bz2.test.js`, `backend-http-bz2.test.js` and `screens/sourceerror.test.js`.

## Not verified

- **No phone run.** Neither the sideload build nor the jailbreak .deb was built or installed, and the task doesn't name
  the iPhone 7. The shell's real `net.fetch` of BigBoss's 1.3 MB bz2 over plain http (ATS) is untested: net.packages
  already fetched the same host over http, so it should work.
- **Main-thread time on a phone**: bunzip2 runs on the page's thread (about 0.4 s on desktop, likely 1–2 s on an iPhone
  7) once per BigBoss refresh. Not measured.
- **The website path** was only tested with a fake proxy. The live Worker wasn't called (deploying is out of scope), and
  the proxy's follow-redirect behaviour is inferred, not observed.
- **Share Error** with `navigator.share` in WKWebView, and Copy's HUD, weren't tried on a device. In Chromium the
  buttons were rendered but not tapped. Edit Source and Remove Source were only reviewed in code: the harness's taps
  use `el.click()`, which the tap guard ignores.
- Which exact error text the user saw on BigBoss isn't known: either 0 packages or `no Packages index`.
- The native shell's own check (Apt.swift: first byte only, no .bz2) is left as it is. It's outside the task's files
  and the JS covers it. Filed as a low follow-up.
