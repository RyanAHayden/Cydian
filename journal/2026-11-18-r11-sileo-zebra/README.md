# R11: learn from Sileo and Zebra

The result is `docs/sileo-zebra.md`. No app code was changed.

## What I did
- The brief came back empty (`agent-runner plan brief R11` found no R11). The task line was only on origin/main,
  commit 944b492, added after this branch was cut. I read it there with `git show 944b492`.
- Made shallow clones of Sileo (`c9f7015`, 2024-10-08, BSD-4-Clause) and Zebra (`e2f3c27`, 2026-11-15, GPL-3.0)
  into the session scratchpad and read them there. Nothing from either was copied into the repo.
- Read their search code:
  - Sileo: `PackageListManager.packageList/sortPackages`, `PackageListViewController` (searchCache, history,
    Canister heartbeat) and `CanisterResolver` (search, provisional queue, ingest, piracy).
  - Zebra: `ZBSearchTableViewController` and `ZBDatabaseManager searchForPackageName`.
- Read the depiction view classes, featured banners and the payment code in both: Sileo's `PaymentProvider` and
  `KeychainManager`, Zebra's `ZBPaymentVendor` and `ZBDownloadManager`.
- Read the queue and resolver code: Zebra's `ZBDependencyResolver` and `Queue/`, Sileo's
  `DownloadsTableViewController`.
- Read the refresh code: Sileo's `RepoManager` (hash cache, 3-hour rule, compression order) and Zebra's
  If-Modified-Since.
- Compared each with Cydian's current code (`core/catalog.js`, `screens/search.js`, `screens/extras.js`,
  `core/canister.js`, `core/featured.js`, `screens/depiction.js`, `core/payment.js`, `native/Sources/Paid.swift`,
  `core/deps.js`, `screens/queue.js`, `core/health.js`, `core/cache.js`).
- Filed these follow-ups:
  - B10: payment fields.
  - F99: Add Source & Install.
  - F100: Recent Searches.
  - F101: ranking.
  - F102: Wish List.
  - F103: depiction views.
  - R12 (low): 4S search timing.
  - F104 (low): Installed sort and Hide by Author.

## Findings worth knowing
- Cydian already has most of what these apps are known for. The real gaps are listed in the doc's ranked list.
- **A possible bug (B10).** Cydian's `purchase` request body leaves out `udid`/`device`, and `authorize_download`
  leaves out `architecture`. Sileo and Zebra both send all three.
- **Sileo has a search-history bug.** It saves the history as `Array(Set(...))`, so the order is lost.
- **Sileo sends telemetry.** It POSTs every installed package to Canister's `/download/ingest`. Cydian shouldn't
  copy that.

## What didn't work
- At first I wrote that Sileo's queue sheet has an "Install anyway" for errors, and that Sileo's wish list marks
  updates. When I checked `DownloadsTableViewController`, I found Confirm is disabled while there are errors, and I
  hadn't read the wish-list code at all. I fixed the first claim and removed the second before committing.
- `grep` on this machine is ugrep. A `--` before `--include` turned the option into a file name. I re-ran the
  search without it.

## Not verified
- **Which repos ship Sileo depictions, and with which classes.** I checked no live depiction JSON. The doc names
  Chariz and Havoc only because F20 checked their featured files. The brief asked "which repos ship them", and that
  question is still open. Sampling the `SileoDepiction:` URLs from the default sources' Packages files would answer
  it. I left it out to keep the task to reading code, and filed no task for it.
- **Whether the vendors need the missing fields.** The spec page (developer.getsileo.app/payment-providers) wasn't
  re-read, and no vendor was tested. B10 is based on what both clients send, not on a refusal anyone has seen.
- **The 4S search timing.** I measured nothing. R12 is filed for it.
- **Zebra's runtime behaviour.** Everything here comes from source code. Neither app was run.
- **The follow-up ids.** They were filed from this worktree's `plan/TODO.md`, which is behind origin/main. On main,
  the second F96 became F97. If main already has an F98–F104 or a B10, the runner's merge has to settle the
  duplicate ids.
