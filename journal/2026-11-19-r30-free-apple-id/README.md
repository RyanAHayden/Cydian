# R30 Free Apple ID route: feasibility (journal)

Findings, the verdict and the follow-ups are in [notes.md](notes.md). In short: go for a spike (F251), no-go for the
feature until the stock-phone check R32 shows iOS updates a development build in place.

## What I did

- Made a free-account (Personal Team) development certificate and 7-day profile with Xcode on the MBA, using a
  throwaway app project. xcodebuild ran as a launchd job in the GUI session (`launchctl bootstrap gui/501`),
  because ssh can't use the login keychain. Exported the identity and re-packed it for zsign.
- Signed with the website's real job (`tools/websign.mjs` → websign-job.js + vendor/zsign), checked the result with
  `codesign --verify --strict` on the MBA, put it on the live Worker through `/sign/upload`, and installed it on the
  iPhone 7 from the itms link. It launched.
- Added a test page (`tools/itms-webapp-test.html`) to the 7's Home Screen as a standalone web app. Its itms links
  open the install prompt, and an install from it finished.
- Tried four reinstalls over installed copies, and all were refused with "Already Installed". installd's log has no
  entry for them.
- Probed the 22 public anisette servers 3 times each (`tools/anisette-probe.sh`, `anisette-probe.tsv`). Checked CORS
  and TLS chains of gsa.apple.com and developerservices2.apple.com, and checked the gsa chain against Cloudflare's
  cfssl_trust bundle. Sent one GSA SRP `init` with and one without public anisette, both for a made-up
  `@example.invalid` address (`tools/gsa_init_probe.py`).
- Read the licenses and dependencies of AltSign, SideStore, AltServer-Linux, apple-private-apis, isideload,
  Impactor, xtool, Sideloader, Provision and anisette-v3-server (GitHub API).
- Cleaned up afterwards. The two probe apps are deleted (Settings > iPhone Storage) and the test web clip is
  removed. `/tmp/r30probe` on the MBA (it held the exported keys) and my scratchpad copies are deleted, and the
  launchd job is unloaded.
- docs/iphone7.md gained three phonectl tips: a zero-movement long-press for jiggle mode, a double Home press for
  the app switcher, and deleting a test app through Settings > iPhone Storage.
- Filed R32, F251, F253 and F254.

## Tried and failed

- `xcodebuild -allowProvisioningUpdates` over ssh: "User interaction is not allowed" and "No profiles … were
  found". Running it as a GUI-session launchd job fixed it.
- The first probe source was called `main.swift` with `@main`: "'main' attribute cannot be used in a module that
  contains top-level code". Renamed it.
- zsign "Signed Failed!" on the macOS export, which is RC2-40 and holds every keychain identity. Fixed by
  re-packing with `openssl pkcs12 -export -legacy` around just the matching cert and key.
- A long-press that moved 1 px didn't start jiggle mode. A swipe that didn't move at all did.
- iFizBox's Installed page was in the middle of someone else's "Downloading Packages" run, so I left it alone. I
  deleted the probe apps through Settings instead.

## Not verified

- **A stock phone**: the install, the trust step, Developer Mode, and above all **whether itms updates a development
  build in place**. The 7 runs AppSync, and no stock phone is in reach of an unattended run. This is R32 (the user).
- **iOS 26 standalone web app → itms**: no iOS 26 phone here. Also R32.
- **A Worker actually fetching gsa.apple.com**: shown only by verifying the chain against cfssl_trust from the
  desktop. Deploying a test Worker is publishing beyond git and needs the user's OK. Part of F251.
- **A full GSA sign-in** (SRP complete, 2FA, app token, developerservices2 calls with a token): it needs a real free
  Apple ID and its 2FA device, so it wasn't attempted. Only `init` with a made-up address was run.
- **Whether Apple throttles or flags Cloudflare egress or a shared v1 anisette machine**: not measurable without real
  accounts. F251.
- **Anisette reliability beyond a few minutes**: three rounds only. The Worker-side fetch (and Cloudflare-to-Cloudflare
  for the 4 servers behind Cloudflare) wasn't tried. The v3 WebSocket provisioning wasn't run.
- **The Profile Service UDID flow**: it needs a deployed https endpoint, so it wasn't tried. F253.
- **Free-account limits** (3 apps, 10 App IDs a week, the certificate cap, what a revoke does to installed apps): from
  the projects' docs and code, not tested. Testing them would use up the user's account limits. Only the 7-day
  profile and the 1-year certificate were seen.
- **Why the 7 refuses the reinstalls**: no store/install-coordination logs could be read (no `log`/`oslog` on the
  phone), only installd's.
- Button 3 on the test page (`location.href` 2 s after the tap) wasn't tapped. F121/B85 already cover links opened
  outside the tap.
- The `ssh -R 8731` tunnel to the 7 runs until its 50-minute `timeout` (I didn't keep its pid). The server behind it
  is stopped, so it forwards to nothing.
