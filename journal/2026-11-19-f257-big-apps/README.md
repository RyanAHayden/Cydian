# F257: Website Install of big apps

## What changed

- **Size check before downloading** (signing-client.js `signInBrowser`): an app whose listed size (AltStore
  `versions[].size`, passed down by altstore.js `installRows` as `size`, with `iconUrl`) is over `IPA_MAX` opens the
  Too Big alert first, before the early install link, the progress page or any download (nothing can leave a blank
  icon). No listed size: checked on the download's first answer as before, now worded "This app is 700 MB. The
  website signs apps up to 512 MB." Website only (`signAndInstall` passes size to the browser signer alone).
- **One cap, one sentence**: core/websign.js `SITE_LIMIT_TEXT`, `siteMB`, `overSiteLimit`. core/myipas.js
  `SITE_FILE_MAX = IPA_MAX` (was 400 MB) and its Choose File refusal uses the same words. The Worker's 413 text says
  the same ("The website signs apps up to N MB.").
- **App page** (altstore.js `siteTooBigApp`): the Information group's Size and the Size tile in the sideways tile row
  (user, mid-task) in red (altstore.css `.size-over`), and the footer under Details (`TOO_BIG_FOOTER`). A source's own
  signed link (itms-services) is never marked.
- **Too Big alert** (`tooBigAlert`): "Too Big for the Website", the brief's message, Download IPA (first, blue:
  altstore.css `.alert-button.blue`, the kit's Gloss Blue), Get iFizBox Lite (Home's `installApp`), Other Sideloader,
  Cancel (dark). Download IPA, inside the tap: `addSiteUrl` with name, version, size and icon URL, `markFresh` with
  the note, `window.open(downloadURL)`, and `whenBack` (visibilitychange hidden, then visible) opens Install IPAs.
- **Install IPAs** (screens/myipas.js): on the website the list page takes `freshNote()` once: the row in its own
  "New" group at the top (`freshFirst`) and the note under the bar (myipas.css `.myipa-fresh-note`), for that visit.
  A link entry's icon URL is drawn (`putIconUrl`, through `mediaUrl`). A link over the cap (`siteTooBig`) hands off on
  Install (`siteInstallSheet` → `handOffIpa`), never the website signer.
- **Other Sideloader / the hand-off** (`handOffIpa`, `sideloaderLinks`): an action sheet of install links:
  `ifizbox://install?url=&name=` (Lite, incoming.js F89), `altstore://install?url=`, `sidestore://install?url=`,
  `feather://install/<https url>` (shapes from core/otherlinks.js). Decision: the brief's "existing hand-off" for an
  app page is the source share sheet (adds the *source* to that app); the alert and an Install IPAs row only have the
  IPA's URL, so one sheet of per-app install links serves both.
- **Resume** (`downloadIpa`): `CUT_TRIES` 3 (was 5), and every try is made (B95's "a try that brings nothing new
  ends it" is gone, so it is always "try k of 3"). `onCut({ attempt, of, at })` → the log's grey "The connection
  dropped at X MB." then the step "Reconnecting (try k of 3)". After the last: the red error, then the yellow "If a
  gray <App> icon was left on your Home Screen, delete it." when iOS was sent to the early link (no icon can be left
  otherwise; decision, the brief shows it unconditionally). The Worker's Range pass-through was already B95's.
- **worker/node.mjs**: a body that broke off after its headers went made it call `writeHead` again, which threw and
  killed the server (found running this task's cut test). Now the answer is destroyed (cut short) instead.

## Checked on the iPhone 7 (Safari, a local rig)

Production deploys from main, so this branch ran on the 7 through `worker/node.mjs` (this worktree's Worker) serving a
copy of `web/app` plus a seed page (the fixtures' throwaway test certificate into this origin's Settings > Signing,
website installs accepted), and a scratch file server (Range, a `/cut/` mode that breaks the first GET at 15 MB, an
AltStore source made of the files there), both reached over `ssh -R` at 127.0.0.1. Nothing of the rig is committed.

- Test source lists "F257 Too Big Test" (700 MB listed): Size red in Information and in the tile, footer under it
  (phone-bigpage.png, phone-tile2.png).
- Install on the Website → the Too Big alert, blue Download IPA first (phone-alert.png). Download IPA → Safari's
  "Do you want to download tiny.ipa?" in a new tab → Download → Safari came back to the site's tab and Install IPAs
  opened with the row under "New" and the note (phone-dl2.png). The file (1134 bytes, whole) was in Files >
  Downloads (deleted afterwards). Its INSTALL → "Install F257 Too Big Test With" iFizBox Lite / AltStore / SideStore
  (no Feather: the test link is http) (phone-handoff.png).
- Cut test, 40 MB IPA: "Downloading", grey "The connection dropped at 9.4 MB.", "Reconnecting (try 1 of 3)", the Worker
  asked upstream `Range: bytes=9884619-`, then Downloading, Signing (real zsign), Uploading, Ready to Install
  (phone-cutlog.png).
- 3x renders (headless Chromium, capture.mjs + shots.json here): alert-3x.png, log-3x.png (three breaks, the red error
  and the yellow warning). Zoomed: the blue button has no light line at its edges.

## The ceiling (part 4): measured, IPA_MAX not changed

Stored (incompressible) test IPAs (tiny-ifizbox's executable under `com.ryha.f257test.*`, padded), fresh tab each:

| IPA | result |
|---|---|
| 42 MB | signed and uploaded |
| 70 MB | signed and uploaded |
| 100 MB | signed once; then twice "zsign stopped: Out of memory" (once as "[object Object]": B97) |

The tab never reloaded; zsign's memory ran out. The phone had ~17 MB of free pages before the runs, and the ssh tunnel
was dropped by the phone at each out-of-memory (memory pressure). So the 7's ceiling is 70-100 MB of unpacked app.
**Decision: IPA_MAX stays 512 MB** (and SITE_FILE_MAX now equals it, as the brief asks). Setting it to ~70 MB would
make Unbound (104 MB, the brief's must-install app) and most real apps "too big" on every phone, newer ones with 4-8x
the memory included, and a 1-in-3 result isn't a ceiling to ship. Filed F261 for a person to choose (per-device cap,
learn from an Out of memory, or a streaming signer).

## Follow-ups filed

- F260: Install should go to iOS's prompt by itself (user, mid-task: "i dont like that it has a ready to install popup").
  The popup in these tests came from the seeded identity having no `passwordOk`, which skips the early link.
- F261: the cap from the measured ceiling (above).
- B97: "zsign stopped: [object Object]".

## Tried and dropped

- Restarting the file server with `kill` on the `timeout` pid left the node child bound to the port; the restart then
  failed with EADDRINUSE and the old server (cut already spent) kept answering. Killed the child by its own pid.

## Not verified

- **Unbound (104 MB) installs from ifizbox.com**: iOS takes the install manifest only over https with a trusted
  certificate, and this branch isn't on ifizbox.com until it merges; the local rig is http, and the test certificate
  isn't Apple's. Given the 100 MB results above, Unbound will likely run out of memory on the 7 (F261).
- **The home-screen web app**: the phone checks ran in a Safari tab on 127.0.0.1, not a web clip of ifizbox.com. The
  visibilitychange return worked in Safari; a web clip opening Safari for the download wasn't tried.
- **Get iFizBox Lite and the sideloader links opening their apps**: unit-tested (the call, the link shapes); not
  tapped on the phone (Lite's install needs https; AltStore/SideStore aren't on the 7).
- **The yellow gray-icon warning on the phone**: needs the early link (a checked password), which the seeded identity
  didn't have; unit-tested and in log-3x.png.
