# B3: asset fetches get their own rate bucket

## What I did
- `web/app.py`: `/api/fetch` now picks its token bucket by kind. Plain fetches (no `kind`: http icons, Sileo JSON
  and proxied HTML depictions, screenshots, .deb downloads) spend `asset_limiter`, 300/min per IP by default
  (`CYDIAN_ASSET_RATE`). `kind=packages` (and unknown kinds, which are rejected anyway) keep `rate_limiter`, 60/min
  (`CYDIAN_FETCH_RATE`). So a page of icons can't starve a Refresh, and a Refresh can't blank the icons.
- Picked a separate bucket over a cache: it is a few lines, needs no memory cap or eviction policy, and the list
  is virtualised, so only visible icons get fetched. 300/min = 5/s sustained with a burst of 300; every fetch
  is still size- and time-capped by the SSRF guard.
- `web/test_fetch.py` (not on the task's file list, but its `RouteTest` swaps the limiters and its
  `test_rate_limited` exercises plain fetches): swaps `asset_limiter` too, `test_rate_limited` now targets the
  asset bucket, and new `test_assets_have_their_own_bucket` checks the two buckets don't drain each other.
  The test lives there rather than in `test_app.py` because that's where the fake upstream server is.

## Tried and failed
- Running the tests with the system `python3`: no flask there; the gate's `.venv` has it.

## Not verified
- Behaviour on the live site under real browsing (many http icons + depictions): no deployment in this task.
  Covered by the route test only.
