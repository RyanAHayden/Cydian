# B112: Manage marks the list inside the pinned results

Since C10 the Installed root's list sits in the pinned `.search-results` under the search bar, so
`setManaging()` and `setEditing()` (which looked for `:scope > .table` on `appView.body`) found nothing: no
`managing`/`editing` class on the list, no grey summary line.

- `installed.js`: new `appListOf(view)` finds the list where `drawAppList` appends it (`appView.results` when it
  is inside the body, else the body), skipping the Install IPAs row's `.install-ipas-top` table. Both functions use it.
- `installed-manage.test.js`: a tiny fake DOM (classList, children, before/remove) checks that Manage on marks the
  list inside `.search-results` and not the Install IPAs table, that the grey line goes right above the list, that
  off undoes both, and that a body with no search bar still gets its list found. With the old lookup this test fails
  (the fake body's querySelector finds nothing, as the real `:scope >` lookup did).

Tried and failed: nothing.

**Not verified**
- No browser render of the fix (headless 3x shot or phone). The class landing on the list is what the test
  checks; that the CSS then slides the circles in is the existing `.managing` styling, which this task didn't touch.
- `setEditing` (the jailbreak app's Apps page Edit) is covered only by the shared lookup, not by a test of its own.
