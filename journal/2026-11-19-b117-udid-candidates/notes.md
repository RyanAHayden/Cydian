# B117: "This iPhone's UDID isn't known" with several profile candidates

## First run (blocked)
- `web/app/screens/devaccount.js` and `native/Sources/ASC.swift` weren't on main yet (F273's merge kept only
  core/asc.js), so the task was blocked `--after F278`. F278 landed (c7df336e) and the task reopened.

## What I did
- `screens/devaccount.js`: new exported `deviceLine(request, { udid, candidates, app })`, which Check Account now
  uses. With a UDID it registers the iPhone as before. With no UDID but with `device.udid`'s candidates (the
  devices in the running app's embedded profile, one of them this iPhone, all of them the team's) it runs
  `GET /devices?limit=200` and says "This iPhone is in the account (one of the N iPhones in this app's profile)"
  when every candidate is registered and ENABLED. Otherwise it names the missing and the disabled ones, and says
  how to pair. It never POSTs a device without a known UDID.
- The pairing hint (`PAIR_HINT`) names the real path: Settings > Installation & Signing > Install Apps With: This
  iPhone, then This iPhone > Pairing (that row shows only once This iPhone is picked). The website keeps its own
  hint (Find This iPhone's UDID).
- `native/Sources/ASC.swift`: `remakeReason` takes `candidates` (default `[]`). With no UDID it gives "device" only
  when the cached profile holds none of them. `profile()` passes `PhoneID.current()`'s `.candidates`. The
  "This iPhone's UDID isn't known … every enabled iPhone" log line is gone: a profile with no known UDID still gets
  every enabled iPhone, so that line said nothing useful.
- `screens/devaccount.test.js`: four tests for `deviceLine` with a fake request (all candidates registered;
  some missing or disabled; known UDID registered or already there; no UDID and no candidates, in the app and on
  the website).

## Tried and failed
- none

## Not verified
- I didn't run the result on the iPhone 15, which is the user's daily phone and read-only for agents, so the real
  Check Account text and the profile reuse with candidates weren't seen on a device. The JS is covered by the fake
  request. The gate's native build compiles the Swift (`native/build.sh --probe` passes here). Nothing runs
  `remakeReason`'s candidate rule: there's no Swift unit test harness.
- Apple's `/devices` list is read with `limit=200` and isn't paged. A team has at most 100 iPhones per year, so one
  page covers it.
