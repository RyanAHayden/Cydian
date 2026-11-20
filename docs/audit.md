# What looks redundant but stays

Things a cleanup pass will find in web/app, worker/, native/ and tools/ that look unused or duplicated, and why
they stay. Check here before removing or merging one.

## How to find unused or duplicated code

- **Unused exports**: grep every `export` in web/app, worker/ and native/ JS (whole words) across every JS, HTML,
  Swift, C and Python file. None of web/app's modules is reached by a computed name except the screens'
  `title`/`nav`/`render`/`init`/`reselect`/`refreshInBackground` (app.js `SCREENS[tab]`).
- **Duplicates**: top-level functions with the same body in more than one file.
- **Unused files**: every tracked file under web/app, tools/ and native/ whose name nothing mentions; then check
  each hit by hand, since section icons, step pictures and the glossy icon sizes are built from names at runtime.
- **Unused CSS classes**: every class in web/app's and native/'s CSS against the JS, HTML and Swift. Many are built
  at runtime (`glyph-${kind}`, `ph-${kind}`, `sig-row-${state}`, `is-${kind}`).

## Shared helpers

- `el(tag, cls, text)` and `barButton`: `nav/ui.js`. `liveHUD(text)`: `nav/hud.js`.
- Sizes: core/appqueue.js `sizeText`.
- `str`/`httpUrl`: core/altstore.js. `missing`/`verificationError`: core/sources.js.
- The jailbreak arch map: compat.js's `JAILBREAK_ARCH`.

## Kept on purpose

- **Small one-line helpers repeated in unrelated modules** (`decode`/`safeDecode`, `isObj`, `isFlat`, `plural`,
  `note`, `alertOK`, `hexToken`, `esc`, `num`, previews.js's own `str`/`httpUrl`): importing them would tie
  unrelated modules together (and worker/ to web/app) for a line each.
- **Exports used only by tests** (~280): they are the tested surface of core/; most are also used inside their
  module.
- **native/spike/**: the measurement spikes, still tested (test_spike.py) and cited by docs/native.md.
- **tools/themecmp.py, tools/kitmatch.py**: local reference tools (Pillow/numpy), referenced by journals and
  still used.
- **tools/spinnercmp.py**: local reference tool (Pillow, needs ref/) that compares nav/spinner.js's spinners with
  the 4S's frames; rerun it whenever the spinner drawing changes. Nothing in the gate calls it.
- **tools/gsa-spike.html**: the dev-only free Apple ID sign-in page; `worker/wrangler.preview.toml` copies it into
  the preview Worker's assets. The site never links to it.
- **tools/ipa-plist-probe.py**: the standalone proof of reading an IPA's minimum iOS with range requests;
  worker/src/ipainfo.js's header points to it as the reference it was ported from.
- **web/fixtures/ beside web/app/core/fixtures/**: moving the apt fixtures under web/app would put them in the
  static assets and the app bundle; the two folders stay.
- **app.js's service-worker unregister**: returning browsers may still hold an old push worker.
- **No `__init__.py` in native/ or native/spike/**: with one, `unittest discover -s native` finds the spike tests
  too, and the gate runs them twice.
- **Speed**: nothing in core/ looks slow enough to change without a phone to measure on; the gate's slow parts are
  the Swift builds (test_sign, test_sideload, the native package), which need the compile.
