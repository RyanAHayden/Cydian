# B17: Cydian's APT repo at cydian.dev/repo/, without GitHub's redirect

Zebra 1.1.36 names its cache file after the final URL of a fetch, and GitHub's
`releases/latest/download/<file>` ends at a signed `release-assets.githubusercontent.com/...?sig=&jwt=` URL that is
too long for a file name (N11, `journal/2026-11-18-n11-hand-test`). So the repo now lives at
**`https://cydian.dev/repo/`**, served by the Worker.

## What changed
- `worker/src/index.js`: `GET|HEAD /repo/<file>` (`repo`, `repoFile`). Only `Release`, `Packages`, `Packages.gz` and
  `*.deb` names (safe characters) are fetched: everything else (InRelease, Release.gpg, Packages.xz, icons) is a 404
  without asking GitHub. It fetches `github.com/<CYDIAN_REPO or RyanAHayden/Cydian>/releases/latest/download/<file>`
  through the existing `upstream()` (redirects followed server-side, 429/5xx retries, GITHUB_TOKEN fallback through
  the API) and streams the body with its own Content-Type (Packages.gz as `application/gzip`, never a
  Content-Encoding), Content-Length, Last-Modified and ETag. GitHub 404 → 404, other failures → 502. `/repo`
  → 301 `/repo/`; `/repo/` answers a one-line text. `Cache-Control` 300 s for the index files, 3600 s for .debs
  (their names carry the version).
  Both wrangler configs add `/repo` and `/repo/*` to `run_worker_first` (otherwise the SPA fallback answers
  index.html, which is what cydian.dev does today for `/repo/Release`).
- Built-in source `SELF_APT_URI` (`web/app/core/essential.js`) and the website's `CYDIAN_APT_REPO`
  (`web/app/screens/home.js`, Add to Sileo/Zebra and Copy Repo URL) → `https://cydian.dev/repo/`.
  essential.js isn't in the task's file list, but the brief names "the built-in source", which is that constant;
  only the constant and its comment changed.
- `native/deb/postinst`: rewrites the old GitHub URI in `/var/jb/etc/apt/sources.list.d/cydian.sources` to the new
  one, or drops the old stanza if a new one is already there. **Plain sh**: the iPhone 7 has no awk (my first
  version used awk; `ssh 7 'command -v awk'` found none, so it would have silently done nothing). Test:
  `native/deb/test_postinst_source.py` (runs the block with dash/sh/bash on fixtures). Only cydian.sources is
  touched; a GitHub stanza a user added in Sileo's own `sileo.sources` stays (it still works in Sileo and apt).
- `tools/release.sh` prints `apt repo: https://cydian.dev/repo/, from https://github.com/.../latest/download/`
  (a fork publishing elsewhere is told to set `CYDIAN_REPO` on its Worker); `tools/selfrepo.py` docstring,
  `docs/release.md`, `worker/README.md` routes table.

## Checks
- `node worker/test.mjs` (new "worker repo" block: names allowed/refused, headers, HEAD, 404 pass-through, no GitHub
  call for refused names, CYDIAN_REPO, 503 → 502, routing ahead of the assets), home/essential node tests,
  `tools/test_release.py`, the new postinst test.
- `worker/node.mjs` (the same Worker code on Node) against **live GitHub**: Release, Packages, Packages.gz 200 with
  0 redirects; InRelease 404; the 3.8 MB .deb's SHA256 matches Packages; Packages.gz decompresses to Packages.
- iPhone 7, through `ssh -R 8797:127.0.0.1:8797 7` to that node server (`http://127.0.0.1:8797/repo/`):
  - apt: `apt-get update` with only that source (`Trusted: yes`, see below) got Release and Packages;
    `apt-cache policy` lists 0.3.8-731 from it; `apt-get download` fetched the .deb (apt checks its hash).
  - Zebra 1.1.36 (installed for this test, then removed with its Application Support folder): `zbra://sources/add/…`
    added it as **Cydian** with no error, its page shows All Packages 1 / Packaging 1
    (`ref/7/screens/b17-zebra-added2.png`, `b17-zebra-source.png`).
  - Sileo 2.5.1: "Could not parse release file" (`b17-sileo-4.png`), as expected: the **published** Release
    (0.3.8-731, 09:26Z today) predates N11's `Components: main` fix, so it is the same N11 bug 1, not the
  transport. N11 already showed Sileo accepting the fixed Release served without a redirect.
  - postinst's block under the phone's own dash on a copy of its real cydian.sources (in /tmp): rewritten to
    cydian.dev/repo/; with both stanzas present the old one is dropped.

## Tried and failed / notes
- awk in postinst (the phone has none): replaced by a sh loop.
- apt refuses an unsigned **http** repo ("is not signed") where the https GitHub one passes on this phone; the
  test stanza used `Trusted: yes`. cydian.dev/repo/ is https like before, so this doesn't apply to it.
- My second node server hit EADDRINUSE because the first (60 s timeout) was still up; restarted once it ended.
- `sileo://source/<url>` opened Sileo on an old package page instead of adding; added the stanza to sileo.sources
  by hand (backup restored afterwards).

## Phone left as found
Zebra removed (and `/var/mobile/Library/Application Support/xyz.willy.Zebra`), `sileo.sources` restored from its
backup, the temporary `b17test.sources` and apt's 127.0.0.1 lists removed, /tmp files gone, tunnel and node stopped
by pid. cydian.sources still names the GitHub URI (0.3.8-791 installed; the postinst rewrite runs with the next
.deb). Sileo may still show the 127.0.0.1:8797 entry (and N11's 8711 one) in memory until its next refresh.

## Not verified
- **The live https://cydian.dev/repo/**: not deployed from a task (Workers Builds deploys after the merge). Until
  then cydian.dev answers `/repo/Release` with the website's index.html. After deploy, check:
  `curl -sI https://cydian.dev/repo/Release` (text/plain, no redirect), then Zebra and Sileo add `cydian.dev/repo/`.
  On Cloudflare (vs Node) the untested bits are `encodeBody: "manual"` with an `application/gzip` body and whether
  Cloudflare re-compresses text/plain for clients (harmless for apt/Zebra/Sileo, which decode it).
- **Sileo against this repo with a Components line**: needs the next release (tools/release.sh) to publish the
  fixed Release; the fix itself was verified in N11.
- **The postinst on a real upgrade** (dpkg running it as root on the phone): only its block was run, under dash,
  on a copy. Needs the next .deb install.
- **The Cydian app's built-in source switching** on the phone: needs a .deb built from this branch; the node tests
  cover that the built-in record now uses the new URI.
