# F207: Delete My Review

## What changed
- `worker/src/reviews.js` DELETE:
  - `DELETE /reviews/<pkg>/<rid>` with `Authorization: Bearer <REVIEWS_ADMIN>` works as before (no rate limit).
  - Otherwise it needs `X-Review-Token`. If that token wrote the review, the review and its reports are deleted,
    answering `{ok, id}`. Another token gets 403, no token gets 403, and an unknown id or wrong package gets 404.
  - `DELETE /reviews/<pkg>` with a token deletes that token's own review on the package (404 when it has none).
    The admin secret alone without an id gets 403.
  - Token deletes count as writes: the per-address and per-token minute limits and the per-address daily limit
    (REVIEW_DAILY) all apply.
  - GET counts and the histogram come from the table, so a deleted review drops out of them.
- `web/app/core/reviews.js`: `reviewsApi().remove(id, reviewId?)` sends DELETE with the token, by review id when one
  is given, else by package.
- `web/app/screens/reviews.js`:
  - `writeReviewSheet({ onDelete, confirmDelete })`: when there is an `initial` review and `onDelete`, a red
    **Delete Review** button (`action-button destructive`, the iOS 6 UIActionSheet destroy button, the same one as
    Settings > Account's Delete Account) sits at the bottom. It asks first, then calls onDelete and closes. If the
    delete fails, the error shows under the form.
  - `reviewsTab`: Edit Your Review passes `onDelete` only when `mine` exists. The user's own row in the list gets a
    small red "Delete Review" text button where other rows have Report.
  - Both paths ask with `showActionSheet({ buttons: ["Delete Review"], destructive: 0 })` (red Delete Review, then
    Cancel). After that they call `api.remove(id, mine.id)` and redraw the tab: the list is fetched again, the
    stars, count, bars and list update, `onRating` updates the header, and Tap to Rate goes back to "Tap to Rate:"
    with no stars lit. The button turns back into "Write a Review".
- `web/app/reviews.css`: added rules only (`.review-delete-wrap`, `.review-delete`, `.review-delete-own`, and a dark
  variant using `--dk-bad`).

## Files beyond the brief's list
- `worker/test.mjs`: the gate runs only `node worker/test.mjs`, so the Worker tests went there. No
  `worker/src/*.test.js` or `worker/test/` is run by check.sh.
- `web/app/reviews.css`: the button styles. The rules were appended, so a merge conflict is unlikely.

## Checks
- `node worker/test.mjs`:
  - the owner token deletes by id and by package
  - another token gets 403, no token gets 403, the wrong package gets 404, already deleted gets 404
  - the count, histogram and average drop the review, and `mine` becomes null
  - admin still deletes, and admin without an id gets 403
  - token deletes are rate-limited (4 a minute per token, then 429)
- `node --test web/app`: 1185 pass. New tests:
  - remove() URLs, method, token and errors
  - the sheet's button appears only with an initial review; Cancel deletes nothing; confirm deletes and closes;
    an error stays open
  - in the tab, the own-row button appears only on your row (Report stays on the others), and Cancel does nothing
  - after a delete: the list is fetched again, Tap to Rate is empty, the header count updates, and the sheet gets
    no onDelete
- Headless Chromium renders at 3x of `harness.html` (the real CSS and modules, with a fake API):
  - `tab.png`: the own row with red Delete Review
  - `sheet.png`: the sheet with the red destructive button
  - `ask.png`: the action sheet, red Delete Review over the dark Cancel
  - `deleted.png`: after deleting, 2 ratings at 3.5, "Tap to Rate:" with grey stars, and "Write a Review"

## Decisions (no one to ask)
- On the row, the button is a small red text button rather than a full-width red button, so the cell keeps
  Report's layout. The full iOS 6 destructive button is in the sheet.
- The client sends the review id when it knows it (`mine.id`). That route also covers a hidden review.
- Token deletes are rate-limited like posts, as the brief asked. Admin deletes are not, as before.

## Deploy
- No manual step was taken. worker/README.md says ifizbox.com deploys with Workers Builds on every push to main
  (`npx wrangler deploy -c wrangler.ifizbox.toml`), so this goes live when the runner merges and publishes main.
  No schema change and no new secret are needed.

## Not verified
- The live site: until main is deployed, ifizbox.com runs the old Worker. There, a token DELETE gets 403 and the
  sheet shows the error under the form. I did not run a real Worker with D1. The Worker logic was tested against
  Node's SQLite D1 shim (`src/d1-sqlite.js`), and the UI only in a harness, not on the deployed website.
- iPhone 7: not run. The app has to be built and installed with the new web/app, and the endpoint only exists once
  the Worker is deployed. A follow-up check on the phone after the deploy is still needed.
- Dark theme render: not captured. The dark rule uses the `--dk-bad` token, and the theme palette test passes.
