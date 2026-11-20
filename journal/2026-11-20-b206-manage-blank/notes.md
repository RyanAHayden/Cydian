# B206: Sources > Manage was blank

## What the tap did

The tap on Manage did go to `#/sources/manage`. The page drawn there then threw and stayed empty under the
"Manage" title. Reproduced in headless Chromium (a scratch copy of `tools/smoke/smoke.mjs` that opens `#/sources`
and taps the nav bar's Manage with CDP mouse events):

- the app (fake bridge, `jailbreak: "rootless"`): hash `#/sources/manage`, empty page, page error
  `Error: no row icon globe` at `tileSvg` (icons/rowicons.js) ← `renderRoot` (screens/manage.js);
- the website with Settings > Device left at Not Jailbroken: no error. The faulty row isn't drawn there.

## Cause

F305 (b73ab9bc) added a Find More Sources row to Manage's root with `icon: rowIcon("globe")`. `globe` is a
glyph in `GLYPHS`, not a name in `ROW_ICONS`, so `tileSvg` throws. That row shows wherever `findMore.findMoreOn()`
is true, which covers the jailbreak app, the website set to a jailbroken Device, and the sideload app (Lite) with
Tweak Sources. That matches the report ("Lite and jailbroken"). F305 is in v0.17.0 and v0.17.1, and
`https://ifizbox.com/screens/manage.js` still served `rowIcon("globe")` today. F302, B177, C23 and C25 were not
involved.

## Fix

- `icons/rowicons.js`: a `findMore` row icon (purple tile, the globe glyph). It doesn't reuse `server` (teal
  globe), because that entry is the signing server and the file's rule is one name per thing.
- `screens/manage.js`: the Find More row uses `rowIcon("findMore")`.

## Test

`web/app/screens/manage-open.test.js`:
- presses Sources' nav-bar Manage, checks the route formats to `#/sources/manage` and the nav title is Manage,
  renders it through `sources.render` and checks the rows: Sources, Import & Export, Hidden, Recommended, Find
  More Sources (website backend, Device = iphoneos-arm64);
- the same with Device = none: no Find More row;
- a guard: every literal `rowIcon("…")` in web/app (not tests or vendor) names a `ROW_ICONS` entry.
With the old `rowIcon("globe")` put back, the first and third tests fail (`no row icon globe`). With the fix,
all three pass. After the fix, the browser repro shows the Manage page with all five rows and no page error.

## Tried that failed

- The first test draft used `ifizbox.device = "rootless"`, as rootcopies.test.js does. Device values are
  architectures (`iphoneos-arm64`…), so that setting didn't count as jailbroken there and Find More stayed hidden.

## Not verified

- The released .deb on the iPhone 7 and the sideload (Lite) app on a phone were not tapped by hand. I found the
  cause in code that is in both releases, reproduced it in Chromium as the app (fake bridge), and confirmed that
  the live site serves the same line. Driving the 7 needs its screen lock and an install, and the fix ships
  only with the next release anyway.
- ifizbox.com with Settings > Device set to jailbroken was not tapped in a real browser. It runs the same
  `renderRoot` path the jailbroken test covers.
