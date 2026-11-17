# D1: AGENTS.md and README after R4 (no separate IPA)

## Done
- AGENTS.md: "Three front doors" -> two; removed `ipa/` as item 3 and added a note: no separate `ipa/`,
  R4's reasoning is in `docs/ipa.md`, and the sideload build comes from the same `native/` shell (I2-I4).
- AGENTS.md gate line: "Add the native and IPA builds" -> "Add the `native/` builds (jailbreak and sideload)".
- README: one line under the jailbreak app pointing to `docs/ipa.md`.

## Decision
The brief says "R4 decided no IPA", but the plan commits after R4 (2a6bd4e, 6e7eae3, ae42d70) record the user
overruling the drop: I2 builds the N1 shell as a plain IPA too. Writing "no IPA" would be wrong, so the docs say
there is no *separate* `ipa/` front door and the IPA is a second build of `native/`. The gate line keeps the
sideload build in, as a `native/` build, since I2's test is "both artifacts build".

## Not verified
- none (docs only; `tools/check.sh` run by `done`).
