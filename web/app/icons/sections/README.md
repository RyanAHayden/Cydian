# Cydia's section icons, purpose badges and unknown.png

These PNGs are Cydia's own artwork by Jay Freeman (saurik), copied unchanged from Cydia's source repository
(git://git.saurik.com/cydia.git, commit 837b7c8801dabaec33c55494047540b6ac6ef22d, 2019-05-20):

- `*.png` here: `MobileCydia.app/Sections/*.png` (39 section icons, 120×120);
- `unknown.png`: `MobileCydia.app/unknown.png` (the icon for a section with none);
- `purposes/*.png`: `MobileCydia.app/Purposes/*.png` (the `purpose::` tag badges, 32×32).

Cydia's repository is licensed GPL-3.0 (its `COPYING`), which iFizBox (GPL-3.0-or-later) can include. They match
the icons on an iPhone 4S running Cydia 1.1.30 pixel for pixel, apart from Apple's CgBI rounding at the edges.
The 4S's other 29 icons (`HYI_-_*`, `SiNfuL_iPhone`, `Planet-iPhones Mods`) were put there by third-party
repositories, are not Cydia's and are not included.

Used by `core/sectionicons.js` (F126). Cydia's logo is not among them and must never be added.
