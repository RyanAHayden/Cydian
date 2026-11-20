# C28: split signing-client.js into web/app/signing/

## What was done

`web/app/signing-client.js` (1,643 lines) is now 14 modules under `web/app/signing/`, one per commented section:

| module | section |
| --- | --- |
| `common.js` | shared helpers: `bridge`, `sleep`, `storageOf`, `localSigning`, `browserSigning`, the B104 insecure-download alert, the F292 hash, F151/F188 helpers |
| `identity.js` | identity storage (memory / IndexedDB), Bring My Certificate, the Signing Server |
| `install.js` | `isSelfIpa`, `signAndInstall`, and F243's original-app warning |
| `device.js` | on the phone: signing.status/import/remove, `firstInstallCheck`, `openSigning` |
| `route.js` | Settings > Installation's route, `waitForVPN`, `installOnDevice` |
| `selfupdate.js` | B83/B123/B159: iFizBox's own update |
| `queue.js` | F235: the IPA queue's prepare/open |
| `library.js` | My IPAs (`libraryCall`, `installFromLibrary`, `serverReachable`) |
| `browser.js` | the website: worker, download, upload, and `signInBrowser` (which its header documents) |
| `early.js` | F121: the early install link |
| `toobig.js` | F257: apps too big for the website |
| `watch.js` | F190: what iOS does after Installing |
| `prompt.js` | B90: iOS's prompt cancelled while the website signs |
| `password.js` | F260: password check, and B121 `identityCert` |

The code moved byte for byte (checked: every line of the old file is in the new files, apart from `"./` import paths
that became `"../`); new are only each module's import block, three short headers, and `export` on private names
another module now needs (`bridge`, `sleep`, `storageOf`, `openRoute`, `readyStatus`, `lastDevice`, `failed`,
`stopNative`, `identityNow`, `signFail`, `retrying`, `buffer`, `keptBytes`, `tooLargeText`, `promptStop`,
`eitherSignal`, `iosCancelled`, `websiteTransfer`). The split was done by a throwaway acorn script (scratchpad, not
committed) that cut the file at its top-level statements and computed each module's imports.

`signing-client.js` is now a 46-line re-export of exactly the names it exported before (checked: same set). It
stays because screens/queue.js and screens/installed.js take the whole set as one object (`sc`, tests pass fakes),
and the 48 test files import it.

Importers moved to the modules: essential-ui, signing-sheet, incoming, app.js (push), app-updates, and screens
account, altstore, apprun, browse, devaccount, home, importlink, installed, myipas, push-settings, settings,
signed-apps, signing, tweaks.

Load order: the modules import each other in cycles (as the sections called each other). That is safe because no
module uses a sibling's binding while it loads, except password.js's website warm-up (`loadIdentity`, a hoisted
function) and `browserSigning`, which went to `common.js` (no sibling imports) for that reason. Each module was
imported on its own as the first entry point in node: all load.

Tests changed: `nav/banner.test.js` and `screens/installnow.test.js` read the old file's source (the Press banner,
the three `rememberInstall(` calls): they now read `signing/route.js` and all of `signing/`;
`screens/signing.test.js`'s word scan also reads every `signing/` file.

`module-graph.test.js`: the startup closure went from 106 to 119 modules (13 more files for the same code, since
Home and Settings use nearly every part statically). MAX_MODULES raised from 110 to 124, with the reason in the
comment and the commit.

## Checks

- `node --test web/app`: 2490 tests, 2490 pass (the same count as before; before the test edits, the three tests
  above failed as expected).
- `native/test_bridge_contract.py`, `native/test_brand.py`: pass.
- The website in headless Chromium (`python3 -m http.server` on web/app): all 14 modules served 200, no console
  errors, Home's tab bar and tables drew.

## What failed on the way

- The first cut lost the blank line between some statements and put same-line trailing comments on the next
  statement; caught by the line-by-line comparison and fixed in the script before anything was committed.
- The script's import finder counted locally shadowed names (`sleep` parameters in watch.js/prompt.js, a local
  `here` in route.js): those three imports were removed by hand and `here` kept private.

## Not verified

- The sideload and jailbreak apps on a phone: no phone test in this task (the native build copies web/app whole,
  so the new folder goes along; `startup.test.js` passes in node).
- The website's sign-and-install flow in a real Safari: a pure move, covered by the node tests, not run by hand.
- docs/ still name functions as `signing-client.js <name>`; docs/signing.md now says where the modules are and that
  the old file re-exports them, rather than rewriting every mention.
