# B215: /sign/host takes the signed IPA in parts

Hosted self-update (Upgrade iFizBox in the Lite build) uploads the IPA it signed to the Signing Server's
`POST /sign/host`, which held it as one KV value, so at most 25 MB. The signed 0.17.2 IPA is 29.6 MB: refused with
"Send the signed IPA as the body (up to 25 MB)."

## What changed

- **Worker** (`worker/src/index.js`): the hosted IPA now always lives in 20 MB parts (`PART`, keys `<t>.<i>`); the
  token's own key holds only metadata `{bundleId, version, title, size, parts, partSize, done}`.
  - `POST /sign/host?…&size=` (no body) -> `{token, partSize, parts}`; `PUT /sign/host/<t>/<i>` each part (exact
    length, part 0 must start `PK`); `POST /sign/host/<t>/done` checks every part and answers the same
    `{itms, manifest, …}` as before. Parts outlive the token by 5 minutes, as /sign/upload's do.
  - `POST /sign/host` with one body still works (every Lite build before this one sends it so, and they are the ones
    upgrading): the body is cut into the same parts **as it streams in** (`hostBody`, one part held at a time), up to
    `HOST_BODY_MAX` = 95 MB (a Worker request takes ~100 MB). So **older apps can update to 0.17.2 as soon as this
    Worker is deployed**, without needing a new app first.
  - manifest.plist / app.ipa wait (HOST_WAIT, as before) for metadata with `done`, then app.ipa streams part by
    part, still a MB per pull, so `finished` (kept with `ctx.waitUntil`, B208) is still only written once iOS reads
    the last byte. /status unchanged. The rate limit (F312) still counts only `POST /sign/host`, not parts.
- **Shell** (`native/Sources/Sideload.swift`): new `HostUpload` (end of the file): size POST, a PUT per part (read
  from the file 20 MB at a time), done POST; each step retried twice on a dropped connection or 5xx; a 4xx ends with
  the server's own words. A server from before B215 answers the bodyless POST 413, and then the IPA goes up as one
  body (self-hosted servers not yet updated keep working under 25 MB). Cancel (F196) hands the caller an error at once
  as a cancelled upload task did. `hostAndOpen` (signing.install's host route and SignAhead.open) and `uploadHosted`
  (B89's after-freeze fallback) both use it.
- `SignAhead.swift` needed no change: its host route calls `Sideload.hostAndOpen`, which now sends parts.
- worker/README.md row, limits.js comment.

## Tests

- `worker/test.mjs` "worker host in parts (B215)": a 29.6 MB IPA in parts (missing part, wrong length, not a zip,
  no such part, finished, size over HOST_MAX, bad size) and as one body; no KV value over 25 MB; HEAD, a Range across
  the part edge, the whole body, and status `finished` after the waitUntil. Older host tests (KV lag, B208) pass on
  the new storage unchanged.
- `make -C native package`: both builds compile with the new Swift.

## Why the IPA grew 11 MB in 0.17.2

Compared the zip listings of the v0.17.1 and v0.17.2 release `iFizBox.ipa` (17.7 MB vs 28.5 MB): the executable
and everything else is within a few KB; the whole growth is **`web/icons/themes/`, 10.6 MB compressed**, new in 0.17.2
(F322 per-theme home-screen icons, F325 five more themes, F326 glossy sizes; 512 px alone is 5.4 MB). Not
Tailscale/idevice. build.sh copies web/app/ whole, and no app code reads `icons/themes/` (the Home header and Theme
pages use the shell's `appicon/<name>.png`, F323). Filed **C55** to leave it out of the native bundles.

## Not verified

- **On a phone**: no Upgrade from an older Lite to an IPA over 25 MB was run. It needs this Worker deployed to
  ifizbox.com (the runner publishes after merge; this session doesn't deploy) and a build with a newer version than
  what the iPhone 15 Pro has; the Swift `HostUpload` path was only compiled, not run.
- **On Cloudflare**: the streamed one-body split (`hostBody`) and the part reads were tested on Node with an in-memory
  KV, not on workerd; the 95 MB one-body cap assumes the plan's 100 MB request limit.
