# C36: break the core/catalog.js <-> core/installed.js import cycle

installed.js imported `sectionName`, `parseAuthor`, `compareNames` and `sectionGroup` from catalog.js, which imports
installed.js. Those helpers (with what they need: `NO_SECTION`, `SECTION_FIXES`, `simpleSection`, `SECTION_GROUPS`,
`GROUP_NAMES` and a collator) moved unchanged to a new import-free module, `web/app/core/sections.js`. installed.js
imports them from there; catalog.js imports them for its own use and re-exports them, so every other caller
(screens, sourcelist.js, sectionicons.js, tests) is untouched. catalog.js keeps its own `collator` for its other sort.

The cycle's line is gone from KNOWN in `web/app/import-cycles.test.js`.

No new file needed registering anywhere: core modules are loaded by import only (C32's tweakfields.js has no list
entry either).

Checks: `node --test web/app/import-cycles.test.js web/app/core/` (927 pass); the full gate via `run done`.

**Not verified**: none.
