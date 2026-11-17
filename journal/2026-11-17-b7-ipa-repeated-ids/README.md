# B7: IPA sources with repeated bundle ids reach F42's merge

- `core/sources/ipa.js` idMaker: an entry with the same id and the same name (case-insensitive) as an earlier
  one gets that earlier id back instead of `<id>.<slug>` / `~2`, so parseAltSource sees the repeat and merges the
  entries into one version history (AppTesters via `parseIpaSource('esign', …)`). Different names still get a
  unique id as before (Scarlet's two Pokémon GO builds test still passes). Applies to every format using idMaker
  (esign, scarlet, gbox): same-name repeats there now merge too, consistent with F42.
- `parseIpaSource` rawApps: keyed by bundle id + name (parseAltSource's F42 grouping key), holding every raw entry
  of the group. App extra comes from the first entry; version extras are looked up across all the group's
  `versions[]`. RyukSign-style variants now each get their own entry's extra.
- Test in `core/sources/detect.test.js` ("B7: …"): AppTesters-style ESign merge (real and made-up ids), RyukSign
  variants' app and version extras.

Tried and failed: nothing.

**Not verified**: against the real AppTesters / RyukSign feeds (no fixture of them in the repo, and the run is
offline-only); covered by the synthetic test instead. A raw entry that parseAltSource drops (no versions) can
still be "first" in its group and supply the app extra; judged not worth the extra code.
