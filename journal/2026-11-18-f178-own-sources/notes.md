# F178: iFizBox's own sources at ifizbox.com, lite and full kept apart

## What changed

1. **AltStore source at https://ifizbox.com/repo/source.json** (brand.js `DOMAIN`), beside the APT repo at `/repo/`.
   - `worker/src/index.js`: `selfSource`, routed from `repo()` for `/repo/source.json`. It serves the deployed
     `web/app/source.json` (the `ASSETS` binding), else the latest release's `source.json` asset (`IFIZBOX_REPO`
     respected), as JSON with CORS, `max-age=300`. GET/HEAD only.
   - `/api/fetch` of the Worker's own `https://<DOMAIN>/repo/...` (or www., or the request host) is answered in
     place (`ownRepoUrl`), not fetched. The site proxies every source, so its built-in source would otherwise be a
     Worker fetching its own custom domain. Cloudflare doesn't route that back to the same Worker reliably (I didn't
     test this on Cloudflare; see Not verified).
   - Defaults moved off raw.githubusercontent.com: `core/sources.js` DEFAULT_ALT_SOURCES[0], `core/essential.js`
     SELF_ALT_URL, `core/appoffer.js` APP_SOURCE_URL (plus a new APP_APT_REPO, which home.js's IFIZBOX_APT_REPO now uses).
   - `tools/altsource.py`: the source gets `"sourceURL": https://<BRAND_DOMAIN>/repo/source.json` (checked by `check`)
     and its icons are `https://<BRAND_DOMAIN>/icons/icon-180.png` (the site's own asset) instead of raw GitHub.
     `web/app/source.json` was regenerated with `python3 native/brand.py sync` (rebrand: versions untouched).
   - `tools/release.sh`: it builds the updated source once in the stage, uploads it as a release asset `source.json`
     (the Worker's fallback), copies it into `web/app/source.json` afterwards (same as before), and prints the source URL.
2. **Lite vs full**: `core/appoffer.js` `ownBuilds(mode)` and `hiddenAltApps(mode)`.
   - sideload: IPA only. It already had no .deb, no Install Full tile and no APT sources (F144 drops them). Home's
     Full tile now asks `ownBuilds(settings.mode).deb` as well as site mode.
   - jailbreak: `core/catalog.js` `loadAlt(..., hide)` leaves out the bundle IDs `hiddenAltApps("jailbreak")`
     returns (`com.ryha.ifizbox`), from rows, count and featured apps. `web/app/catalog.js` passes
     `hiddenAltApps(detectMode())`, so iFizBox's lite IPA never shows from any AltStore source in the jailbreak app.
     I edited that file, though it's outside the brief's file list: it is the only caller of loadAlt.
   - site: unchanged, it keeps both tiles and lists the IPA.

## Tests
- `web/app/core/ownbuild.test.js` (new): the source URL in every place, the built-ins per build, ownBuilds and
  hiddenAltApps, the catalog hiding iFizBox only in the jailbreak build, and that home.js and catalog.js use them.
- `worker/test.mjs`: "worker self source" block: ASSETS first, release fallback, IFIZBOX_REPO, 404, HEAD/POST,
  the whole Worker routing it, and `/api/fetch` of its own URL answered without a network fetch.
- `tools/test_altsource.py` (default source is the domain URL, `sourceURL`), `tools/test_release.py` (source.json asset).

## Notes
- I made a few edits through a python heredoc or a `cat >>` append before switching to the edit tool. The content is
  the same either way.

## Not verified
- I didn't deploy, so the live https://ifizbox.com/repo/source.json doesn't answer until the Worker is deployed. Until
  then, apps carrying this build get a 404 for their built-in source. Deploy it with the usual
  `tools/buildinfo.sh && npx wrangler deploy -c wrangler.ifizbox.toml` (worker/), or let Workers Builds do it
  when this merges.
- On real Cloudflare: does `env.ASSETS.fetch` of `/source.json` work from inside the `/repo/` route? I did see that
  the assets binding answers in tests with a fake. I haven't tested whether a Worker fetch of its own custom domain
  loops, because `ownRepoUrl` avoids that fetch.
- I didn't run the jailbreak or sideload app on the iPhone 7: the task didn't call for the phone. The filtering is
  covered by node tests only.
