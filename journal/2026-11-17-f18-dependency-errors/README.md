# F18 Plain-language dependency errors

## What I did
- `web/app/core/deps.js` (new, pure JS): `depIndex({ available, installed })` indexes every package and what it
  `Provides` (apt's rule: an unversioned Provides only satisfies unversioned dependencies). `explain(stanza, { device,
  index })` walks Pre-Depends/Depends (alternatives, installed first, then any source version; dependencies of the
  packages that would be installed are followed 4 levels down), then Conflicts/Breaks against installed packages,
  and installed packages whose Conflicts/Breaks hit this one. Each problem is one sentence plus an action:
  - `ios`: "Needs iOS 16.0 or later (you have 15.4)." / "Doesn't work on iOS 17.0 or later (you have 17.2).", with
    the `firmware` meta-package explained in `detail`. The iOS version comes from the device, else from an installed
    `firmware` stanza in dpkg's status (the app). `cy+…`/`gsc.…` are only checked when dpkg's status lists them.
  - `ios-unknown` (not blocking): "…: set your iOS version in Settings to check." -> Settings > iOS Version (site only).
  - `missing`: "Needs X, which none of your sources has; it is on Chariz." -> Add Chariz; without a known home
    "…: add the source that carries it." and no action.
  - `version`: "Needs LibOld 2.0 or later; your sources have 1.5 at most." -> Open LibOld.
  - `conflict` / `conflicted`: "Conflicts with Other, which is installed (remove Other first)." -> Remove Other
    (N4's `queue({op:"remove"})` when the backend has it; until then "Open Other", its page).
  - Through a chain: "Needs Example Lib, which needs com.example.deeper, which none of your sources has…".
  - `targets`: each Depends name -> the id to open, so a virtual name (mobilesubstrate) opens its provider
    (ElleKit) (Zebra #1414).
- `explainApt(output, ctx)`: reads apt-get's "unmet dependencies" lines and `E: Unable to locate package` /
  `has no installation candidate` into the same sentences, named after the package. For N4's Confirm sheet (noted on N4).
- `KNOWN_HOMES`: where common libraries live when no source of the user's has them. Only rootless builds I checked
  in each repo's Packages.bz2 on 2026-11-17 (ElleKit: ellekit/mobilesubstrate/libhooker; palera1n: preferenceloader;
  Chariz: Cephei ws.hbang.common, Alderis/libcolorpicker, Orion; Havoc: libgcuniversal). All four repos are in
  core/recommended.js already.
- `core/catalog.js`: `deps(id, key)` op (index over every APT source incl. older versions + dpkg status, cached until
  a source or the status changes); `catalog.js` forwards it.
- Package page (`screens/browse.js`): a "Can't Install Yet" (or "Before Installing" for notes only) section above
  Depends: each sentence in a wrapping cell with its action row under it, firmware explanation as the footer. Depends
  rows link virtual names to their provider.
- Tests: `core/deps.test.js`, one fixture per kind (ios, ios upper bound, Conflicts: firmware, firmware from status,
  ios-unknown, missing+home, missing, version, installed-too-old, conflict, conflicted, chain, Provides/alternatives,
  apt output) and the catalog op.

## Tried, failed
- First screenshot of my markup mock was black: `.page` is `visibility: hidden` until the nav shows it; forced it
  visible in the mock. The first layout had the sentence and its action as two touching tables; merged into one
  table (`problems-mock.png`).

## Decisions
- A conflict is "blocking" per the brief's wording even though `apt-get install` would offer to remove the other
  package itself; the sentence says to remove it first, which is what Cydia users expect.
- Dependencies' own Conflicts are not checked (only the package asked about): apt reports those in the Confirm sheet.
- No known home -> no action rather than a guess.

## Not verified
- The real package page in a browser with live sources: earlier tasks (F46) found headless Chromium never gets
  `catalog.ensure()` past the worker start, so I screenshotted a static mock built from the same classes and CSS
  (`problems-mock.png`), not the running page. The worker op and the core are node-tested.
- The Add action (`addSource` prefilled with the repo URL) and the Remove action through `queue()`: N4's queue
  doesn't exist yet, and no browser run; only read through.
- Dark theme look of the new section: not rendered.
- `explainApt` against real apt-get output on a phone: no jailbroken test phone (user 2026-11-17); the fixture is
  written from apt's message formats.
