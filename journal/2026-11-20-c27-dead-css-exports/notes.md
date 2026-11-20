# C27 Dead CSS and unused exports

The brief named the CSS (from the 2026-11-20 audit) but not the "8 exports that look unused"; the audit's list
wasn't written down anywhere in the repo (only the plan line), so I re-ran the export scan myself (below).

## CSS

Each class was grepped as a whole word across web/app, native and worker (JS, HTML, Swift), and for every
string-building pattern (`"pkg-" +`, `` `pkg-${…}` ``, same for store-ratings/alt/installed/console/pkg-head).
No hits outside the CSS for any of them, so they were deleted:

- queue.css: `.console-scroll`, `.console-out`, `.console-line` (+ `.status/.error/.warning`), `.console-foot`,
  `.console-status`, `.console-progress`, `.console-fill`, `.console-finish`. The console page is drawn by
  nav/progress.js with `progress-*` classes (progress.css). **Kept**: `.console` (progress.js's page has
  `cls: "console progress-page"`), `.console .navbar.sheet-bar`, `.console .bar-button`, and `.console-log`
  (screens/queue.js:999, a saved run's log).
- packages.css: the whole `.pkg-compat` block (Works on my phone moved to `.compat-mark`), `.pkg-head-author`,
  `.store-ratings-none` (No Ratings is now the count line, storepage.test.js). `.store-ratings-from` kept, its two
  rules merged into one.
- altstore.css: `.alt-whatsnew` (What's New is storepage.js's whatsNewGroup now).
- home.css: `.installed-myipas` (3 lines). home.css isn't on the task's file line, but the brief names the class;
  a 3-line deletion, taken anyway.

Leftover mentions of `.console-scroll` in wide.css, ios6.css (has-reload selector list) and nav/statusbar.js
(SCROLLERS) are harmless selector-list entries in files outside this task's line; filed as a follow-up rather
than touched.

### Screenshots

A scratch CDP script (Chromium headless, 390x844 at 3x, the fake jailbreak bridge) shot Home, Installed,
Installed > Install IPAs (the old `.installed-myipas` page) and the console (nav/progress.js openProgress) from
a HEAD worktree and from this branch: all four PNGs are byte-identical (same md5), and none of the deleted
classes is in the DOM on any of them. No page errors.

## Exports

Scan (scratch script, not committed): every `export const/let/function/class` in web/app, worker and native
non-test JS, against the identifiers of every JS/HTML/Swift/C/Python/shell/TOML/JSON file in web/app, worker,
native, web and tools (vendor skipped). A first version ran one regex per export over every file and took
over 10 minutes; tokenising each file once took seconds.

~230 exports have no reference outside their own file. Almost all are used inside the module (kept; see
docs/audit.md). Eleven are referenced nowhere at all, not even inside their own file. I checked the namespace
imports of their modules (`import * as guides`, `import * as myipas`, the tests' `await import(...)` handles,
app.js's `gate`): all use static names, none of them these.

Deleted (8, matching the audit's count):

- core/automark.js `AUTO_MARK_FOOTER` (browse.js uses its own AUTO_UPDATE_FOOTER)
- core/asc.js `REASON_TEXT`
- core/myipas.js `hasFresh` (freshNote is what's used)
- screens/guides.js `SYSTEMS`
- screens/myipas.js `addMenu` (the old Add action sheet; the page's Add an IPA group calls pickFiles /
  chooseSiteFile / addFromUrl directly, so those helpers stay) and `installLibraryFile` (share.js no longer calls it)
- screens/storepage.js `reviewsPane` (ratingsCard and reviewsGroup stay: reviews.js and the tests use them)
- websign-gate.js `SITE_GATE_FOOTER`

Kept: core/apprun.js `APP_STATES` and core/installrun.js `STATES` (the only full list of each run's row
states), native/spike/web/meter.js `getPhase` (spike, kept by audit.md's rule). Written into docs/audit.md.

Those files are outside the task's file line (it named only the CSS files); each change is a deletion of the
dead lines and nothing else, so a merge conflict needs someone editing the same lines.

Follow-up filed: C39 (low) drops `.console-scroll` from wide.css, ios6.css and nav/statusbar.js.

## Not verified

- The package page (Works on my phone tags, author line), the App Store-style page's Reviews tab and the AltStore
  app page weren't screenshotted: with the fake bridge (every call answers null) and no network there is no
  package or app to open. The deleted classes have no producer anywhere in the code (grep, above), so these pages
  can't render differently; only the four reachable pages were compared.
- No phone run: CSS deletions with no producer, and dead exports; nothing for the phone to show.
