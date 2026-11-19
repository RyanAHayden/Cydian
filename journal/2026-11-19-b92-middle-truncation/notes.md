# B92: long IPA file names, cut in the middle and readable in full

The user (Lite 0.9.9) saw `opentennis-beta-p146.ipa` end in "…" with no way to read the rest.

## What changed

- `web/app/core/midtrunc.js` (new): `midTruncate(text, width, measure)` is the pure part (UILineBreakModeMiddleTruncation:
  the longest start + "…" + end that fits, the end always holding the extension, the start the larger half;
  binary search over how many characters are kept, code points so no surrogate pair splits). `isFileName` (.ipa/.deb).
  The DOM part, `fitFileNames(root)`, finds `.cell-label`, `.cell-subtitle` and `.qr-name` elements whose text is a
  file name, measures with a canvas in the element's computed font, and refits from a ResizeObserver (the rows aren't
  attached when the screen builds them, so the observer's first callback does the real fit; rotation and Manage's
  slide refit too). The full name stays in `data-full` and `aria-label`. Only boxes whose width doesn't follow their
  text are in the selector, otherwise each cut would shrink the box and cut again.
- My IPAs / Install IPAs list (`libraryGroup`): `fitFileNames(box)`. App names (a parsed name) keep the tail cut.
- The app run's progress list (`screens/apprun.js`, `.qr-name`): `fitFileNames(list)`. That file wasn't on the
  task's file list; the brief's `screens/progress.js` doesn't exist (the progress page is `nav/progress.js`, the IPA
  rows are apprun.js's), so the one-line call went where the rows are built.
- The IPA's page: the header name wraps when it is the file name (`.myipa-head-file`), and the File row
  (sideload and jailbreak pages) shows the whole name wrapped beside its label (`.myipa-file`). A hold on that row
  shows the black Copy callout (nav/menu.js showMenu), and Copy copies the full name: `markFileRow`.
- The queue's Confirm (Modifications names, one per line) now wraps a name with no break in it
  (`overflow-wrap: anywhere`) instead of running off the edge.

## Decisions

- A hold on a *list* row still opens the row's action sheet (F208: Install, Sign Now, Save Signed IPA, Delete). Its
  title already shows the full name, wrapped. The Copy callout went on the IPA page's File row, the value row the brief
  likens to Contacts; putting it on the list row would have dropped the existing sheet.
- The nav bar title on the IPA page still tail-cuts (as iOS 6 nav titles do); the page body shows the name in full.
- The website's link IPAs have no File row (their page shows the link), so nothing to mark there.

## Checks

- `node --test web/app/core/midtrunc.test.js`: short names unchanged, a long name keeps start and extension, fits
  every width with a per-character and a proportional measure, very narrow keeps the extension.
- `web/app/screens/myipas-filename.test.js`: the File row is marked and its hold's Copy copies the full name.
- 3x render (`shot.mjs`, headless Chromium 390x844 @3x, a stub sideload shell): `myipas-390.png` (list),
  `row-zoom.png` (zoomed: 'opentennis…a-p146.ipa', 'SomeVeryLo…lease.ipa', one ellipsis, no CSS tail ellipsis on top;
  'Short.ipa' untouched; the named app still tail-cut), `page-390.png` (header and File row wrapped in full).
- `tools/check.sh` through `agent-runner done`.

## Not verified

- On a real iPhone: no phone test (the task doesn't ask for the iPhone 7, and the render is Chromium on Linux, whose
  Helvetica Neue stand-in measures differently). The fit measures with the page's own font, so it should hold, but
  WKWebView's canvas `measureText` vs. layout rounding is covered only by the 1px margin, untested on device.
- The hold → Copy callout was tested with stubs, not by a real touch-and-hold in a browser or on the phone.
- The apprun progress list with a file-named app wasn't rendered (only covered by the same helper as the list).
