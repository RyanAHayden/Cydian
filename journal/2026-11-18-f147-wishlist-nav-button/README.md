# F147: Wish List as a nav-bar button, not a row

## What I did
- `web/app/screens/installed.js`
  - F125's Wish List row is gone from both places: the grouped box beside Apps above dpkg's list (jailbreak app)
    and the "Packages" section under the apps (site / sideload). `wishListRow` is removed.
  - `nav(route, ctx)` adds `left: wishButton(...)` on Installed's root (`isRoot`: empty path, the only Installed
    page whose left slot isn't a back button). The old body of `nav` is now `navInfo`, untouched.
  - The button (app.js's bordered `.bar-button`) reads "Wish List", or "Wish List (n)" as Mail's "Inbox (3)"
    (n = wished, not installed, as F125's badge). A tap calls `ctx.go({ tab, path: ["wishlist"] })`: the same
    `#installed/wishlist` page, pushed with a back button.
  - The count updates in place (`updateWishButton`) when the wish list changes and when dpkg's rows or the
    apps page's installed ids arrive. The name and count are two spans so on a narrow phone the name ends in "…"
    and the count stays whole.
  - Edit: Installed's root already had Edit on the right (apps list) or nothing / Load (dpkg), so nothing moved.
- `web/app/app.js`: `button()` calls `spec.ref(b)` when a screen passes one (one line), so a screen can keep its
  bar button and change its label later.
- `web/app/packages.css`: `.wish-button` (7px padding, ellipsising name, fixed count).
- Tests (`screens/installed.test.js`): the label and count, the button's route and `ref`, the button only on the
  root (not on the wish list page or the site's dpkg page) with Edit still on the right, `#installed/wishlist`
  still the Wish List page in every mode, and the row gone (no `wishListRow` export, no Packages section / row
  subtitle in the source). The F125 count test now checks the button's label.

## Tried / failed
- First version wrote "Wish List (3)" as one string: a static mock of the nav bar (the real CSS, rendered with
  headless chromium at 375 px) cut it to "Wish List…", hiding the count beside the jailbreak app's
  User | Expert | Recent control. Split into name + count spans with less padding: at 375 px "Wish List (3)" fits
  and "(12)" shows as "Wish … (12)"; at 393 px both fit.

## Not verified
- The real app: the button on the live Installed tab, the tap pushing the Wish List page, the count changing
  in place. F125 found the site's Installed tab won't render over a static server (no Worker), and this task
  didn't call for the iPhone 7. Only a static mock of the nav bar markup was rendered (see above).
- Dark theme look of the button: it uses the shared `.bar-button` dark rules; not rendered.
