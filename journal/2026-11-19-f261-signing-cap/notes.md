# F261: the website's signing cap from the measured ceiling

## Decision (unattended run: decided here, nobody to ask)

Of the brief's options, **a cap learned per browser**, with the global cap left where it is:

- `IPA_MAX` (core/websign.js) = `SITE_FILE_MAX` (core/myipas.js) = the Worker's upload cap stay **512 MB**. The
  wrangler files and myipas.js are unchanged.
- Each browser remembers the smallest IPA that ran zsign out of memory (`localStorage` `ifizbox.signMemory`,
  `{ failed: bytes }`). An app whose listed size is at or past it opens the Too Big alert, retitled **Too Big for This
  iPhone**, before the early link or any download: "Unbound is 104 MB. Signing a 100 MB app ran this browser out of
  memory. Download the IPA and import it into iFizBox Lite or another sideloader, or try anyway." Buttons: Download
  IPA (blue), Get Lite, Other Sideloader, **Try Anyway**, Cancel.
- Try Anyway runs signInBrowser again from inside the alert's tap (`anyway: true`), the same way B90's Try Again
  does, so the early link can still open from a user gesture.
- An IPA at or past the remembered size that then signs **forgets** the limit: the 7 signed 100 MB once in three,
  so a failure is the phone's memory at that moment, not a fixed fact; one success proves it can.
- The Out of memory failure's alert adds: "iFizBox Lite signs big apps on the phone without this limit. From now
  on, apps of N MB or more open Too Big here first."

Why not the others:

- **Guess from the screen/UA**: Safari's UA is frozen ("iPhone", no model), and the same 375×667@2x screen is an
  iPhone 6s/7/8 (2 GB) and an SE 2/3 (3-4 GB); 390×844 covers 4 GB and 6 GB models. A guess would block phones that
  can sign or let ones that can't fail anyway.
- **A lower global cap (~70 MB)**: blocks Unbound (104 MB) and most real apps on every phone, 8 GB ones included.
- **A streaming zsign**: the real fix for old phones, but a rebuild of the WebAssembly signer. Filed as F265
  (`later`).

## What changed

- core/websign.js: `MEMORY_KEY`, `memoryLimit`, `noteOutOfMemory`, `noteSigned`, `overMemoryLimit`, `isOutOfMemory`.
- signing-client.js: `tooBigAlert` takes `limit` (the memory variant) and `anyway` (Try Anyway's run);
  `MEMORY_TITLE`, `MEMORY_BUTTONS`, `memoryText`, `memoryNote`. `signInBrowser` gets the `storage` dep and an
  `anyway` option, checks the learned limit after F257's global one, records the IPA's byte length on success
  (`noteSigned`) and on an "Out of memory" failure (`noteOutOfMemory`).
- web/app/memory-limit.test.js: the store, the alert, a failing run remembering, the pre-download alert, Try Anyway.

The size compared is the IPA's (compressed) byte length against the source's listed size (also the IPA's size), so
they measure the same thing. Kept IPAs (`bytes`) have no pre-check: there's no link to hand to Download IPA, and the
file is already on the phone; they still teach the limit when they fail or succeed.

## Not verified

- **On the iPhone 7**: not run. The task's change is a client-side rule over zsign's existing "Out of memory" error
  (which F257 saw on the 7); exercising it on the phone means filling its memory again with a 100 MB sign, the
  same runs F257 already did. Unit tests drive the whole signInBrowser path with a fake worker throwing that error.
- **Try Anyway opening iOS's early link from the alert's tap in real Safari**: it uses the pattern B90's Try Again
  uses (run from `onTap`); not tapped on a phone here.
- **The app page's red Size** (screens/altstore.js `siteTooBigApp`) still goes by the global cap only, so an app over
  this browser's learned limit isn't drawn red; Install opens the alert. altstore.js wasn't on this task's files.
