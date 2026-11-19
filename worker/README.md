# iFizBox's install server (Cloudflare Worker)

The sideload app signs every app **on the iPhone**; your certificate and key never leave it. iOS still needs a
server for two things, and this Worker is that server:

- **The install manifest.** iOS installs only from an `itms-services` link whose manifest comes over real HTTPS.
  iFizBox serves the signed app itself at `127.0.0.1`; the Worker hands iOS a manifest pointing there.
- **iFizBox's own updates.** iOS closes iFizBox while it installs the new one, and iFizBox's local server closes with
  it, so the signed update waits here for 10 minutes (Cloudflare KV) and installs from here.
- **Apps the website signed in the browser** (F93): the website signs with zsign as WebAssembly in your browser and
  leaves the signed app here for the same 10 minutes, for iOS's install prompt.

It stores nothing else and logs nothing. iFizBox uses `https://sign.ifizbox.com` unless you set your own.

## Host your own (free, about a minute)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/RyanAHayden/iFizBox/tree/main/worker)

Or by hand, with Node installed:

```sh
git clone https://github.com/RyanAHayden/iFizBox && cd iFizBox/worker
npx wrangler login
npx wrangler deploy        # makes the KV storage on the first deploy and prints your https://….workers.dev address
```

Then in iFizBox: **Settings > Signing > Signing Server**, paste that address, and **Check Server**.

### On your own PC or in Docker

The same code runs on Node 22 (`worker/node.mjs`): the website, `/api/fetch` and `/sign/*`, with held updates in
memory.

```sh
git clone https://github.com/RyanAHayden/iFizBox && cd iFizBox
node worker/node.mjs                       # http://0.0.0.0:8787 (PORT, HOST, HOST_IDS, TTL as below)
# or Docker:
docker build -f worker/Dockerfile -t ifizbox . && docker run -d --restart unless-stopped -p 8787:8787 -v ifizbox-data:/data ifizbox
```

**Reviews** (`/reviews/*`) are kept in a SQLite file through Node's built-in `node:sqlite` (Node 22.5+, nothing to
install): `reviews.db` in the folder you start it from, or `REVIEWS_DB=/path/to/reviews.db` (`REVIEWS_DB=off` keeps
none). The Docker image keeps it at `/data/reviews.db`: the `-v ifizbox-data:/data` volume above keeps it across
updates. `REVIEWS_ADMIN=<a long secret>` lets you delete a review (`DELETE /reviews/<package>/<id>` with
`Authorization: Bearer <secret>`); `REVIEWS_SALT` salts the stored token and address hashes, `REVIEW_DAILY` caps
writes per address a day (40) and `REPORT_HIDE` is the reports that hide a review (3), as on the Worker.

iOS takes the install manifest **only over HTTPS with a trusted certificate**, so put it behind one of:

- **Tailscale** (phone on your tailnet): `tailscale serve --bg 8787` gives `https://<machine>.<tailnet>.ts.net`;
- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8787`) or **Caddy** with your own domain.

Then put that `https://` address in **Settings > Signing > Signing Server**.

### Settings (`wrangler.toml`)

- `HOST_IDS`: the bundle IDs it holds signed apps for. `*` (the default) holds any app. `*.ifizbox` limits it to IDs
  ending in `.ifizbox`.
- `TTL`: seconds a held update stays (600), and an app the website signed in the browser.
- `MAX_UPLOAD_MB`: the largest IPA the website signs in the browser (512): it downloads through `/api/fetch?kind=ipa`
  and comes back signed to `/sign/upload`, in 20 MB parts, for `TTL` seconds. `0` turns website signing off here.
- `GITHUB_TOKEN` (optional, a secret: `npx wrangler secret put GITHUB_TOKEN`): a GitHub token with **no permissions**
  (public repositories only). GitHub limits anonymous downloads per address, and a Worker's address is shared with
  other sites, so the website's downloads of IPAs on GitHub releases can get "429". With the token, those retry
  through GitHub's API, limited per token instead. A copy on your own PC doesn't need it (your address is yours).
- `APPLE_RELAY` (off unless `"1"`): the `/apple/<host>/<path>` relay for a free Apple ID sign-in in the browser
  (`src/apple-relay.js`, used by `web/app/core/gsa.js`). It forwards only to gsa.apple.com's sign-in paths,
  developerservices2.apple.com's Xcode API and a few public anisette servers, from this site's own pages, with size
  and time caps, and it never logs or keeps what passes through. No product page uses it yet, so ifizbox.com leaves
  it off. Self-hosted with `node.mjs`, gsa.apple.com needs Apple Root CA (`NODE_EXTRA_CA_CERTS`).

## Routes

| | |
|---|---|
| `GET /sign/status` | `{ok, ttl, worker: true}` |
| `GET /sign/manifest?bundleid=&version=&title=&port=&path=` | the manifest for `http://127.0.0.1:<port>/<path>` |
| `POST /sign/host?bundleid=&version=&title=` (body: the IPA) | `{itms, manifest, expiresIn}` |
| `GET /sign/host/<token>/manifest.plist`, `/app.ipa` | what that link fetches (each looks again for a few seconds before a 404, as KV is eventually consistent) |
| `GET /sign/host/<token>/status` | `{manifest, started, finished}`: what iOS has fetched; the app closes for iOS to install over it only once `finished` |
| `GET /repo/<file>` | iFizBox's own APT repo (`Release`, `Packages`, `Packages.gz`, `*.deb`): the latest GitHub release's asset, fetched here so clients get no redirect (Zebra can't take GitHub's). `IFIZBOX_REPO` (owner/name) for another repo's releases |

`node test.mjs` checks them against an in-memory KV. ifizbox.com's own deploy: `npx wrangler deploy -c wrangler.ifizbox.toml` (Workers Builds runs it on every push to main).

The website's **Install** (no app to sign on) signs in the browser (F93: zsign as WebAssembly, `web/app/vendor/zsign`)
and uploads the signed IPA to `/sign/upload` (in parts, kept 10 minutes) for iOS's install prompt.
