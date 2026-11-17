# Signing with your own certificate (I5)

Cydian's site can sign an AltStore app with **your** certificate and install it over the air. You keep a `.p12`
(certificate and private key), its password and a `.mobileprovision` in Settings > Signing; Install on an app's
page then signs that app on a signing server and opens the `itms-services://` link it answers with. The server is
cydian.dev by default, or any server you run yourself (below). Signing on the phone with no server at all is I6.

This is Cydian's own signer: `web/signer/` (Flask blueprint, Python) driving
[zsign](https://github.com/zhlynn/zsign) (MIT License, which GPL-3.0-or-later can include; built into the Docker
image from a pinned commit of tag v1.1.3, its tarball checked by SHA-256; licence text at
`/usr/local/share/licenses/zsign/LICENSE` in the image).

## How it works

1. **Settings > Signing** (the site only; `web/app/screens/settings.js`, parsing in `web/app/core/signing.js`).
   Pick the `.p12`, type its password, pick the `.mobileprovision`. The page reads them on the phone:
   - the profile's plist (it sits in plain bytes inside the CMS signature): name, team, app ID, expiry, how many
     devices it lists (or All, for enterprise), and the certificates it names (`DeveloperCertificates`, whose
     subject gives the certificate's name, team and expiry);
   - the password against the `.p12`'s MAC (RFC 7292's own key derivation plus HMAC, in WebCrypto), so a wrong
     password shows at once, whatever the file encrypts its contents with.

   The page shows the certificate's name, team, its expiry, the profile's expiry, the device count and the app ID,
   and says what's wrong (expired, wrong password). The `.p12` can't be opened in the browser (its certificate bag
   is usually encrypted with RC2 or 3DES, which WebCrypto lacks), so the certificate shown is the one in the profile
   of the profile's own team; the server checks that the `.p12`'s certificate is in the profile.
2. **Install** (the nav bar button on an AltStore app's page, as Cydia's package page; `browse.js packageActions`).
   With a certificate saved and a version that has an `http(s)` IPA, the button signs and installs: a HUD
   "Signing" while the server works, "Installing" as the link opens and iOS asks to install. Without a certificate
   it does what F29 does (the source's own signed link, a sideloader, the IPA), plus "Sign with My Certificate",
   which opens Settings > Signing. Version History's rows sign the same way.
3. **POST `<server>/sign`** (`web/signer/__init__.py`), JSON `{url, p12, profile, password}` (the files base64).
   The server, in order:
   - rate-limits the address (10 per 10 minutes);
   - opens the `.p12` with the password, reads the profile, and refuses with a clear error: a wrong password,
     a file that isn't a `.p12` or a profile, an expired (or not yet valid) certificate, an expired profile, a
     certificate the profile doesn't list. None of this needs the IPA, so nothing is downloaded for a bad pair;
   - downloads the IPA through the fetch proxy's SSRF guard (http and https only; no private, loopback,
     link-local, CGNAT or other non-public address, the checked IP pinned for the connection, each redirect
     re-checked; `web/fetch.py`), streaming to a job folder with a size cap and a time limit;
   - looks inside: `Payload/<App>.app/Info.plist` must be there; no entry may leave the folder; the unpacked size
     is capped (zip bombs);
   - fits the bundle ID to the profile's app ID: a wildcard `TEAM.*` keeps the app's own; `TEAM.com.example.*`
     keeps it if it starts with `com.example.`, else **refuses** ("the profile is for com.example.*, which doesn't
     fit this app"); an explicit app ID signs the app as that ID (`zsign -b`);
   - runs zsign with the profile's entitlements (zsign takes them from the profile);
   - keeps the signed IPA under a random 256-bit token and answers
     `{itms, manifest, expiresIn, bundleId, name, version}`.
4. The phone opens `itms-services://?action=download-manifest&url=<server>/sign/<token>/manifest.plist`; iOS reads
   the manifest and downloads `<server>/sign/<token>/app.ipa`. That first download deletes the file and the token.

`GET <server>/sign/status` answers `{ok, zsign, maxBytes, ttl}`; Settings > Signing's Check Server row asks it.

## What is stored where

| What | Where | For how long |
| --- | --- | --- |
| `.p12`, its password, `.mobileprovision`, their file names | The phone: IndexedDB `cydian-signing` of the site's origin, in that browser | Until Remove Certificate (or the browser's site data is cleared) |
| Signing server address | The phone: `localStorage["cydian.signingServer"]` (absent = cydian.dev) | Until changed |
| Certificate, key, password, profile on the server | That request's memory only. zsign gets an unencrypted copy of the key and the profile through anonymous in-memory files (`memfd_create`, opened as `/dev/fd/N`): no file on disk, no password on a command line | The request |
| The downloaded IPA and zsign's unpacked copy | The server's job folder in `CYDIAN_SIGN_DIR` | Deleted when the job ends, signed or not |
| The signed IPA | `CYDIAN_SIGN_DIR`, named by the token's SHA-256 (a directory listing gives no token away) | 10 minutes or its first download, whichever is first; after a restart none can be fetched, and the first signing request deletes them |

