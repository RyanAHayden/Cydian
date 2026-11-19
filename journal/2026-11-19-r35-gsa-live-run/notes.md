# R35 Live run of the free Apple ID spike: prepared, waiting on the owner

The live run needs two things from the owner: their OK to deploy a preview Worker on their Cloudflare account, and a
sign-in with their spare free Apple ID (2FA by device or SMS). This run had nobody at the keyboard, so it built
everything for the run, checked what it could locally without an account, and is closed as **blocked**.

## What was built

- **`worker/wrangler.preview.toml`**: Worker `ifizbox-gsa-preview` on workers.dev (no routes, no custom domain, not
  connected to Workers Builds), `APPLE_RELAY = "1"`, with no KV, D1 or rate limits (only `/apple/*` matters here). A
  `[build]` command puts `web/app/` and the spike page together in `worker/.preview-site/`. That directory writes its own
  `.gitignore` (`*`) and an `.assetsignore`, so the shared `.gitignore` stays untouched. Run wrangler from `worker/`,
  because wrangler runs the build command in the directory it was started in, not the config's (checked in
  wrangler 4.165's source: `build.cwd` isn't resolved against the config path). The commands are in the file's header.
- **`worker/preview-entry.js`**: re-exports only `src/index.js`'s default handler. Local workerd won't start on
  `index.js` itself: "Incorrect type for map entry 'HOST_WAIT': the provided value is not of type 'function or
  ExportedHandler'". Every named export of a Worker's main module has to be a handler, and index.js exports plain
  constants for its tests. This is a new file that wasn't in the brief's list. I added it rather than edit index.js,
  which other tasks own. Filed as a follow-up for the plain `wrangler dev` case.
- **`tools/gsa-spike.html`**: the dev-only page, served only by the preview at `/gsa-spike` (assets redirect
  `/gsa-spike.html` there). It has `noindex` and no-referrer, and the site never links to it. It imports
  `./core/gsa.js` and uses `relayTransport()` with `relayWsUrl` for the anisette socket. The anisette v3 machine is
  kept in IndexedDB (`ifizbox.gsa-spike`). `anisetteV3` reads its storage synchronously, so the page loads it first.
  Buttons: provision/check the machine, a no-account probe (SRP init for `gsa-spike-<time>@example.invalid`, which
  should get `ec -20970`), a new machine, sign-in, a device code (with resend), SMS (phone list, send, verify), the
  xcode.auth app token, listTeams, and forget. Only one action runs at a time, so a double tap can't send two
  sign-ins. The password field is cleared on submit. Tokens and the adsid are logged masked (first and last 4
  characters); errors go through `signInAlert`.

## Checked locally (`wrangler dev -c wrangler.preview.toml`, headless Chromium over CDP, no Apple ID)

- The build step assembled `.preview-site`. `git status` stayed clean of it, and the `.wrangler/` state is ignored
  by worker/.gitignore. Requests: `/core/gsa.js` 200, `/apple/ani.sidestore.io/v3/client_info` 200, and
  `/apple/example.com/` 403 (allow-list).
- The page loaded in Chromium and its module ran (`relayTransport` and IndexedDB in a real browser).
- **The anisette WebSocket through the Worker works in workerd.** For each of the five servers the browser opened
  `ws://localhost:8797/apple/<server>/v3/provisioning_session`, and the relay handed it to the anisette server.
  `GiveIdentifier` and `GiveStartProvisioningData` came back through it.
- **gsa.apple.com from local workerd fails**: `TLS handshake failed: invalid peer certificate: UnknownIssuer`, on the
  url bag (`GsService2/lookup`) and on MidService. workerd uses its own CA list, which doesn't include Apple Root CA, so
  provisioning stopped at startMachineProvisioning. This is the cfssl_trust question the live run answers. Production
  Cloudflare uses a different trust store (cfssl_trust), so this local result doesn't predict it. If the live run
  shows the same error, the relay can't reach gsa.apple.com from Cloudflare, and the route needs another way: the
  phone or the app doing the GSA calls itself, or a non-Cloudflare relay.

## What the owner does for the live run (about 10 minutes)

1. `cd worker && npx wrangler deploy -c wrangler.preview.toml` (needs `wrangler login` to their account).
2. Open `https://ifizbox-gsa-preview.<account>.workers.dev/gsa-spike` in Safari or Chrome.
3. **Provision / check machine**, then **No-account probe**. Expect `ec -20970`. A TLS or 502 error here answers the
   cfssl_trust question with no.
4. Sign in with the spare Apple ID, enter the device or SMS code, then **Get Xcode app token** and **List teams**
   (expect one Personal Team).
5. Copy the log into this journal (it's already masked) and note the outcome.
6. `npx wrangler delete -c wrangler.preview.toml` to tear it down.

## Tried and failed

- The first `wrangler dev` used `main = "src/index.js"`, and workerd refused to start (HOST_WAIT, above). Fixed with
  `preview-entry.js`.
- The first gate run failed: `native/test_brand.py` walks the tree, ignored files included, and found the name
  spelled in wrangler dev's bundle under `worker/.wrangler/tmp/`. I deleted `worker/.wrangler` and
  `worker/.preview-site` (both local leftovers) and the gate passed. After a local `wrangler dev` or a preview
  deploy, delete those two directories before running `tools/check.sh`.

## Not verified

- **Deploying the preview to Cloudflare**, and everything that depends on it: whether a Worker fetch reaches
  gsa.apple.com (the Apple Root CA chain in cfssl_trust), the WebSocket pass-through on Cloudflare's edge (it passed
  in local workerd only), and whether Apple accepts Cloudflare egress. The brief needs the owner's OK to deploy on
  their account, and this run was unattended. Nothing was deployed, so there's nothing to tear down.
- **A real sign-in** (SRP complete, 2FA by device or SMS, the xcode.auth token, listTeams): needs the owner's
  spare Apple ID and their 2FA device or phone.
- **The no-account probe from the page**: it never got past anisette provisioning locally, because of the TLS
  failure above. The same probe passed from node in F251.
- **Safari or the phones**: only headless Chromium on Linux was used.
