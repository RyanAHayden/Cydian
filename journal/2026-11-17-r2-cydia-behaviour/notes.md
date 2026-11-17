# R2: Cydia behaviour notes (docs/cydia.md)

## What I did
- Cloned Cydia over `git://git.saurik.com/cydia.git` into the session scratchpad. `https://` returned 503.
  HEAD is `837b7c8` (2019). The device runs v1.1.30.
- `git submodule update --init apt32` fails ("not our ref e239300…"): the pinned commit isn't on saurik's server.
  The submodule clone still has apt-legacy HEAD `9439ca0`, so I used that (`git checkout -f HEAD` inside `apt32/`).
  `methods/http.cc` there is where `X-Firmware`/`X-Machine`/`X-Unique-ID` and the Telesphoreo User-Agent are set.
- Read these parts of `MobileCydia.mm`:
  - `Source` (Release fields, `CydiaIcon.png`);
  - `SourcesController` (add-source HEAD checks, repotag warning);
  - `Package -initWithVersion:` and the Cytore structs (metadata.cb0);
  - `ChangesController`, `SectionsController` and `SectionCell`;
  - `Package -icon`;
  - `CydiaURLProtocol` and `-pageForURL:forExternal:`;
  - `CYPackageController`, `ConfirmationController`, `ProgressController`;
  - the status-fd and `$CYDIA` readers.
- Also read `CyteKit/extern.mm` (User-Agent), `CyteKit/URLProtocol.mm` and `Sources.mm` (sources.list writer).
- `git diff v1.1.30 HEAD -- MobileCydia.mm` has nothing in the areas documented. The diff is large, but it's all
  build fixes, embedded apt methods and cache-header tweaks in the web view.
- The package page, Confirm sheet and console are web pages on cydia.saurik.com, not in the repo. I pulled the
  cached copies out of `ref/4s/.../com.saurik.Cydia/ApplicationCache.db` (read-only sqlite) into the scratchpad
  and read them for behaviour. That's where the depiction rules, Confirm layout and console CSS sizes come from.
  The doc says they're saurik's pages, not GPL, so describe them and don't copy them.
- Checked device state in `ref/4s` (no ssh, no screen):
  - list file names (flat `_._Packages`);
  - `Cache.db` URLs (`URI./CydiaIcon.png`);
  - `Sections/` (68 icons), `Purposes/` and `Sections.plist` (42 aliases);
  - `CacheState.plist`.
- Wrote the behaviour sections at the top of `docs/cydia.md`. The UI string and section tables from R1 are
  unchanged below them.

## Findings that change the plan
- **F6**: Cydia's metadata.cb0 is keyed by package name only, not (repo, package, version).
  - `first` is set once.
  - `last` moves when the candidate version changes.
  - Changes groups by `first` unless the package is subscribed.
  - The oldest group is dropped.
  The doc gives a recommendation; F6 decides.
- **F4**: Cydia's add-source check only HEADs `Packages.bz2` and `Packages.gz`, so modern `.xz`/`.zst`-only repos
  would fail it. F4 should check more files.
- **F2/F4**: Cydia ignores http(s) `Icon:` URLs in lists, and section rows use `folder.png` with the count drawn
  inside, not section icons.

## Tried and failed
- `git clone https://git.saurik.com/cydia.git`: 503. `git://` worked.
- `git submodule update --init [--depth 1] apt32 apt64`: the pinned commit isn't on the server. I used apt-legacy
  HEAD instead and didn't fetch apt64.

## Not verified
- **The 4S's apt7 HTTP method.** Cydia 1.1.30 uses the device's apt7 0.7.25.3 methods, not the embedded ones. I
  read saurik's apt-legacy source, not the binary on the phone, so its exact headers and User-Agent string aren't
  confirmed. To confirm: point a source at a local HTTP server and log one refresh. That needs a task that may
  touch the 4S.
- **Compression order on the device.** It depends on `/etc/apt/apt.conf.d` (not pulled) and on whether
  `/usr/bin/lzma` exists. The doc gives apt's default.
- **Web-view User-Agent.** The doc builds it from code. The version numbers ("Version/6.0", "Safari/8536.25") are
  guesses.
- **Repos that need `X-Unique-ID`.** I didn't check which current repos need the UDID or `X-Machine`. Sending a
  real UDID from the site is ruled out. Whether the app sends one is for the user to decide.
- **`cydia://url/https://cydia.saurik.com/api/share#?source=…`.** It's the usual "Add to Cydia" link on repo
  sites, but it isn't in this source and I didn't test it.
- **No screenshots or on-device checks.** The task didn't need the screen, so I didn't take the ui-4s lock.
- **Line numbers** are for `837b7c8` and will drift for other versions.
