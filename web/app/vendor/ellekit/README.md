# ElleKit, bundled for tweak injection

`ellekit_1.2_iphoneos-arm64.deb` is ElleKit 1.2, rootless (`/var/jb`), exactly as its own apt repository serves it.
When a tweak added in "Inject Tweaks" links CydiaSubstrate and the user added no ElleKit (or CydiaSubstrate.framework)
of their own, the signer adds this package's `usr/lib/libellekit.dylib` to the app's `Frameworks/` and points the
tweak's CydiaSubstrate load command at it (`web/app/core/tweaks.js` `ELLEKIT`, `withElleKit`; loaded and checked
by `web/app/screens/tweaks.js` `loadElleKit`). Nothing else from the package goes into the app.

- Source: https://ellekit.space/pool/ellekit_1.2_iphoneos-arm64.deb (repository https://ellekit.space, index
  https://ellekit.space/Packages, maintainer Dhinak G)
- SHA-256: `e21dc91bdc1be193dc915daecfff45256239b4fe583a36861e662ab1f43906dc` (331444 bytes), the same as the
  repository's `Packages` stanza for `ellekit` 1.2 `iphoneos-arm64`. The page refuses the file when its hash differs.
- Code: https://github.com/tealbathingsuit/ellekit (formerly evelyneee/ellekit)
- Licence: BSD-3-Clause, `LICENSE` here (copied from the package's `usr/share/doc/ellekit/LICENSE`). It allows
  redistributing the binary with the notice, and is compatible with this project's GPL-3.0-or-later.

To update: take the new `iphoneos-arm64` stanza from https://ellekit.space/Packages, download its `Filename`, check
its SHA-256 against the stanza, replace the file and change `ELLEKIT` in `core/tweaks.js` (version, file, source,
sha256, size); `core/tweaks.test.js` checks the file against `ELLEKIT`.
