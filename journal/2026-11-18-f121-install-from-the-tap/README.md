# F121: website install without the Ready to Install tap

## What I did

- The worktree was behind origin/main: the plan clone didn't have F121 yet. I fast-forwarded task/F121 to
  origin/main (95f6f47) and then started.
- **Worker** (`worker/src/index.js`):
  - `POST /sign/upload?…&token=<48 hex>` without `size` reserves a token the website made itself (metadata
    `reserved: true`). The same POST with `token` and `size` starts the upload into it. A token that's taken, already
    started, or reserved for another bundle ID gets 409. Parts sent before the size get 409.
  - `GET /sign/up/<t>/manifest.plist` answers **at once from its own query** (`bundleid`, `version`, `title`) when
    nothing is stored yet. Without a query it waits for the reservation (up to 15 s), then 404.
  - `GET /sign/up/<t>/app.ipa` for a reserved upload waits (polling KV every 1.5 s, up to 2 min). It sends the
    **headers once the upload has started** (size known), and the **body once it's done**. A Range request waits
    for done. Plain uploads (no token) behave as before: 404 at once until done.
  - `waitFor()` is exported; `env.WAIT_SCALE` shrinks the waits for tests.
- **Client** (`web/app/signing-client.js`):
  - `identityNow()`: the website's identity kept in memory. `loadIdentity` and `saveIdentity` fill it,
    `clearIdentity` empties it, and the module warms it on load on the site. `signingReady` uses it when it's there,
    so Home's Install Cydian App gets from tap to `open()` without an IndexedDB wait in between.
  - `expectedBundleId(id, { url, bundleId })`: the ID the profile will sign as, when it's known before the download.
    An explicit profile gives its ID; a wildcard gives Cydian's own IPA (`com.ryha.cydian`) or the caller's
    `bundleId`. Otherwise null.
  - `signInBrowser`: when that's known, the very first thing it does (no await before it) is make a token and open
    `itms-services://…/sign/up/<t>/manifest.plist?bundleid=…`. Then it reserves the token, downloads, signs, and
    uploads with `token`. When zsign's bundle ID matches the reservation, the reservation succeeded and it took under
    110 s (`EARLY_WINDOW`), the HUD ends on "Installing" and no alert shows. Otherwise it falls back to the Ready to
    Install alert (a fresh upload when the ID differs; the same, now finished, link when it was too slow).
  - `signAndInstall` and `signInBrowser` take an optional `bundleId` and `version` (filed F122 to pass them from
    the app pages).
- Tests: `worker/test.mjs` has a "reserved link" block (manifest from the query, wait for the reservation, 409s,
  headers on start and body on done, Range waits, give-up 404s, plain uploads don't wait).
  `web/app/signing-client-early.test.js` is new: open-before-await order, the fallbacks, and an error after the early
  open still shows an alert.
- `docs/signing.md` describes the new step.

## Decisions (unattended, so written down)

- **The client picks the token, instead of a round trip to reserve one.** The brief suggested reserving first. But
  any network wait before `open()` risks losing Safari's user activation, which is the problem this task is about.
  A 192-bit random token is as unguessable as the Worker's.
- **The manifest's metadata is in its URL.** If the manifest read KV before the reservation landed, it could cache a
  "not found" for up to 60 s, and the reservation would race the link. With the metadata in the URL nothing races.
  The reservation still binds the token to the bundle ID, so nobody else can upload into it.
- **The early path only runs when the bundle ID is known at the tap.** A wrong bundle-identifier in the manifest
  would make the install fail after iOS has already taken it. In practice that means Cydian's own IPA (the
  website's main install) and explicit profiles. Other apps still get the alert until F122.
- **App.ipa sends its headers early** (at upload start, not at done), to shorten the silence that iOS's download
  might time out on.

## Tried and dropped

- My first version of the manifest waited for the reservation in KV. I replaced it with the query version after
  thinking through KV caching "not found" results (above). The no-query wait is still there as a fallback.
- My first version of app.ipa held everything until done. I changed it to headers on start, for the timeout reason
  above.

## Not verified

- **Nothing was tried on a phone.** The brief asked for an iPhone 7 test (tools/ui-7.sh, wrangler tail). That needs
  this branch's Worker live on an HTTPS host the phone can reach, with a certificate saved in that origin's Safari
  storage. There is no wrangler in this worktree. Deploying cydian.dev from a task branch is publishing beyond git,
  which the run's rules forbid; the runner publishes after merge. So it's filed as **R13** (`--after F121`). Unknown
  until then:
  - whether Safari keeps running the signer and upload while iOS's install prompt is up, and after Install is tapped;
  - whether iOS's installer waits up to 2 minutes for app.ipa (its request timeout may be ~60 s of silence: download
    plus signing time before the headers);
  - whether opening the link at the very start of the tap avoids "Open this page in iTunes?" on the old iOS 15
    WebKit. Home's path still has `await ready()` before `install`, now a resolved promise when the identity is in
    memory, not an IndexedDB read.
- How fast KV shows the `done` flag in the same location, in production. The in-memory test KV is instant;
  Cloudflare says writes are usually visible at once where they were made.
- If signing fails after the early open, iOS's prompt waits out the 2 minutes and then fails on its own; the website
  shows its error alert right away. There is no cancel call to make it fail sooner.
