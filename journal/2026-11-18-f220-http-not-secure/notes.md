# F220 http sources: a warning and a 'Not Secure' mark

## What changed

- `web/app/core/sources.js` (added at the end): `isInsecureSource`, `insecureNote` / `INSECURE_NOTE`, and
  `httpsInput(input)`, which gives the same Add input over https (a URL string, or a dist repo
  `{ uri, dist, components }` with only its uri changed).
- `web/app/screens/manage.js`: `addSecure(input, { backend, showHUD, alert })` and `INSECURE_ALERT`. Add Source
  (`addSource`) now calls it after Cydia's Source Warning (F19). An http input first tries
  `backend.addSource(https twin)` under the Verifying URL HUD; that check *is* the "fetch its Release / source JSON"
  (verifySource / detectSource), and when it works the https source is saved with no alert. When it fails, the HUD
  goes away and the alert asks: "This Source Is Not Secure" / "Its files are sent without encryption, and someone on
  the same network could change them. Add it anyway?" with Cancel / Add. Cancel is `cancel: 0`, so it gets the
  darker iOS 6 "Button (Cancel)" look and Escape. In this kit every UIAlertView title is bold, so the darker button
  is how the safe choice stands out. Add puts the HUD back and adds the http one; a failure there shows the usual
  Verification Error.
  Every path that ends in `manage.addSource` gets this: the Add button, the /add?url= link (app.js `addFrom`),
  incoming.js, queue.js, browse.js "add-source" rows and sources.js `addFromClipboard`.
- `web/app/screens/browse.js` (the source page lives there, not in sources.js, so it is outside the task's file
  list): one import line of its own and one line after the F19 health footer, which adds a second group footer with
  `insecureNote(source)` on http sources. Built-in BigBoss (`http://apt.thebigboss.org/...`) gets it. I kept it to
  added lines so the merge stays clean.
- Not changed, on purpose: the Sources list row. Its subtitle is already the full URL with `http://` in front
  (sourceSubtitle), so a second mark there would only repeat it and crowd an iOS 6 subtitle row. Recommended's
  Add / Add All, Import, Home's Recommended and Extras call `backend.addSource` directly with our own known URLs and
  stay silent, as the brief asks for refresh and install (they aren't URLs the user typed).

## Tests

`web/app/screens/manage-insecure.test.js`: http with working https (https added, http never fetched, no alert);
http only + Cancel (nothing added, no HUD left up); http only + Add (http added); http only where both fail (the
error comes through); https (no alert); a dist repo's suite and components kept on the https try; the alert's
words and buttons; the mark only on http sources, BigBoss included.

## Shots (3x, headless Chromium at 320 pt wide, `capture.mjs` from F174 with `SHOT_SCALE`)

- `f220-alert.png`: Manage > Sources > Add, `http://repo.example.invalid/` (no https twin, since the host doesn't
  resolve).
- `f220-source-page.png`: BigBoss's source page, scrolled to the end: "Not loaded yet", then the Not Secure note.
- `f220-https-source-page.png`: Chariz (https), the same spot, with no note.

Scripts: `shots.json`, `shots-page.json`, run against `PORT=8931 node worker/node.mjs`.

## Tried and dropped

- My first shot of the source page left the footer below the fold. The second script scrolls the page body to the
  end first.

## Not verified

- On a phone: I didn't run the alert or the footer in the jailbreak app on the iPhone 7. The task doesn't ask for
  the phone, and the code is the shared `web/app/`, so the app runs the same path.
- An http source whose https twin *answers but is a different or broken repo*. The https try would add the https
  one if it passes verification. That's the brief's rule ("if that works, add the https one"), but a host that
  serves different content on https isn't covered by a test.
- How long the alert waits on a host whose port 443 hangs (BigBoss, per B58): the https try runs until the
  backend's fetch time limit before the alert shows. I didn't time it.
