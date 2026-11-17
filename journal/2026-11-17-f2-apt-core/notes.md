# F2: repo parsing in the shared core

## What I did

- `web/app/core/apt.js` (pure, no DOM, no I/O):
  - `parseControl`: deb822 stanzas, field names lower-cased (BigBoss ships `homepage:` beside `Homepage:`),
    continuation lines joined with `\n` minus their first space/tab, CRLF/BOM tolerated, first duplicate wins
    (as apt), `#` lines skipped. `description()` splits synopsis/long text (` .` -> empty line, two-space lines
    keep one space = verbatim). `parseRelations` for Depends-style fields (cheap, will be needed by upgrades).
  - `parseRelease` (+ `stripClearsign` for InRelease; signature not checked): fields, `architectures`,
    `components`, and `hashes.{md5sum,sha1,sha256,sha512}` as `[{hash,size,path}]`.
  - `repoLayout(source, arch)`: flat (`dist` ends in `/`) vs dist URLs for Release/InRelease/Packages, and the
    `root` that Filename resolves against (the URI, as apt's ArchiveURI does, also for flat repos).
  - `resolveFilename`, `resolveIcon`, `parsePackages` (adds `debUrl`, `iconUrl`; camelCase so they can't clash
    with a lower-cased field). Paths with `:` (`debs/apt_1:0-23_…deb`), `#`, `?`, spaces are kept out of
    URL()'s scheme/fragment/query parsing.
  - `parseVersion`, `compareVersions` (dpkg's `verrevcmp`, ported), `satisfies` (`<< <= = >= >>`, obsolete
    `<`/`>` as `<=`/`>=`).
- `core/worker.js`: module worker; `{id,type,text|bytes,root}` in, `{id,ok,result|error}` out. Decodes bytes
  with a non-fatal TextDecoder in the worker. Only installs `onmessage` inside a WorkerGlobalScope.
- `core/parser.js`: `createParser()` promise API over the worker, transfers ArrayBuffers, falls back to inline
  parsing when there is no Worker or it can't start, rejects pending calls on worker error.
- `core/cache.js`: `openIndexCache({indexedDB})`, one store keyed by URL, records
  `{key, value, etag, lastModified, savedAt}` for later revalidation.
- Fixtures in `web/fixtures/` (see its README): stanzas copied byte for byte from the 4S lists plus one
  synthetic flat-repo stanza. Tests: `core/apt.test.js` (incl. a 48-pair version table from policy 5.6.12's
  rules, both directions), `core/cache.test.js` (in-memory fake IDB).

## Decisions (unattended, written down)

- **Icon rule.** Cydia (iOS 6) only honours `file:///` icons, as local files. Real repos ship garbage too:
  `files:///`, `file::///`, `file://Applications/…`, bare `/Applications/…`. I normalise those to `file:///`
  (they're device paths) and let the UI decide (`isLocalUrl`): only the app can show them, once installed.
  http(s)/data kept; anything else is resolved against the repo root, per the brief. One BigBoss package ships
  `Icon: Library/PreferenceLoader/…` (clearly a device path missing its `/`); it resolves to a repo URL that
  will 404, which the UI must treat like any broken icon.
- **No decompression here.** Packages.bz2/.gz/.xz are not decoded in core; the server proxy (F3) or the native
  backend hands over plain text/bytes. File a task if the site needs client-side bz2.
- Version parsing is lenient (Cydia-like): bad epochs count as 0, nothing throws.
- Encoding: BigBoss's Packages has invalid UTF-8 (byte 0xd5 at offset 297298); the worker decodes with U+FFFD.

## Checks run

- `node --test web/app/core/`: 19 pass.
- Full 4S lists through `handle()` (node 26): ModMyi 15 MB / 26235 pkgs in 86 ms, BigBoss 12.5 MB / 16744 in
  65 ms, ZodTTD 10.5 MB / 18002 in 51 ms, saurik 364; package counts match `grep -c ^Package:`. Sorting all
  versions with `compareVersions` 20-28 ms.
- Headless Chromium (`/usr/bin/chromium`), page served over http: `createParser()` started a real module
  worker (`inWorker=true`), parsed `flat-Packages` (9 stanzas), the ArrayBuffer was transferred (byteLength 0
  after), iconUrl resolved. Throwaway page lived in the session scratchpad, not committed.

## Not verified

- **Safari / WKWebView** module workers (iOS 15+ supports `type: "module"` workers per spec support tables, but
  not run here: no iOS device with iOS 15+ or Safari on this Linux box). The inline fallback covers a
  failing constructor, but not a worker that starts and then fails to import (that rejects via `onerror`).
- **Real IndexedDB**: `cache.js` is only tested against an in-memory fake that models the API surface it uses;
  not run in a browser.
- **Against real dpkg**: no `dpkg` on this machine and the task doesn't allow using the 4S, so the version table
  is checked against policy 5.6.12's rules and dpkg's algorithm as ported, not against `dpkg
  --compare-versions` output.
- Performance on the device (A5 in the 4S, or modern iPhones) not measured; numbers above are desktop node.
