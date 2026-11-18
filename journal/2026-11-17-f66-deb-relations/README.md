# F66: the jailbreak .deb depends on unzip and recommends ldid

## Done
- `native/deb/control`: `Depends: firmware (>= 15.0), uikittools, unzip` and a new `Recommends: ldid`.
  unzip is a hard dependency because install-ipa (F59, `native/helper/ipa.c`) unpacks every IPA with
  `<prefix>/usr/bin/unzip`; ldid is only needed when AppSync Unified is missing, so it is a recommendation
  (Sileo/Zebra install Recommends by default; apt-get does too unless told not to).
- `native/mkdeb.py check`: `WANT_RELATIONS` lists the names each relation field must hold (Depends: firmware,
  uikittools, unzip; Recommends: ldid), parsed by `relation_names()` (splits on `,` and `|`, drops version,
  arch qualifier). A control without them is flagged ("control Depends lacks unzip").
- `native/test_native.py`: `test_relations_flagged` (parser, and a control stripped of both is flagged).

- Outside the brief, to get the gate through: `native/sign/IPASigner.swift` walked `bundles.keys` (a Swift
  dictionary, whose order changes per process because hashing is seeded per run) to list the extensions an
  explicit profile cuts. So `removed` came out in random order, and `test_sideload`'s "sign with the user's edits"
  check (it expects `["PlugIns/Share.appex", "PlugIns/Widget.appex"]`) failed about half the time. It now walks
  `bundles.keys.sorted()`, which keeps the result stable. Passed 4 of 4 runs with `.venv/bin/python`.

## Tried and failed
- First `done`: the gate failed on that flaky sideload check (unrelated to the .deb change).

## Not verified
- Installing on a phone (that apt pulls unzip and ldid from Procursus): no jailbroken iOS 15+ test phone, and
  the 4S is iOS 6 rootful, out of scope. Both package names are Procursus's (`unzip`, `ldid`) from memory, not
  checked against a live repo index.
