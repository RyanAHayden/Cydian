# B182: Chariz banners open "Package not found" in the sideload app

## Cause

Not a case or shape mismatch: Chariz's `sileo-featured.json` package ids match its Packages exactly. The sideload
app loads an APT source as a Tweak Source (`catalog.js` `loadSource(..., { tweaks: true })`), and
`core/catalog.js` `load()` then keeps only stanzas `core/tweaks.js injectableFromFields` accepts. The source page's
banner strip (`screens/extras.js featuredStrip`) linked every banner regardless, so a banner for a SpringBoard
tweak or one with a library dependency (Mitsuha Forever, SwitchShades, Emotive, AppAze 2, Goji, CarCast...) opened a
package page whose `catalog.package(id, key)` is null.

Measured against the live repo on 2026-11-20 (10 banners): in the sideload (tweaks) catalog only LockShut and Drift
resolve; in the rootless jailbreak catalog 4 of the 10 don't resolve either (iphoneos-arm only). So the jailbreak
app had the same dead tiles, for arch reasons.

## Fix

- `core/featured.js bannersInCatalog(banners, has)`: keeps the banners whose package `has(id)` finds, in order,
  each id asked once, a throwing lookup counting as missing.
- `featuredStrip(source, { get, has })`: filters the banners through `catalog.package(id, source.key)` before
  drawing; no banner left: no strip. `box.ready` settles when drawn (for tests). `has`/`get` are test seams.

Hiding (not opening something else) is what the brief asked for when the package isn't in the loaded catalog.
Whether the tweak filter should accept more of Chariz's tweaks is F302's question, not this one.

`homeFeatured()` has the same link shape, but nothing calls it any more (homefeatured.test.js asserts that), so
it was left alone.

## Tests

- `web/app/core/featured-b182.test.js`: a Chariz-shaped featured.json + Packages (real stanzas, trimmed), loaded
  as a Tweak Source and as a rootless catalog; only the resolvable banners are kept, each one's package() is
  non-null.
- `web/app/screens/featuredstrip-b182.test.js`: the strip draws only those tiles; none or a failed lookup: no strip.

## Not verified

- On-device check (sideload IPA, add repo.chariz.com, tap several tiles): not done. This run is unattended and
  there's no sideloaded test phone it may drive (the iPhone 7 runs the jailbreak .deb; the iPhone 15 is read-only).
  The logic was checked against the live Chariz files with node instead.