Nothing about a signing request is logged by Cydian: no URL parameters carry secrets (it's a JSON body), errors
never repeat the password, and gunicorn's access log is off in the image. The page states this under Signing
Server. A reverse proxy in front of the server (Nginx, Caddy, Cloudflare) logs request lines as it is set up to;
the body, where the secrets are, isn't in a request line.

The signed IPA embeds your profile (`embedded.mobileprovision`, as every signed app does) and is signed with your
certificate: anyone who gets the install link within its 10 minutes, before you use it, could install the app
signed by you, on a device your profile lists. Treat the link like a password; it is never shown, only opened.

## Limits

| Variable | Default | What it limits |
| --- | --- | --- |
| `CYDIAN_SIGN_RATE` | `10` | Signing requests per address per 10 minutes |
| `CYDIAN_SIGN_MAX_BYTES` | `1073741824` (1 GiB) | IPA download size |
| `CYDIAN_SIGN_MAX_UNZIPPED` | 4 x the above | The IPA's unpacked size |
| `CYDIAN_SIGN_TTL` | `600` | Seconds a signed IPA waits for its download |
| `CYDIAN_SIGN_STORE_BYTES` | `8589934592` (8 GiB) | All signed IPAs waiting at once; past it, new requests get "busy" |
| `CYDIAN_SIGN_JOBS` | `2` | Signing jobs at once; more get "busy, try again in a minute" |
| `CYDIAN_SIGN_DOWNLOAD_TIMEOUT` | `300` | Seconds for the IPA download |
| `CYDIAN_SIGN_TIMEOUT` | `300` | Seconds for zsign |
| `CYDIAN_SIGN_DIR` | `<tmp>/cydian-sign` | Where IPAs are while a job runs and while they wait |
| `CYDIAN_PUBLIC_URL` | the request's host, over https | The base of the manifest and IPA links (set it when the server's own host name isn't the one the phone uses) |
| `CYDIAN_ZSIGN` | `zsign` on `PATH` | The zsign binary |

- **One worker.** Tokens live in the server process's memory; run one gunicorn worker (threads are fine), as the
  image does.
- **HTTPS.** iOS only installs `itms-services` links whose manifest and IPA are on https with a certificate it
  trusts. The links are built https unless the request's host is localhost.
- **Proxy timeouts.** The POST answers when signing is done: download plus zsign, seconds for most apps, longer for
  a big game. Cloudflare's proxy gives up after 100 seconds and Nginx after 60 by default (`proxy_read_timeout`);
  raise Nginx's to 300 for big IPAs. A response past Cloudflare's limit can't be raised on its free plan.
- **What iOS still checks.** zsign signs whatever you give it; the phone decides whether it runs. The device must
  be in the profile (Development and Ad Hoc), the certificate not revoked, and the profile's entitlements must
  cover what the app needs (an app with extensions needs a wildcard profile or one per extension; Cydian signs
  them all with the one profile).
- **The site only.** The jailbreak app installs through its helper, and the sideload build signs on the phone (F14).

## Run your own signing server

One command, from a clone of this repo:

```sh
docker compose up -d --build cydian
```

That builds the image (zsign included) and serves Cydian, signer and all, on port **8080** (`CYDIAN_PORT` in `.env`
changes it). The phone needs it over **HTTPS** with a trusted certificate, so put something in front:

- **Tailscale** (no domain, no open ports): `tailscale serve --bg 8080`, then use
  `https://<machine>.<tailnet>.ts.net` as the server in Settings > Signing, from a phone on the same tailnet.
- **Caddy** with a domain pointing at the machine: a `Caddyfile` of
  ```
  sign.example.org {
      reverse_proxy 127.0.0.1:8080
  }
  ```
  and `caddy run`; Caddy gets the certificate itself.

Then Settings > Signing > Signing Server: type the address (`sign.example.org` is enough), and Check Server should
say it signs apps. The page can stay on cydian.dev: `/sign` answers any origin (CORS `*`, no cookies), so nothing is
tied to cydian.dev. Or open your own server's address in Safari and use Cydian from there; its Settings have their
own, separate storage.

Running the signer outside Docker: `zsign` on `PATH` (build it from
[its repo](https://github.com/zhlynn/zsign): `cd build/linux && make`, needs `g++` and `libssl-dev`), then
`.venv/bin/python web/app.py` serves on 127.0.0.1:8080. It needs Linux (`memfd_create`).

## Tests

- `web/test_signer.py`: a throwaway CA, certificate, `.p12` and profile and a tiny hand-built IPA
  (`web/signer/testkit.py`). The checks (wrong password, expired certificate and profile, a certificate the profile
  doesn't list, app ID fit), the token store (expiry, first download only, a restart's cleanup), POST /sign's guards
  (SSRF: loopback, private, IPv6 loopback, `file:`, `ftp:`, credentials, a redirect to loopback; the size cap with
  and without Content-Length; not an IPA; a path that leaves the folder; the rate limit; CORS) and, where zsign is
  installed (`CYDIAN_ZSIGN` or `PATH`), real signing: the manifest, one download, the CodeDirectory's identifier and
  team (the profile's), every code page's hash, and the CMS signature over the CodeDirectory checked with
  `openssl cms -verify`. Without zsign those tests skip and say so.
- `web/app/core/signing.test.js`: the profile's fields, its certificates, the plist parser, the `.p12` password
  (SHA-256 and SHA-1 MACs), the summary rows. Fixtures in `web/app/core/fixtures/signing/` come from
  `web/signer/make_fixtures.py` (throwaway keys, fixed dates).
