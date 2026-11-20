# F306: Why tile, installed app vs web

## What changed
- `web/app/screens/why.js`
  - `WHY_POINTS`: "One App, Jailbroken or Not" (builds) first, "Tweaks in Sideloaded Apps" second. The lead styling
    (`why-lead`) follows index 0, so it moves with the order on its own.
  - New tile rule: `showsWhyTile(mode, opened)` is true on the website always, and in the installed apps (sideload
    and jailbreak) until the page has been opened there. `whyOpened()` / `markWhyOpened()` read and write
    `ifizbox.whyOpened` (`WHY_OPENED_KEY`, built from brand.js's NAME because why.test.js forbids the name in
    why.js) in localStorage, try/catch'd (blocked storage keeps the tile). `render()` marks it in any mode but "site".
  - `whyAboutSection(mode)`: the Settings root's "About" group with one "Why <NAME>?" row to `#/home/why`
    (installed apps only; null on the website).
- `web/app/screens/home.js`: the tile's `hidden` uses `why.whyOpened()` instead of signing set-up; on Back to Home's
  root the hashchange handler re-runs `drawThemes()` when the tile should now go (nav/slide.js fades it out and
  slides the rows up, no teleport).
- `web/app/screens/settings.js`: the root draws `whyAboutSection(detectMode())` just above the version line.
- notiphone.js untouched (its Why row stays).

## Decisions
- **"Settings > About" doesn't exist.** F183 removed Settings' About page on purpose (settings.test.js forbids an
  about route, an `"about"` string in settings.js, and an "About" text on the website's Settings root). The only
  About is Home's nav-bar About alert. I read the brief's "a row there; add it to About in both builds" as: a group
  headed **About** on Settings' root, with the Why row, in both installed builds. It's a one-row group, not a page,
  so F183's rules still hold (the website's root, which F183's test draws, doesn't show it). A button in Home's
  About alert was the other choice; rejected because a navigation button in an alert is un-iOS, and the brief says
  Settings and "a row".
- The About row shows in the installed apps always (not only after opening), so it's findable from day one.
- Icon: the existing `rowIcon("recommended")` gold star (Home's Why glyph is an orange star), so rowicons.js stays
  untouched.
- The jailbreak app now shows the tile to first-time users too (it never did before), as the brief asks.

## Tests
- `why.test.js`: new order and titles, shot order, `showsWhyTile` table for site/sideload/jailbreak, and an F306
  test that renders the page into a fake DOM with a memory Storage per installed mode (tile shown → render →
  key stored → tile gone → About row present), the website (nothing stored, no About group), throwing storage,
  and source checks that settings.js draws it before the version line and home.js re-checks on Back.
- `node --test` on why/settings/home tests: pass. `tools/check.sh`: run by `done`.

## Not verified
- Not run on a phone or in a browser (no device step in the task; the 7 is for .deb tests only when a task says so):
  the tile fading out on Back from Why, and the About group's look on Settings' root, are checked by unit tests and
  source matches only.
- localStorage persisting across app relaunches in the WKWebView is assumed from the other `ifizbox.*` flags
  (`recommendedSeen`, `exposureSeen`) that rely on the same thing; not re-tested here.
