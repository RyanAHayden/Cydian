# F131: packages whose Filename is a full URL

ios.jjolano.me lists `Filename: https://github.com/.../hookkit-rootless.deb`. apt joins it to the repo URL and 404s
(N6 on the iPhone 7: `Failed to fetch https://ios.jjolano.me/https://github.com/...`). Sileo fetches the link.

## What I did

Took the "fetch in the shell, install as a local deb" road, because every native piece already existed (N9):
`share.debFetch {url}` downloads a link into the helper's .deb folder, `share.debSimulate` / `share.debInstall` run
`cydian-helper simulate-deb` / `install-deb` (`apt-get install ./copy.deb`, dependencies from the sources). So no
Swift or helper change was needed; the work is all in the web app:

- `core/queue.js`: `isAbsoluteFilename`, `debUrlOf(history, version)` (the version asked, else the candidate; only
  http(s) links, the shell fetches nothing else), `mergePlans`.
- `screens/queue.js` Confirm: before simulating, each install job gets `debUrl` from `catalog.history` when its
  version's Filename is absolute (`withDebUrls`). After a good simulation, any package apt would pull in whose
  Filename is absolute is added to the queue (`queueLinkedDeps`), so a tweak depending on hookkit also works; the
  add redraws the sheet. `drawIssues` shows the backend's `issues` sentences first.
- `backend-native.js`: `simulate` / `apply` split off jobs with `debUrl` (`linkedDebs`): fetched once per job and URL
  (kept across simulate → apply), simulate-deb for each, apt's simulate over the rest, merged into one plan. Apply runs
  install-deb for each linked job first (anything queued may depend on them), then apt's apply/apply-ask over the
  rest; the first failure ends the run. A download failure, or a link that gives a different package than the job's
  id, is an `issues` sentence on Cannot Comply (not a helper error). A staged file swept away is fetched again;
  clearing a job or the queue discards its download (`share.discard`).
- Tests: `web/app/backend-native-linked.test.js` (stand-in share.* calls over the fake helper's simulate-deb /
  install-deb).

Nothing tried failed; the tests passed on the first run.

## Decisions

- Linked debs are installed one install-deb each, before apt's run, rather than extending the helper's `apply` to
  take staged paths: no new root-side parsing, and the helper's N9 path is already reviewed. Cost: a queue with links
  is several dpkg runs, not one.
- The console's Cancel (F64) only stops apt's apply-ask. During install-deb a tap gets "Couldn't cancel"; the
  install-deb's first pmstatus line hides Cancel anyway.

## Not verified

- On the iPhone 7: the task didn't ask to touch it, so no real install of hookkit-rootless from ios.jjolano.me was
  run. The Swift calls used are N9's, unchanged, and tested there; this run only checked them through a stand-in.
- The Confirm sheet changes (`withDebUrls`, `queueLinkedDeps`, the issues rows) have no DOM test: screens/queue.js has
  no test harness for openConfirm. Checked by reading only.
- The downloaded .deb isn't checked against the Packages stanza's SHA256/MD5sum (apt would check a normal download).
  Filed as a follow-up: the shell would need to hash the file (native/share).
- N7's daemon (automatic updates) still hands such packages to apt by name and will fail on them. Filed.
