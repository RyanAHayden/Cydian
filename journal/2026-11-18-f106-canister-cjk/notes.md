# F106: Canister search for one CJK character

## Checked first (live, 2026-11-18, `curl -G --data-urlencode q=… api.canister.me/v2/jailbreak/package/search`)
- `q=a` → 400 "Query parameter 'q' must be at least 2 characters".
- `q=微`, `中`, `汉`, `化`, `é` → 200, count 0. The API's check counts UTF-8 bytes, so one CJK character passes,
  but its search finds nothing for it.
- `q=微信` → 5 packages (WeChatAtAll(微信@所有人), …); `q=中文` → 1. So CJK search works, just not on one character.

## Decision
The task said to use `searchable()` only if Canister answers 1-character queries. It accepts them but answers
nothing, so asking would be one wasted request per typing pause. Kept the 2-character rule for Canister and wrote
the finding down in `core/canister.js` and `docs/sileo-zebra.md`.

## Done
- `core/canister.js askable(q)`: 2+ characters counted as code points (before, `length` counted UTF-16 units, so
  one emoji or CJK Extension B character went to Canister). `searchUrl` and `screens/extras.js discoveryGroup` use it.
- Tests in `core/canister.test.js`.
- `docs/sileo-zebra.md` "Cydian today" for search: F101's word-start tier, length/sources tie-breaks, the
  one-Latin-character skip, and the Canister CJK finding.

## Not verified
- The Search screen in a browser or the app: the change there is one condition swapped for `askable()`, covered by
  the unit tests; no UI render was done.
- Whether Canister's empty answer for one CJK character could change later (it's their search backend's behaviour,
  not a documented rule). Re-check with the curl above if it matters.
