# B43: a pushed page opens on its default segment, filter or pane

## What I did

- One hook in nav: `web/app/nav/pagestate.js` (`onPageOpen(match, reset)`, `pageOpened(route)`). `app.js makePage`
  calls `pageOpened(mounted route)` before the screen's `nav()` and `render()`. makePage runs only when a page is
  built (a push, a deep link's levels, a tab's first visit); Back and tab switches build nothing (nav/stack.js keeps
  the pages), so they keep what a page showed. Tab roots are built once, so their state lasts across tab switches.
  (app.js was outside the brief's file list; it is a two-line change: the import and the call.)
- Browse (`browse.js`): resets `browseHome.filter` to Featured when Home's Browse page opens; the filter is now also
  kept on each page object (`page.filter`) and each page's segment bar redraws its own page, so a Browse page below
  another one would keep its choice too.
- Installed (`installed.js`): the apps page (pushed in the jailbreak app; the root elsewhere) resets mode/query/Edit;
  the dpkg page (pushed on the site; the root in the jailbreak app) resets mode/type/query; the Wish List leaves Edit.
  Resetting a root on its one build is harmless (defaults then anyway).
- Account (`account.js`): Show Account Key closes when the Account page is pushed again.
- Audit, no change needed: Search's `state.filters`/query only drive the Search root (pages under Search are
  browse.js pages and don't read them); Changes and Sources keep root-only state; My IPAs' list already reset its
  edit state in nav(); store page tabs are per page (storepage.js storeTabs); Sign Options rebuilds its edits on
  every render; localStorage holds only data or preferences (roulette spins, guide ticks, Theme split height), not
  which segment a page opens on.

## Tests

- `nav/pagestate.test.js`: the registry, push vs Back vs tab switch with the real stacks, and that makePage calls it
  before nav/render.
- `browse-filter.test.js`: no longer expects the choice to stick across pushes; new B43 test (Top 25, package, Back
  -> Top 25; tab switch -> Top 25; Home > Browse again -> Featured).
- `installed-pagestate.test.js`: jailbreak apps page and site dpkg page / Wish List, as above.
- home-browse.test.js had no persistence expectation; unchanged.

## Not verified

- Not checked in a browser or on the iPhone 7: the task doesn't allow driving the phone, and the node tests run the
  real stacks and resets but not the DOM drawing of the reset pages (e.g. that Installed's title segments show User
  after the reset; they read the same state objects in nav(), which now runs after the reset).
