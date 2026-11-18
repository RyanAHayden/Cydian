# F144: Keep APT sources out of the IPA build

## What changed

- `web/app/core/altstore.js` `withAltSources`: new options `aptAllowed` (bool or function, default true) and
  `dropApt`. With APT not allowed:
  - `addSource` refuses an APT repo: a dist repo object right away, a URL once `detectSource` says it is APT (an
    app source at the same kind of URL still adds). Error `jailbreakSourceError()`: title "Jailbreak Source",
    message "This source lists tweaks for jailbroken iPhones. Cydian adds app sources here." Every Add path
    (Sources > Add, Manage > Add, cydian://add links, other apps' links, Home's More Package Sources, Import)
    already shows `error.title`/`error.message` in one alert, so they all say this.
  - `sources()` leaves the wrapped APT list out (so it isn't listed or counted anywhere), `refreshSources` never
    calls the APT side.
  - `dropApt`: once per session, every stored APT record is deleted through the wrapped calls' new `forget`
    (backend-native: device store only, no apt files read, since the sideload build has none and `removeSource`
    would fail there before deleting).
- `backend-native.js`: sideload mode sets `aptAllowed: false, dropApt: true`. Decision: the sideload IPA's
  IndexedDB is its own app container, and no jailbreak build reads it, so its APT records are deleted.
- `backend.js`: the website passes `aptAllowed: () => siteJailbroken()` (`cydian.device` set and not "none"). Stored
  APT sources are *kept* on the website (not `dropApt`), since flipping Settings > Device back to Jailbroken should
  bring them back. Jailbroken visitors: behaviour unchanged.
- Hints removed: Sources tab's "N APT sources are hidden … Jailbroken? Settings > Device." footer, Manage > Sources'
  "N APT sources hidden (Not Jailbroken)." prefix, Recommended's "Tweak repos show here once Settings > Device says
  this iPhone is jailbroken.", the source page's Open In footer "… Jailbroken? Settings > Device." (now no footer).
  Help's Which Jailbreak footer (home.js `helpJailbreakFooter`) no longer points the sideload build at Settings >
  Device (which it doesn't have); site and jailbreak app keep it.
- Share extension (`native/share/Share.swift`): in sideload mode a link unwrapped from an APT manager's scheme
  (cydia://url/, sileo://source/, zbra://sources/add/, installer://add/) is refused right away with the same title and
  message, instead of opening Add's alert first. A bare https link still goes to Add (it may be an app source without
  .json), which refuses it after Verifying URL if it is APT.
- Recommended already left tweak repos out on Not Jailbroken (`recommendedRows`); a test now pins it.

## Tests

- `web/app/core/jailbreak-sources.test.js`: refusal text (and that Share.swift uses the same words), sideload add
  refusal (URL, cydia:// link, dist repo) with app sources still added, list filtering + store deletion + no refresh,
  website toggle (kept in storage), jailbreak build unchanged, `siteJailbroken`, Recommended, and a grep test over
  strings in web/app, native/Sources and native/share for the removed hints (checked that its patterns hit the old
  texts on HEAD).
- `native/share/tests/main.swift`: new F144 route test; ran via `native/share/test_share.py` (Swift toolchain here).

## Tried / notes

- First grep pattern for Manage's template literal (`sources? hidden \(Not Jailbroken\)`) would not have matched
  `${plural(...)} hidden (Not Jailbroken)`; loosened to `hidden \(Not Jailbroken\)`.
- Left alone: Home's DEVICE_HINT (only the jailbreak app shows it, when its bridge can't tell the jailbreak), the
  Device setting's own footer on the website, the FAQ's "Settings > Device matches your jailbreak" (install help for
  jailbroken users). None says tweak repos are hidden.
- Import & Export in the IPA still lists APT lines from an imported file as New; adding them fails each with the
  Jailbreak Source message in the "Some Sources Failed" summary. Acceptable, not reworked.

## Not verified

- Not run on a phone or in the sideload IPA's WKWebView (no device step in this task; the fake IndexedDB in the node
  test stands in for the store). The sweep of old records on a real upgraded install is untested on hardware.
- The assumption that the sideload IPA's storage is never shared with the jailbreak build (separate app
  containers) was not checked on a device.
- Screens (sources.js, manage.js, handoff.js, home.js) have no DOM test for the removed footers beyond the grep test;
  not looked at in a browser.
