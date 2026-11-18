# Cydian's install server (Cloudflare Worker)

The sideload app signs every app **on the iPhone**; your certificate and key never leave it. iOS still needs a
server for two things, and this Worker is that server:

- **The install manifest.** iOS installs only from an `itms-services` link whose manifest comes over real HTTPS.
  Cydian serves the signed app itself at `127.0.0.1`; the Worker hands iOS a manifest pointing there.
- **Cydian's own updates.** iOS closes Cydian while it installs the new one, and Cydian's local server closes with
  it, so the signed update waits here for 10 minutes (Cloudflare KV) and installs from here.

It stores nothing else and logs nothing. Cydian uses `https://sign.cydian.dev` unless you set your own.

## Host your own (free, about a minute)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/RyanAHayden/Cydian/tree/main/worker)

Or by hand, with Node installed:

```sh
git clone https://github.com/RyanAHayden/Cydian && cd Cydian/worker
npx wrangler login
npx wrangler deploy        # makes the KV storage on the first deploy and prints your https://….workers.dev address
```

Then in Cydian: **Settings > Signing > Signing Server**, paste that address, and **Check Server**.

### Settings (`wrangler.toml`)

- `HOST_IDS`: the bundle IDs it holds updates for. `*.cydian` (any ID ending in `.cydian`) covers Cydian signed
  with any team's profile. Use `*` to hold any app.
- `TTL`: seconds a held update stays (600).

## Routes

| | |
|---|---|
| `GET /sign/status` | `{ok, ttl, worker: true}` |
| `GET /sign/manifest?bundleid=&version=&title=&port=&path=` | the manifest for `http://127.0.0.1:<port>/<path>` |
| `POST /sign/host?bundleid=&version=&title=` (body: the IPA) | `{itms, manifest, expiresIn}` |
| `GET /sign/host/<token>/manifest.plist`, `/app.ipa` | what that link fetches |

`node test.mjs` checks them against an in-memory KV. cydian.dev's own deploy: `npx wrangler deploy -c wrangler.cydian.toml`.

The website's **Install** (no app to sign on) still signs on a server with zsign: `web/signer/`, run on cydian.dev.
