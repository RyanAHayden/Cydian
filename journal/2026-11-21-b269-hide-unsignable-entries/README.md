# B269: hide entries the sideload build can't sign

## What the report meant

The only message in the app that says "not an app you can sign" is the tweak check's refusal
(`core/tweaks.js` inspectTweakDeb: "It's for iOS itself (SpringBoard or a system app), not an app you can sign.").
So two kinds of rows can lead to a dead end, and both are handled:

1. **IPA source app entries** that Install can't sign: no IPA download (none, or only an itms-services /
   manifest link), a `.deb`, an App Store page, a web clip (`.mobileconfig`). The install page's check is
   `core/appqueue.js` appJob (built on `installOptions`).
2. **Tweak Source rows** whose `.deb` was already checked on this device and refused (for iOS itself, a library…).

## What changed

- `web/app/core/altstore.js`: `signableDownload(url)` and `signableApp(stanza)`, both `{ ok, why }`, beside
  `installOptions`. First tried as a new `core/signable.js`: `module-graph.test.js` failed (app.js's startup closure
  went over its module budget), so they live in a module already in that closure.
- `core/appqueue.js` appJob asks `signableDownload` too, so the list's check and Install's check are the same one:
  a row the list keeps queues a job, a row whose Install would refuse is hidden (the test checks both directions
  for every entry).
- `core/catalog.js`: each AltStore app row gets `unsignable` at load; while not jailbroken (`appsOnly`, the
  sideload build) `rowsOf` drops them, which covers a source's own list, All Sources, Search, Browse, Popular,
  Free, sections' counts; `featured()` and `altSource().count` skip them too. `package()` still opens one (an old
  link still has a page).
- Unsupported iOS needed nothing new: `appStanza` already keeps only the versions that run on the phone's iOS and
  drops an entry with none.
- `screens/tweaks.js` `addableTweakRows` + `screens/browse.js` `sideloadListRows`: in the sideload build a Tweak
  Source's list leaves out tweaks whose cached check failed. Browse Tweak Sources (pickSourceTweak) and Made for
  This App already did; unchecked tweaks stay listed (checking needs the `.deb`).

Decision: the catalog filter keys on "not jailbroken" (`appsOnly`), not on the build, so the website with
Settings > Not Jailbroken hides these entries too. It signs the same way, so those rows were dead ends there as well.

## Tests

- `web/app/core/altstore-signable.test.js`: a mixed source (good IPA, extension-less release IPA, no download, manifest
  only, itms link, .deb, App Store link, web clip, minOS 28) through list/All/Search/free/count/sections, appJob
  agreement, and a jailbroken phone unchanged.
- `web/app/screens/tweaks-addable.test.js`: refused/addable/unchecked tweak rows, sideload only.

## Not verified

- Not checked on the iPhone 15 Pro (sideload build): the change is in pure catalog/list code covered by node tests,
  and the task asked for a node test only.
- Tweaks never checked on this device still show in a Tweak Source's list; a tap checks them and may still show the
  refusal once (then the row goes). Hiding them up front would need each `.deb` downloaded.
