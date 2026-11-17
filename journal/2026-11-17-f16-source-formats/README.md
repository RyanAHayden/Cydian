# F16: every source format, auto-detected

## What was done

New, all under `web/app/core/sources/` (pure JS, no DOM):

- `detect.js`: `detect(url, body)` says what a URL served, from the body and not the URL's name:
  - **apt**: a Release, an InRelease (clearsigned), or a Packages index, plain or compressed. Compression is read from
    the magic number (gz, bz2, xz, zst, lzma), so a `Packages.xz` sent as octet-stream, or under any name, is still
    recognised.
  - **altstore**: JSON with an `apps` array.
  - **esign**: the same, plus ESign's markers (`sourceicon`, `payURL`, `unlockURL`, `message`, or app
    `type`/`lock`/`isLanZouCloud`).
  - **scarlet**: `META` (or Scylla's `Info`) holding `repoName`/`repoIcon`, plus groups of apps that each have
    `down`/`ipa`.
  - **gbox**: `sourceName`/`appCategories` + `appRepositories`. If `appRepositories` is a string, GBox encrypted it:
    the result is `parsable: false` with a reason.
  - Garbage throws `SourceFormatError` (a `SourceError`, kind `not_source`, title "Did not Find Source"). Its message
    names what the host sent: an empty page, a web page, broken JSON, JSON in no format we know, or text that is
    neither APT nor JSON.
  - `aptLayoutFromUrl` turns any path Cydia reads into `{ uri, dist, components }`: flat `Packages*` / `Release`,
    `dists/<dist>/<comp>/binary-<arch>/Packages*`, `dists/<dist>/(In)Release`, and the `dists/<dist>/` directory. A
    dist may contain slashes, like Telesphoreo's `ios/1800.00`.
  - `unwrapLink` reads every add-source link: `<scheme>://source?url=`, `feather://source/<url>`,
    `stikstore://add-source?url=`, `trollapps://add?url=`, `scarlet://repo=<url>`,
    `cydia://url/…share#?source=`, `sileo://source/`, `zbra://sources/add/`, `installer://add/`. Any other scheme
    falls back to a `url=`/`source=`/`repo=` value or the first http(s) URL in the link. A bare host gets `https://`.
  - `FORMATS` lists, for each format, its name and the apps that read it (input for F8's "Open in" rows).
- `ipa.js`: `toAltSource(format, json)` maps ESign, Scarlet and GBox onto the AltStore shape, so
  `parseAltSource`/`appStanza` (F9) produce the same catalog rows. `parseIpaSource` also keeps the fields AltStore
  doesn't read as `extra` on the source, on each app and on each version. Examples: SideStore's `absoluteVersion`,
  `appID`, `apiVersion`, `sourceURL`; AltStore's `sha256`, `patreon`, `patreonURL`; ESign's `lock`, `type`,
  `isLanZouCloud`, `sourceicon`, `message`; Scarlet's `contact`, `appstore`, `debs`, group; GBox's `appType`, LINK
  entries. Apps with no real bundle id (common in ESign, always in GBox) get `<format>.<name-slug>`, which stays the
  same across refreshes. Scarlet repos list tweaked builds under the original app's bundle id, so a repeated id gets
  `.<name-slug>` appended instead of hiding the app. GBox `appUpdateTime` (`+0800`, single-digit hours) is
  normalised to ISO. Scylla's `iOS: "14.0 - 15.7.1 and 16 - 16.1.2"` becomes min 14.0 / max 16.1.2.
- `add.js`: `detectSource(backend, input, { arch, count, dists })` handles one add:
  1. Fetch the URL and detect it. An IPA format becomes an `alt:` record with `format` (an encrypted GBox source is
     saved with `unsupported: reason`). APT becomes a counted `deb:` record via `refreshSource`; a Packages URL reads
     the dist's Release for the full component list.
  2. If the URL is a web page or missing, try it as a flat APT repo (`verifySource`), then as `dists/<d>/` for each
     `dists` candidate (default `["stable"]`; the caller passes CoreFoundation dists like `1800`).
  3. Otherwise it is refused, with a message that says what was there and what the address should be.
- Fixtures in `web/app/core/fixtures/sources/`, and 16 node tests in `core/sources/detect.test.js`.

## Live sources the fixtures come from (fetched 2026-11-17, trimmed: 2 apps, 2 versions, long texts cut)

| fixture | format | URL |
|---|---|---|
| altstore-classic.json | altstore (AltStore Classic/PAL) | https://apps.altstore.io/ (→ cdn.altstore.io/file/altstore/apps.json) |
| sidestore-community.json | altstore (SideStore) | https://community-apps.sidestore.io/sidecommunity.json |
| feather.json | altstore (Feather's own) | https://raw.githubusercontent.com/khcrysalis/Feather/main/app-repo.json |
| livecontainer.json | altstore (LiveContainer) | https://github.com/LiveContainer/LiveContainer/releases/download/1.0/apps.json |
| stikstore.json | altstore (StikDebug/StikStore) | https://stikdebug.xyz/index.json |
| trollapps-utm.json | altstore (UTM, TrollApps' example and trusted list) | https://alt.getutm.app/ |
| esign-zeeho.json | esign | https://zhb.xn--fiqz59cpva341l.top/app/version2.json (open source: github.com/lswlc33/zeeho-3d-models) |
| scarlet-locus.json | scarlet | https://raw.githubusercontent.com/suprstarrd/locus-ios/main/scarlet.json (Locus, open source) |
| scarlet-scylla.json | scarlet (Scylla variant) | https://puffer.is-a.dev/scylla-ios/cdn/repo.json |
| gbox-qoli.json | gbox | https://raw.githubusercontent.com/qoli/GboxApps/main/apps.json |
| apt-dist-Release / InRelease / Packages | apt dist | https://apt.procurs.us/dists/1800/ (Packages: 3 stanzas of main/binary-iphoneos-arm64/Packages.xz) |
| apt-dist-Packages.{gz,bz2,xz,zst,lzma} | apt | made here from the trimmed Packages with gzip, bzip2, xz, zstd, `xz --format=lzma` |
| apt-flat-Release / Packages | apt flat | https://repo.chariz.com/ |
| page-repo-landing.html | (page) | hand-written in the shape of repo.chariz.com/'s landing page |
| gbox-encrypted.json | gbox, encrypted | hand-made from the shape in GBoxApp/GBoxSource's README (the README's own example is an adult source) |
| garbage.txt, garbage.json | refused | hand-written |

How the sources were found: GitHub code search (`"repoName" "repoIcon" extension:json`, `"isLanZouCloud"
extension:json`, `"appRepositories"`), and each app's README. No piracy sources: I skipped Scarlet's official repo
(tweaked Spotify and others), Watusi, SpotC, Streamer/Movix (streaming scrapers) and CercubePlus stores. The
fixtures are open-source apps or the developers' own apps.

Format findings:
- **TrollApps** reads AltStore JSON (its DOCUMENTATION.md: "a json structure extremely similar to AltStore",
  `screenshotURLs`). No separate parser is needed.
- **KSign** writes AltStore JSON in its repo maker (KSign's RepoMakerView.swift, in a fork:
  AmazingTIsm/EthSinger). The same view also exports Scarlet JSON. KSign reads AltStore.
- **GBox** has its own format (GBoxApp/GBoxSource README, v1.1.2: appType SHAREING/SELF_SIGN/ENT_SIGN/LINK,
  appCateIndex, appPlist, lock/hide). Encrypted sources can only be read by GBox.
- **ESign** is AltStore 1.x plus its own fields. Its bundle ids are often junk ("youtube").

## Failed along the way

- LiveContainer's `apps.json` is not in the repo (404 on raw.githubusercontent.com). The README links a release asset.
- `jbmagination.com/locus-ios/scarlet.json`, the link Locus's page gives Scarlet, answers 404. The raw GitHub copy is
  live.
- First Chariz Packages trim had only rootful stanzas, so the arm64 count was 0. Re-trimmed to 1 rootful and 2
  rootless.

## Decisions (unattended)

- **Not wired into the Add Source flow or the catalog.** The task's files are `core/sources/**` and fixtures. Wiring
  means editing `core/altstore.js` (withAltSources → detectSource, refresh by `format`), `core/catalog.js` (loadAlt →
  parseIpaSource) and the UI catalog loader. Filed as F16a. Until then the AltStore path works as before, and
  the new formats are only reachable through these functions.
- The IPA formats share the `alt:` key and the `kind: "altstore"` record with a new `format` field, so the existing
  AltStore list stores them with no schema change.
- Compressed Packages bodies are recognised, not decompressed, in the core. The backend's `packages()` (server /
  native) decompresses, as it does already.
- An APT dist root can't be found without knowing the dist name, so `dists` candidates come from the caller (the
  phone's CoreFoundation dist). The default is only `stable`.
- Scylla is read as a Scarlet variant rather than as a sixth format.

## Not verified

- **ESign and GBox `size` units.** Metia's ESign source writes `"size": 9`, maybe MB. The value is passed through as
  bytes, as AltStore defines it. I could not check what ESign shows.
- **`esign://`, `ksign://`, `gbox://` link shapes.** No documentation found. They are read by the generic rule
  (`url=` or an embedded URL), not a known pattern.
- **bz2, xz and lzma fixtures decompressing back to the index.** Node has no decoder for them. They were made with
  the system tools from the same text, and only gz/zst are round-tripped in the test.
- **The Procursus InRelease signature.** It was cut out of the fixture. Nothing in Cydian verifies signatures yet.
- **End-to-end in a browser or on the phone.** Nothing is wired yet (see Decisions), so there is no screen to check.
