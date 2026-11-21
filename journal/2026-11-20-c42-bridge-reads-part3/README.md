# C42: narrow the bridge surface, part 3

Every direct `globalThis.ifizboxNative` read in the task's files now goes through `web/app/native.js`
(`nativeBridge()`, and `hasNativeCall()` in essential-ui.js's sideload IPA check): app.js, settings.js,
signing-sheet.js, incoming.js, ipa-install.js, nav/alert.js, nav/banner.js, nav/menu.js, signing/common.js,
signing/install.js, signing/device.js (a comment), core/push.js, core/installed.js, core/reviews.js, catalog.js,
essential-ui.js. Default parameters (`native = nativeBridge()`) are still evaluated per call, so tests that set or
clear the global between cases behave as before.

`native-reads.test.js` ALLOWED drops every one of those lines; what is left is outside this task's files:
app-updates.js 1, backend.js 1, device.js 1, settings-store.js 2, share.js 1.

nav/alert.js kept no imports on purpose ("inline so alert.js keeps no imports"); it now imports only native.js,
which has no imports of its own, so nothing else comes along. core/ modules now import `../native.js`; it only reads
a global, works in the module workers (core/worker.js) and needs nothing from the DOM.

Checks: every web/app `*.test.js` under `node --test` (2696 pass); `tools/check.sh` through `run done`.

**Not verified**: the apps on a phone (no device run: the change only swaps where the same global is read; the
gate's native builds and node tests cover it).
