# F157: User Guides as iOS 6 app pages, and lite hides the jailbreak guides

## What I did
- `web/app/screens/guides.js` rewritten. It holds the data (FAQ, steps, Copying Files sections), `guidePage(path, lite)`
  (routes: `guides`, `guides/<id>`, `guides/faq/<answer id>`), `nav`, `render`, and the step ticks
  (`localStorage["cydian.guideSteps.<guide>"]`, a JSON list of ticked step numbers).
  - FAQ: question rows grouped as Getting Started / Problems / Sources. Each opens an answer page on Home's stack (title
    "FAQ"): a bold question heading, the answer in a white cell or as numbered steps, then a **Next** group linking to
    Settings > Device, Refresh Sources (the Sources tab), Installed, Add a Source (Sources > Manage > Sources),
    More Package Sources (Sources > Manage), Help, Settings > Signing and Install IPAs.
  - Copying Files: a `.segmented` control (packages.css) with On iPhone (Filza icon row linking to its package page,
    plus a "Filza Can" list), Computer (SFTP / iPhone's IP / mobile / 22 label/value rows, the OpenSSH guide row,
    Cyberduck / WinSCP / FileZilla), and No Jailbreak.
  - OpenSSH: four steps. Each has a blue gloss badge that turns green with a ✓ when tapped, and the tick is kept.
    Step 1 has an Install row for `openssh` (`#/search/package:openssh`). The ssh command sits in a black terminal
    panel (progress.css `.pl-raw`, F151's log) with Copy. Log In has a "Still alpine?" row that opens Root Password.
  - Root Password: one yellow warning row, the whole session as a transcript, then three steps, each command with Copy.
  - Lite (`isLite(settings.deviceType())`: always in the sideload build; on the website while Settings > Device says
    Not Jailbroken, as F144) has no OpenSSH or Root Password guide (an old link shows the guide list). Its FAQ covers
    apps, signing and sources only. Copying Files there is the no-jailbreak page with no segmented control: Files,
    AirDrop, LocalSend, Finder / iTunes File Sharing.
- `home.js`: `nav`/`render` for `guides/...` go through guides.js; Home's User Guides rows follow lite.
- `nav/ui.js`: added `row()` (one cell on its own), so a step's table can hold its Install / Still alpine? rows.
- `guides.css` (new, linked in index.html): the question heading, wrapping answer text, number badges, terminal panel and
  Copy button, the warning row. Everything else is ios6.css and packages.css.
- Tests: `screens/guides.test.js` covers routes and titles (full and lite), FAQ answers and Next targets, step ticking
  and persistence, Copy (and no "Copied" when it fails), the Copying Files segments, and a grep over every page lite
  renders for jailbreak words and links. `home.test.js` now checks guide titles through guides.js.

## Decisions (unattended)
- I couldn't open the concept at claude.ai/artifact (it needs a login and isn't in the repo). I built the pages from
  the brief's description.
- The SFTP apps are plain rows with their platform as detail, not external links: grouped rows open hrefs in the app's
  own WebView.
- Copying Files in lite also answers lite's "Copying Files to/from Device" row; the FAQ's "What is Cydian?" gets its
  own lite wording.
- The ssh command shows a computer prompt (`$`); the Root Password commands show `iPhone:~ mobile$`.

## Tried and failed
- The first screenshot server served `web/app` through a symlink under another path; the app redirected to `/` and
  showed a directory listing. Serving a scratch copy at the root worked.

## Checked
- Headless Chromium at 390 px, 2x: OpenSSH, Root Password, Copying Files and an answer page (jailbroken), and Copying
  Files (lite). Screenshots are in this folder.

## Not verified
- Not checked against the approved concept artifact: it wasn't reachable (see above).
- Not run in the jailbreak app or the sideload IPA on a phone: the task asked for node tests only, and the iPhone 7
  wasn't part of it. The Copy button there uses `nav/menu.js copyText` (navigator.clipboard with an execCommand fallback),
  which I didn't try in WKWebView.
- Dark theme: only the warning row has dark colours. I didn't render the other pages in dark.
- No 3x zoomed comparison of the badges against the 4S's art (ref/ isn't linked in this worktree). The badge gloss
  isn't sampled from a kit element.
