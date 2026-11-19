# C10: one search bar everywhere

## What changed

- `web/app/nav/searchbar.js` (new): `searchBar({ placeholder, ariaLabel, value, onQuery, delay, onSubmit, onFocus,
  className })` builds the grey bar with iOS 6's Cancel (shown while focused or holding text, packages.css as
  before); Cancel empties the field, calls `onQuery("")` and blurs. `delay` debounces typing; Search (submit) and
  Cancel run at once and drop a pending keystroke. `bar.set(text)` puts text in without querying (Search's Recent
  rows). `pinned(body, ...head)` is Search's `.search-root` layout: the head nodes stay put, the returned
  `.search-results` (data-scroller) scrolls and bounces. `scrollerOf(body)` gives the scroller of a pinned page.
- Search, Sources, Changes, Installed (apps page and dpkg page), My IPAs (list page and the two older Search Apps /
  All Apps / category pages) build their bar with it and pin it. Their own copies are gone.
- Placeholders: Sources "Search Sources", Changes "Search Changes", Installed apps and My IPAs "Search Apps",
  the dpkg list "Search Tweaks" (the site's dpkg page too: it is the same list), Search tab
  `searchPlaceholder(mode)`: "Search Tweaks" in the jailbreak app, else "Search Apps".
- What each page shows above its bar stays pinned too (Sources' refresh strip). Installed's dpkg page: its Apps row
  (jailbreak app) used to sit above the bar; it now scrolls with the list under the bar, so the pinned part is only
  the bar and the kinds. My IPAs' Too Big note moved under the bar likewise (myipas.css's comment already said
  "under the bar").
- packages.css: `.search-root` takes effect only while the page has its `.search-results` (`:has`), so a page
  redrawn without a bar (Installed's empty/error states, Sources' load error) scrolls as before; every pinned head
  node is `flex: none`; the A–Z index rules also match the results scroller (rows end before the index, the bar and
  kinds end short of it).
- app.js: the tab bar's second tap scrolls `scrollerOf(page body)`, so it still slides a pinned list to the top
  (and on Search it now scrolls the results up before focusing the field, as iOS does).
- Test: `web/app/nav/searchbar.test.js` (bar built, Cancel, debounce, set, pinned, the five screens import and call
  the shared function and build no field or Cancel of their own, placeholders).

## Checked

- `node --test web/app`: 1803 pass, 0 fail (before the gate).
- Headless Chromium (390x844 @2x, local http.server, CDP, focus emulation) on the site build: Search, Sources,
  Changes and My IPAs each show the bar with their placeholder, `.search-root` with a `.search-results`; setting
  the results' scrollTop leaves the bar where it was; Cancel's computed display is `block` with the field focused.
  Screenshots looked right (Sources, My IPAs).

## Not verified

- Installed's dpkg page and the apps page with rows in a browser: the site had no status file and no apps in the
  headless profile, so neither bar was drawn there. Covered only by the existing Installed tests and the static test.
- The A–Z index beside a pinned list (dpkg page, My IPAs' All Apps): CSS and code paths changed (the index now sits
  in the page body beside the results scroller); not looked at in a browser for lack of data.
- iPhone bounce feel (the results rubber-banding under the bar) on the iPhone 7 / jailbreak app: the task didn't
  ask for a phone run; Search already uses this layout there.
