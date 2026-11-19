# Repo audit (R13, 2026-11-18)

A pass over web/app, worker/, native/, tools/ and docs/ once every other open task had landed: remove what is
unused, merge what is duplicated, fix what is stale. Behaviour stays the same and `tools/check.sh` stays green.
Each step is its own `R13 …` commit, so any one can be reverted alone.

## How things were found

- **Unused exports**: every `export` in web/app, worker/ and native/ JS, grepped (whole words) across every JS,
  HTML, Swift, C and Python file. None of web/app's modules is reached by a computed name except the screens'
  `title`/`nav`/`render`/`init`/`reselect`/`refreshInBackground` (app.js `SCREENS[tab]`), and none of those was
  touched.
- **Duplicates**: top-level functions with the same body in more than one file.
- **Unused files**: every tracked file under web/app, tools/ and native/ whose name nothing mentions; then each hit
  checked by hand, since section icons, step pictures and the glossy icon sizes are built from names at runtime.
- **Unused CSS classes**: every class in web/app's and native/'s CSS against the JS, HTML and Swift; all the hits
  turned out to be built at runtime (`glyph-${kind}`, `ph-${kind}`, `sig-row-${state}`, `is-${kind}`).
- **Stale text**: grep for the NAS, Flask, `web/app.py`, `web/fetch.py`, `web/push.py`, `web/signer/`, Web Push,
  sw.js, sidedrop, and paths named in comments that no longer exist.

## Removed

- **Dead functions and constants** (no caller anywhere, only a test or nothing): `verifyAltSource` (the add flow
  is core/sources/add.js), `sideloaderLink` and `SIDELOADER_INSTALL` (replaced by `SIDELOADERS`/`installOptions`),
  `customLabel` (lost its Queue row in the Confirm redesign, 15698d9), `groupTitle`, `sourceIconUrl` and
  `sourceBase` (superseded by `sourceIconUrls`), `isLocalUrl`, `APP_LABEL`, `DEVICE_TYPES`, `SECTION_ROW_HEIGHT`,
  and three unused DER encoders in native/sign/DER.swift (`namedBits`, `printable`, `uint`).
- **web/app/mode.js**: `tabsFor` had become the identity once every build showed every tab (e198203).
  router.js sets `TABS = ALL_TABS`; the bridge/`detectMode` tests moved to `bridge-mode.test.js`; `mkipa.py
  check` no longer asks for mode.js in the bundle.
- **Leftovers of the website's old server** (gone in F89): launch.js's `?launch=push` mark (only the deleted sw.js
  set it) and test_daemon's push.py comparison, which had skipped on every run since push.py went.
- **`export` on 92 names** used only inside their own module.
- **native/__init__.py, native/spike/__init__.py** (empty): they made `unittest discover -s native` find the spike
  tests too, so the gate ran them twice.

## Merged

- `el(tag, cls, text)`: 15 identical copies → `nav/ui.js` exports it.
- `liveHUD(text)`: 5 copies (one was settings.js `updateHUD`) → `nav/hud.js`.
- `barButton`: screens/queue.js and screens/sharedeb.js → `nav/ui.js`.
- `formatSize` (browse.js, altstore.js) → core/appqueue.js `sizeText`, which already had the same body.
- `str`/`httpUrl`: core/sources/ipa.js imports them from core/altstore.js.
- `missing`/`verificationError`: core/sources/add.js imports them from core/sources.js.
- settings.js `bridgeArch` uses compat.js's `JAILBREAK_ARCH` instead of its own copy of the map.

## Fixed text

docs/native.md (Flask and web/app.py → the Worker), worker/README.md (the website signs in the browser and uses
`/sign/upload`), README.md (same, plus `/sign/upload`), AGENTS.md (no web/requirements.txt), docs/ipa.md (a note
on what is out of date), the daemon's comments (push.py, device-check.js), backend-http.js (web/fetch.py), the
signer's comments (web/signer/, the Signing Server putting the certificate in iFizBox's IPA, signing.export's
user), and CSS/JS comments that credited sidedrop for looks.

## Left on purpose

- **Small one-line helpers repeated in unrelated modules** (`decode`/`safeDecode`, `isObj`, `isFlat`, `plural`,
  `note`, `alertOK`, `hexToken`, `esc`, `num`, previews.js's own `str`/`httpUrl`): importing them would tie
  unrelated modules together (and worker/ to web/app) for a line each.
- **Exports used only by tests** (~280): they are the tested surface of core/; most are also used inside their
  module.
- **Decision history in docs** (docs/ipa.md, docs/sideload.md's "Overruled" notes, docs/signing.md's "old
  signer" provenance of the zsign pin, `9905b05` references): that is what those passages record.
- **native/spike/**: R3's measurement spikes, still tested (test_spike.py) and cited by docs/native.md.
- **tools/themecmp.py, tools/kitmatch.py**: local reference tools (Pillow/numpy), referenced by journals and
  used by recent tasks (F126).
- **web/fixtures/ beside web/app/core/fixtures/**: moving the apt fixtures under web/app would put them in the
  static assets and the app bundle; the two folders stay.
- **app.js's service-worker unregister** (F89): returning browsers may still hold the old push worker.
- **Speed**: nothing in core/ looked slow enough to change without a phone to measure on; the gate's slow parts
  are the Swift builds (test_sign, test_sideload, the native package), which need the compile.
