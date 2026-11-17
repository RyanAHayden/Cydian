# Cydia reference

Reference for how Cydia looks and behaves, from the iPhone 4S (iOS 6.1, Cydia 1.1.30) and Cydia's GPLv3 source.
The behaviour notes (R2) cover source fetching, sections, Changes, depictions, `cydia://` URLs and the install
queue. They only cover what F2, F4, F6 and N4 need. Device pulls live in `ref/4s/` (gitignored, made by
`tools/pull-4s.sh`).

## Where this comes from

- Cydia source: `git://git.saurik.com/cydia.git` (the `https://` URL returned 503 on 2026-11-17), HEAD `837b7c8`
  (May 2019, after v1.1.31). The 4S runs 1.1.30. I checked `git diff v1.1.30 HEAD` for the parts below (headers,
  add-source check, metadata, Changes, icons, `cydia://`, finish codes): none of them changed.
- Refresh HTTP: saurik's `apt-legacy` (submodule `apt32`, `9439ca0`), `methods/http.cc`. Cydia 1.1.30 calls the
  device's apt7 0.7.25.3 methods. apt7 is the same Telesphoreo code, but I didn't read the binary on the phone.
- Package page, Confirm sheet and console: web pages from `https://cydia.saurik.com/ui/ios~iphone/1.1/`, read from
  the 4S's `ApplicationCache.db` (`ref/4s/var/mobile/Library/Caches/com.saurik.Cydia/`). They are saurik's server
  pages, not part of the GPL repo. This doc describes what they do; don't copy their code.
- Line numbers below are `MobileCydia.mm` at `837b7c8`.

## Fetching a source (F2, F4)

### What a source is

- Cydia stores each source in the `CydiaSources` preference (`com.saurik.Cydia`) under the key
  `deb:<URI>:<Distribution>` (for example `deb:http://rpetri.ch/repo/:./`). The value is `{Type, URI,
  Distribution, Sections}`. `Sources.mm` `CydiaWriteSources()` writes them to `Caches/com.saurik.Cydia/sources.list`
  (symlinked as `/etc/apt/sources.list.d/cydia.list`) as `deb <URI> <dist>[ <sections…>]`.
- The first line is always Telesphoreo: `deb http://apt.saurik.com/ ios/<kCFCoreFoundationVersionNumber %.2f> main`
  (`ios/793.00` on the 4S).
- If a source has both an `http:` and an `https:` key, the `http:` one is skipped.
- The Add Source UI only adds flat sources (dist `./`, no components). Dist-style sources come from the defaults
  or from the web bridge `cydia.addSource(href, dist, sections)`.
- On first run (`CydiaVersion` 0) Cydia adds BigBoss (`http://apt.thebigboss.org/repofiles/cydia/ stable main`),
  ModMyi (`http://apt.modmyi.com/ stable main`) and ZodTTD (`http://cydia.zodttd.com/repo/cydia/ stable main`).
  Cydian's defaults are F4's list instead.
- At launch, Cydia drops keys that contain `#` or a space, and URIs that don't end in `/`.

### Add Source check (`SourcesController`, l.7856–7870, 7726–7808)

1. An alert titled `ENTER_APT_URL` takes the URL. `VerifySource()` requires `(http(s?)://|file:///)[^# ]*`. If it
   doesn't match: "Error: Invalid URL" / `INVALID_URL_EX`. A trailing `/` is added if missing.
2. Cydia sends two `HEAD` requests at the same time, each with a 10 s timeout: `<url>Packages.bz2` and
   `<url>Packages.gz`. Headers are `X-Machine` and `X-Unique-ID`, plus `X-Cydia-Id` (the UDID) on https. A HUD
   shows "Verifying URL".
3. If either request returns **200**, the URL is a repo. Cydia then GETs
   `https://cydia.saurik.com/api/repotag/<url without scheme, percent-escaped>`. A non-empty body is shown as a
   "Source Warning" alert with Cancel / Add Anyway. This is saurik's list of piracy repos.
4. If neither returns 200:
   - with a network error: "Verification Error" plus the error text;
   - otherwise: "Did not Find Repository" / `NOT_REPOSITORY_EX`.
5. On success Cydia saves the source as flat (`./`) and refreshes at once ("Updating Sources").

So Cydia rejects a flat repo that only serves `Packages`, `Packages.xz`, `Packages.lzma` or `Packages.zst`. It
also rejects any dists-style URL. For Cydian's add-source check (F4), try `Packages.bz2`, `.gz`, `.xz`, `.lzma`,
`.zst` and plain `Packages`, then `Release`. Modern repos often only have `.xz`/`.zst`. Keep Cydia's alert
wording.

### URLs fetched on refresh (apt `debReleaseIndex`)

- Base URL:
  - flat: `URI + dist`. With `./` this is literally `URI./`: the 4S cache has `7bubbl3s.github.io_._Packages`
    and `http://cydia.akemi.ai/./CydiaIcon.png`.
  - dist-style: `URI + "dists/" + dist + "/"`.
- Order: `<base>Release.gpg`, then `<base>Release`, then the index:
  - flat: `<base>Packages`;
  - dist-style: `<base><component>/binary-iphoneos-arm/Packages`.
- Index compression: apt tries the extensions in the order from `APT::Configuration::getCompressionTypes()`:
  - `Acquire::CompressionTypes::Order` if it's set;
  - otherwise the config tree order: `bz2`, `lzma` (only if `/usr/bin/lzma` exists), `gz`.
  When one fails (`pkgAcqIndex::Failed`), apt queues the next. When `Release` lists `Packages.diff/Index`, apt
  uses pdiffs: the 4S has `…Packages.IndexDiff` for BigBoss and Telesphoreo.
- Conditional GET:
  - there's a partial file: `Range: bytes=<size-1>-`, `If-Range: <mtime>`, `Cache-Control: no-cache`;
  - there's a local copy: `If-Modified-Since: <mtime of the local copy>`, `Cache-Control: no-cache`;
  - neither: `Cache-Control: max-age=0`.
  A 304 counts as a hit (`IMSHit`).
- After one failure for a host, the method fails the rest of that run's requests to the same host straight away
  ("Cached Failure").
- `+` in URLs is sent as `%2b`.
- Cydia keeps its lists in `Caches/com.saurik.Cydia/lists/`, stored uncompressed. `CacheState.plist` holds
  `LastUpdate`.
- Auto refresh at launch skips when any of these is true:
  - the last refresh was under 15 minutes ago;
  - Cydia already refreshed this launch;
  - `cydia.saurik.com` isn't reachable.
  `ManualRefresh` is 0 in release builds.
- Refresh button: the nav bar's left button reads Refresh, and Cancel while a refresh runs. Cydia cancels the
  refresh when the app resigns active (a call, or locking the phone).

### Request headers

| Request | Headers Cydia adds |
|---|---|
| apt fetches (`Release`, `Packages`, `.deb`) | `X-Firmware: <ProductVersion>` (e.g. `6.1.3`), `X-Machine: <hw.machine>` (e.g. `iPhone4,1`), `X-Unique-ID: <UDID>` (40 hex), `User-Agent: Telesphoreo APT-HTTP/1.0.592`, plus the conditional headers above |
| Add Source `HEAD` checks | `X-Machine`, `X-Unique-ID`; `X-Cydia-Id: <UDID>` only on https |
| `CydiaIcon.png` (Sources rows) | none; a plain `NSURLRequest` with a 10 s timeout |
| Web views (depictions, home, package page) | `X-Cydia-Cf: <CF version %.2f>`, `X-Machine`; `X-Cydia-Id: <UDID>` only on https *and* a bridged host (cydia.saurik.com) |

- Where the values come from:
  - `X-Firmware`: `/System/Library/CoreServices/SystemVersion.plist`;
  - `X-Unique-ID`: `MGCopyAnswer("UniqueDeviceID")`, or lockdown on older iOS;
  - `X-Machine`: `sysctl hw.machine`.
- Web-view User-Agent: WebKit's normal UA plus the application name from `CyteInitialize()`:
  `Version/<Safari product> Mobile/<kern.osversion build> Safari/<Safari bundle version> Cydia/<version> CyF/<CF>`.
  On the 4S that should be something like
  `… Version/6.0 Mobile/10B329 Safari/8536.25 Cydia/1.1.30 CyF/793.00`.
- For Cydian:
  - The proxy (F3) and the app's native fetch should send `X-Machine`, `X-Firmware` and the Telesphoreo
    `User-Agent`. Some repos serve different files or refuse requests without them.
  - **Never send a real UDID from the public site.** In the app, send `X-Unique-ID` only if a repo needs it (paid
    repos linked to a device). That's a decision for the user, so it's listed under Not verified in the journal.

### Release fields Cydia reads (`Source -setMetaIndex:`, l.1482)

| Field | Use |
|---|---|
| `Origin` | Source name. Fallback: the URL's host in lower case, or the path for `file:`. |
| `Label` | Package cells say "from <Label>" (`FROM`), plus "(Section)" when it differs. |
| `Description` | Source description on the package page. |
| `Depiction`, `Support` | Templates: `*` is replaced with the package id. Used when a package has no own field. |
| `Default-Icon` | Fallback package icon, **only** if it is a `file:///` URL. |
| `Version` | Read, not shown in lists. |

The Sources list sorts sources by name: names that start with a letter come before the others, then Cydia
compares without case or diacritics (`LaxCompareOptions_`).

## Sources tab (F4)

- Plain table with 53 pt rows and two sections:
  - Section 0 is a single "All Sources" row: `folder.png`, subtitle "combined package list for below sources".
  - Section 1, header "Individual Sources": one row per source, sorted by name.
- A source row has:
  - the icon: `unknown.png` first, then `<base>CydiaIcon.png` fetched in the background (base as above, so
    dist-style repos use `…/dists/<dist>/CydiaIcon.png`);
  - the name (Origin) and, underneath, the root URI;
  - a small grey spinner on the right while that source is fetching.
  Cydia shows **no package count**; F4's count is Cydian's own addition.
- Nav bar:
  - left: Refresh, or Cancel while updating, or Add in edit mode;
  - right: Edit / Done.
- Only sources Cydia added itself (they have a `CydiaSources` record) can be deleted. Sources from other `.list`
  files can't, such as `saurik.list` and Telesphoreo. A delete rewrites the list and refreshes at once.
- Tapping a source opens its Sections list (`cydia://sources/<key>`). "All Sources" opens the Sections list for
  every source.

## Sections and section icons (F2, F4)

- Section name:
  - Start from the package's `Section` and turn `_` into a space.
  - Map it through `Cydia.app/Sections.plist`: 42 typo and alias fixes, e.g. `Utility`→`Utilities`,
    `Developer`→`Development`, `Themes (Lockscreen)`→`Themes (LockScreen)`.
  - Localise it with `Sections.strings` (the "Section names" table below). `Parent (Child)` is localised one part
    at a time with `PARENTHETICAL`.
- "Simple" section (`Simplify()`), used for icons and the "from" line: `[X]` becomes `X`, `(X)` becomes `X`, and
  `Name (Sub)` becomes `Name`. So `Themes (SpringBoard)` becomes `Themes`.
- Sections list (`SectionsController`, 46 pt rows):
  - row 0 is "All Packages";
  - then one row for each section that has at least one visible package, sorted by localised name;
  - packages without a section go under "(No Section)".
- Section rows **don't** use the section icons:
  - Each row draws `folder.png` at 32×32, at (7,7).
  - The package count sits inside the folder, 12 pt bold, in the `Folder_` colour.
  - The name is 18 pt, at x 48.
- Edit mode:
  - The title becomes "Section Visibility" and every row gets a switch.
  - Turning a switch off sets `Hidden` for that section in `CydiaSections`.
  - Packages in hidden sections drop out of every list, Changes included (`-visible`).
- Section icons: `Cydia.app/Sections/<simple section, spaces → _>.png`. The 4S has 68, including repo-specific
  ones like `HYI_-_Tweaks.png`.
- Package icon fallback (`Package -icon`, l.2863):
  1. `Icon:` if it is `file:///`;
  2. the section icon;
  3. the source's `Default-Icon` if it is `file:///`;
  4. `unknown.png`.
- Remote `Icon:` URLs are **ignored** in Cydia's lists. The package page swaps in an icon from saurik's API.
  Cydian can show http(s) icons (F2 resolves them), but should keep the fallback chain behind them.
- Purpose badges: the tag `purpose::<x>` puts `Purposes/<x>.png` on the cell. The 4S has commercial, console,
  daemon, extension, library, uikit and x.
- Hidden from every list:
  - packages tagged `cydia::obsolete`;
  - packages whose `role::` tag isn't `enduser`, `hacker` or `developer` (for example `role::cydia`).

## Changes and metadata.cb0 (F6)

`/var/mobile/Library/Cydia/metadata.cb0` is a memory-mapped hash table (`Cytore.hpp`, structs at l.1237).

- Records are keyed by **lower-cased package name only**: not by repo, not by version. The 65536 buckets come
  from a `hashlittle` of the name.
- Each record (`PackageValue`) holds:
  - `first_`: int32 Unix time when the package was first seen;
  - `last_`: when its candidate version last changed;
  - `version_`: the last 8 characters of the candidate version string;
  - `vhash_`: a 16-bit hash of the full version string;
  - `subscribed_`: the "Show All Changes" switch in Package Settings;
  - `index_`.

Update rule (`Package -initWithVersion:`, l.2515):

- It runs on every **database reload**, not on every network refresh.
- `now_` is set once at the start of each reload (l.3733), so every package touched in one reload gets the same
  timestamp.

```
if first == 0:                                   first = now
if vhash != hash(candidate) or version != last8: version, vhash = candidate; last = now
elif last == 0:                                  last = first
seen = subscribed ? last : first
```

How the Changes tab is built (`ChangesController`, l.6791):

- Filter: the package is upgradable or visible.
  - Upgradable means installed with candidate ≠ installed version.
  - A package that isn't installed also counts as upgradable if it's tagged `cydia::essential`.
- Sort (`PackageChangesRadix`): upgrades first (not-ignored before ignored), then by `seen`, newest first. The sort
  key is `seen >> 2`, so seen times only count to 4-second steps.
- Sections:
  1. **Available Upgrades**, if there are any. The right nav button then reads "Upgrade (N)" and runs a
     dist-upgrade.
  2. **Ignored Upgrades**: packages on hold.
  3. **New at <date>**: a new section starts whenever `seen` changes. The date uses the medium date style plus the
     medium time style in the user's locale, e.g. "New at Sep 10, 2023 12:36:22 PM".
- **The oldest "New at" section is dropped**. It's everything from the first load, so a fresh install doesn't list
  the whole archive.
- An update to a package that isn't installed doesn't move it unless the user turned on "Show All Changes" for it.
  `SHOW_ALL_CHANGES_EX` says so. Installed packages show under Available Upgrades instead.
- A newly added repo's packages show up together under "New at <time of that reload>".
- Cydia doesn't mark rows "new" or "updated".
- Refresh: the Changes tab has the same Refresh/Cancel left button as the Sources tab.

For F6:

- Keep Cydia's model: per package id, `{first, last, version}`, with `now` stamped once per refresh, and drop the
  oldest group.
- The brief's per-(repo, package, version) record is a superset of Cydia's model. If F6 keeps it, take
  `first`/`last` as the minimum over repos, so a package mirrored on two repos isn't "new" twice.
- "Updated" can mean `last > first` with a version change. That's Cydian's addition.
- The F6 test (a bumped version files under today, and a repeat refresh doesn't) matches the version rule above.

## Package page and depictions

The package page is a web page: `https://cydia.saurik.com/ui/ios~iphone/1.1/#!/package/<id>` (`ios~ipad` on
iPad). It reads the package through the `window.cydia` bridge (`getPackageById`). What the cached 4S copy does, top
to bottom:

- **Header**:
  - the 64×64 icon from `cydia://package-icon/<id>`, cross-faded to saurik's API icon if there is one;
  - the name in 17 px bold, ellipsised;
  - the latest version in `#358`;
  - the size as "N kB", bottom right, 12 px.
- **Queue**: a "Package Queue" row with the mode (Install, Remove, …) and `Modes/<mode>.png`. It only shows when
  the package is queued.
- **Action rows**:
  - Change Package Settings → `cydia://package/<id>/settings`;
  - Author: `Author:`, else `Maintainer:` labelled "Contact", else "Package Support". It opens the support page.
  - "This is a console package!" when the package is tagged `purpose::console`;
  - warnings on a red (`#fdd`) background.
- **Depiction**: the package's `Depiction:`, or else the source's `Release` `Depiction:` with `*` replaced by the
  id (`Package -depiction`, l.2884). Only `http://` or `https://` URLs count; anything else is ignored.
  - If there's a depiction, it loads in a full-width iframe that grows to fit. The Description block and "More
    Information" are removed.
  - If not, the page shows the long description, falling back to the short one, with newlines turned into
    `<br>`. "More Information" links to `Homepage:`.
- **Commercial**: packages tagged `cydia::commercial` get an extra iframe,
  `https://cydia.saurik.com/api/commercial?package=<id>`. Any package can get a notice iframe from
  `api/package/<id>`.
- **Installed Details**: Version, and Filesystem Content (`cydia://package/<id>/files`).
- **Source Details**: the source icon (`<base>CydiaIcon.png`), name and description.
- **Footer**: the id, then "<source name> · <section>".
- **Nav button** (`CYPackageController -reloadData`, l.5890): one action shows its own title. Two or more show
  "Modify", which opens an action sheet. The actions, in order:
  1. Clear, if the package is queued;
  2. Upgrade, Install or Reinstall, only if the package has a source;
  3. Remove, if it's installed;
  4. Downgrade, if other versions exist. It opens a sheet listing those versions.
- Depiction web views get `X-Cydia-Cf` and `X-Machine`. Cydia injects the `cydia` JS object only on `file:` pages
  and https pages from bridged hosts. Links with `target="_popup"` open in a modal browser.
- For Cydian: show depictions in a sandboxed iframe (site and app) with no bridge. Sileo's native JSON depictions
  (`SileoDepiction:`) aren't part of Cydia; any support for them is separate work.

## `cydia://` URLs (F4, N4)

Cydia uses the `cydia` scheme two ways.

**Navigation.** Other apps open these, and so do links inside pages. `-pageForURL:forExternal:` (l.8725) splits
`cydia://<base>/<args>` on `/`:

| URL | Opens | From another app |
|---|---|---|
| `cydia://url/<absolute URL>` | browser page for that URL (slashes allowed) | yes |
| `cydia://package/<id>` | package page | yes |
| `cydia://sources/add` | Sources tab with the Add Source prompt open | yes |
| `cydia://sources/<key>` | Sections list of source `deb:<URI>:<dist>` (percent-escaped) | yes |
| `cydia://home`, `sources`, `sections`, `search`, `changes`, `installed` | that tab or page | no |
| `cydia://search/<query>` | search results | no |
| `cydia://sections/<section>` (`all` or `*` = all) | package list for that section | no |
| `cydia://sections/<source key or *>/<section or *>` | the same, filtered by source | no |
| `cydia://package/<id>/settings`, `…/files` | Package Settings, file list | no |
| `cydia://launch/<bundle id>` | launches that app | no |
| `apptapp://package/<id>` | package page (old Installer.app scheme) | yes |

Each tab's navigation stack is saved as these URLs (`SavedState.plist`) and restored at the next launch.

**Resources** inside web views (`CydiaURLProtocol`, l.6427). Each returns a PNG:

- `cydia://package-icon/<id>`;
- `cydia://section-icon/<section>` (falls back to `unknown.png`);
- `cydia://application-icon/<bundle id>`;
- `cydia://uikit-image/<name>`.

For Cydian: the site uses hash routes with the same shape, `#/package/<id>`, `#/sources/add`, and so on. The app
can register its own scheme with these paths. It can't take over `cydia://` while Cydia or Sileo is installed.
Repo websites' "Add to Cydia" buttons are usually `cydia://url/https://cydia.saurik.com/api/share#?source=<repo
URL>`. That isn't in this source, so the app should read the `source=` parameter of such a link if it receives
one.

## Install queue (N4)

### Queuing

- Install, Upgrade, Reinstall, Remove or Clear on a package page marks the package in apt's depcache. Then Cydia:
  1. runs the resolver (`InstallProtect`, then `Resolve(true)`; errors are discarded);
  2. cancels any refresh that's running;
  3. runs `prepare` (archive lock, `GetArchives`);
  4. presents the Confirm sheet modally.
  "Upgrade (N)" on the Changes tab does the same with a dist-upgrade.
- **Continue Queuing**:
  - Cydia keeps the marks, closes the sheet and sets `Queuing_`.
  - The Manage tab badge reads "Q'd" (`Q_D`).
  - The Installed list gets a "Queue" button (Done style) that re-opens Confirm.
  - Marking more packages adds to the same queue.

### Confirm sheet (`ConfirmationController`, l.4645; page `#!/confirm/`)

- Modal navigation controller titled "Confirm", or "Cannot Comply" when there are issues.
- Left button "Cancel" clears the whole queue. Right button "Confirm" (Done style) only shows when there are no
  issues and the page has loaded.
- Cydia hands the page `cydiaConfirm = {changes, issues, sizes, queue}`:
  - `changes`: `installs`, `reinstalls`, `upgrades`, `downgrades`, `removes` (arrays of ids);
  - `sizes`: `downloading` (`FetchNeeded`) and `resuming` (`PartialPresent`).
- **Statistics** group: "Downloading <size>" and "Resuming At <size>". A row is hidden when its size is "0.0 B",
  and the group is hidden when both are. Sizes use 1024 steps with one decimal: B, kB, MB, GB.
- **Modifications** group: one row per non-empty list, in the order Install, Reinstall, Upgrade, Downgrade,
  Remove. Each row's detail lists the package display names, one per line.
- **Issues**, for packages left broken after the resolver:
  - a "Note:" line (in red) with `CANNOT_COMPLY_EX`, and a "Continue Queuing" button;
  - per package, a label (`#704d4d`) and a pink (`#ffcccc`) group;
  - each group row shows the relationship (PreDepends shown as Depends) and the target as `name op version`.
  - Removing `firmware`, `gsc.*` or `cy+*` also counts as an issue (shown as Conflicts).
- Essential packages being removed:
  - normally: an "Unable to Comply" alert;
  - in Advanced mode: a "Removing Essentials" alert with "Cancel Operation (Safe)" and "Force Removal (Unsafe)".
- Cydian runs `apt-get -s` in the root helper to get the same five lists, plus the broken-dependency reasons.

### Running: the console (`ProgressController`, l.5057; page `#!/progress/`)

- The page:
  - Title "Running", then "Complete" when it ends.
  - Black page and black nav bar, no back button.
  - "Cancel" on the left while the step can be cancelled (downloads).
  - "Close" on the right once it has finished.
- Output comes in as events, each `{type, message}`:
  - **Information**: every stdout/stderr line from dpkg and the maintainer scripts, in grey `#a9a9a9`. Only the
    text after the last `\r` is shown, so progress-bar lines collapse to one.
  - **Status**: white bold. Comes from the apt status fd:
    - `pmstatus:<pkg>:<percent>:<text>`;
    - `status: <pkg>: <state>`;
    - `processing: <action>: <pkg>`.
    The last Status line also shows, centred, above the progress bar, with package ids replaced by names.
  - **Error**: red, with a 12 px critical icon. Comes from `pmerror:<pkg>:<percent>:<text>` and from failed
    downloads.
  - **Warning**: yellow, with a warning icon.
- `<percent>` sets the progress bar.
- `pmconffile:` lines and `status: … : conffile-prompt : '<old>' '<new>' 0 1` lines open a "Configuration
  Upgrade" alert: `CONFIGURATION_UPGRADE_EX`, then the file path. The buttons are "Keep My Old Copy" (writes `N\n`
  to dpkg's stdin) and "Accept The New Copy" (writes `Y\n`).
- Layout:
  - Output text is 12 px, with margins of 20/9/100/9 px. The page scrolls to the bottom on every update.
  - While running, the bottom shows the status text and a progress bar 158 px wide: 1 px white border, 6 px
    radius, a 4 px `#eee` fill, at most 150 px.
  - When it ends, a 300 px wide button replaces the bar: 1 px white border, 9 px radius, 22 px bold, 12 px padding.
    It shows the finish label.
- The finish label is the **highest** finish level reached:

| Level | Label | Set by |
|---|---|---|
| 0 return | Return to Cydia | default |
| 1 reopen | Close Cydia | a script |
| 2 restart | Restart SpringBoard | a script, or a queued package (old or new version) depends on `mobilesubstrate` |
| 3 reload | Reload SpringBoard | a script, or `/System/Library/LaunchDaemons/com.apple.SpringBoard.plist` changed |
| 4 reboot | Reboot Device | a script, or `/etc/notify.conf` changed |

  - Scripts set it by writing `finish:<word>` to the fd named in the environment variable `CYDIA="<fd> 1"`, for
    example `echo finish:restart >&${CYDIA%% *}`.
  - The button runs the action. Restart and Reload show a "Loading" HUD and restart SpringBoard.
  - After any run, Cydia reloads its data and runs `uicache`.
- For Cydian (N4):
  - The root helper should export `CYDIA="<fd> 1"` and read `finish:` lines from it, so existing
    `postinst`/`extrainst_` scripts keep working.
  - It should run apt with `-o APT::Status-Fd=<fd>`, and dpkg's `--status-fd`, to get the
    `pmstatus`/`pmerror`/`pmconffile` lines.
  - Stream all three over the bridge as these event types.
  - Labels: "Return to Cydian", "Restart SpringBoard" (on rootless: `sbreload`/`killall backboardd`), "Reboot
    Device".

## UI strings

From `Cydia.app/en.lproj/Localizable.strings` (Cydia is GPLv3). Reuse the wording, but drop or rename anything
that says "Cydia" (see AGENTS.md). 220 strings.

| Key | English |
|---|---|
| `ABOUT` | About |
| `ABOUT_CYDIA` | About Cydia Installer |
| `ACCEPT_NEW_COPY` | Accept The New Copy |
| `ADD` | Add |
| `ADD_ANYWAY` | Add Anyway |
| `ADD_SOURCE` | Add Source |
| `ADMINISTRATIVE_INFORMATION` | Administrative Information |
| `ADVANCED_SEARCH` | Advanced Search |
| `ALL_PACKAGES` | All Packages |
| `ALL_SOURCES` | All Sources |
| `ALL_SOURCES_EX` | combined package list for below sources |
| `APPLE` | Apple |
| `AUTHOR` | Author |
| `AVAILABLE_UPGRADES` | Available Upgrades |
| `BROWSER` | Browser |
| `BY` | by %@ |
| `CANCEL` | Cancel |
| `CANCEL_CLEAR` | Cancel and Clear |
| `CANCEL_OPERATION` | Cancel Operation |
| `CANNOT_COMPLY` | Cannot Comply |
| `CANNOT_COMPLY_EX` | The requested modifications cannot be applied due to required dependencies or conflicts that cannot be automatically found or fixed. |
| `CANNOT_LOCATE_PACKAGE` | Cannot Locate Package |
| `CHANGES` | Changes |
| `CHANGE_PACKAGE_SETTINGS` | Change Package Settings |
| `CLEAN_ARCHIVES` | Clean Archives |
| `CLEAR` | Clear |
| `CLOSE` | Close |
| `CLOSE_CYDIA` | Close Cydia |
| `COLON_DELIMITED` | %@: %@ |
| `COMING_SOON` | Coming Soon! |
| `COMMA_DELIMITED` | %@, %@ |
| `COMMERCIAL_APPLICATIONS` | Commercial Applications |
| `COMPLETE` | Complete |
| `COMPLETE_UPGRADE` | Complete Upgrade |
| `CONFIGURATION_UPGRADE` | Configuration Upgrade |
| `CONFIGURATION_UPGRADE_EX` | The following file has been changed by both the package maintainer and by you (or for you by a script). |
| `CONFIRM` | Confirm |
| `CONSOLE_PACKAGE` | This is a console package! |
| `CONSOLE_UTILITIES_DAEMONS` | Console Utilities & Daemons |
| `CONTINUE_QUEUING` | Continue Queuing |
| `COUNTS_NONZERO_EX` | So, I just counted some important-looking values, and they didn't sum to zero. This is scary. I don't know why I don't like this anymore, but I think APT was adamant this should not occur. |
| `CREDITS` | Credits |
| `CYDIA_STORE` | Cydia Store |
| `DATABASE` | Database |
| `DETAILS` | Details |
| `DEVELOPER` | Developer |
| `DEVELOPERS_ONLY` | Developers Only |
| `DEVELOPER_EX` | Everything, even scary internal stuff. |
| `DISK_FREEING` | Disk Freeing |
| `DISK_USING` | Disk Using |
| `DONATE_USING` | Donate using %@ |
| `DONE` | Done |
| `DOUBLE_QUOTED` | “%@” |
| `DOWNGRADE` | Downgrade |
| `DOWNLOADING` | Downloading |
| `DOWNLOADING_` | Downloading %@ |
| `EDIT` | Edit |
| `ELISION` | %@... |
| `ENTERED_BY_USER` | Entered by User |
| `ENTER_APT_URL` | Enter Cydia/APT URL |
| `ERROR` | Error |
| `ESSENTIAL_UPGRADE` | Essential Upgrade |
| `ESSENTIAL_UPGRADES` | %d Essential Upgrades |
| `ESSENTIAL_UPGRADE_EX` | One or more essential packages are currently out of date. If these upgrades are not performed you are likely to encounter errors. |
| `EXCLAMATION` | %@! |
| `EXIT_WHEN_COMPLETE` | (Cydia will exit when complete.) |
| `EXPANDED_SIZE` | Expanded Size |
| `EXPERT` | Expert |
| `FAQ` | FAQ |
| `FEATURED_PACKAGES` | Featured Packages |
| `FILES` | Files |
| `FILESYSTEM_CONTENT` | Filesystem Content |
| `FILES_INSTALLED_TO` | files installed to %@ |
| `FOLLOW_ON_TWITTER` | Follow %@ on Twitter |
| `FORCE_REMOVAL` | Force Removal |
| `FORCIBLY_CLEAR` | Forcibly Clear |
| `FREE_APPLICATIONS` | Free Applications |
| `FREE_EXTENSIONS` | Free Extensions |
| `FREQUENTLY_ASKED_QUESTIONS` | Frequently Asked Questions |
| `FROM` | from %@ |
| `FROWNY_PANTS` | Frowny Pants |
| `FUTURE_FEATURE_ROADMAP` | Future Feature Roadmap |
| `HACKER` | Hacker |
| `HACKER_EX` | Adds Command Line tools. |
| `HALFINSTALLED_PACKAGE` | Half-Installed Package |
| `HALFINSTALLED_PACKAGES` | %d Half-Installed Packages |
| `HALFINSTALLED_PACKAGE_EX` | When the shell scripts associated with packages fail, they are left in a bad state known as either half-configured or half-installed. These errors don't go away and instead continue to cause issues. These scripts can be deleted and the packages forcibly removed. |
| `HOME` | Home |
| `ID` | ID |
| `IGNORED_UPGRADES` | Ignored Upgrades |
| `IGNORE_UPGRADES` | Ignore Upgrades |
| `IGNORE_UPGRADES_EX` | Do not include this package when selecting Upgrade All. |
| `ILLEGAL_PACKAGE_IDENTIFIER` | Illegal Package Identifier |
| `INDIVIDUAL_SOURCES` | Individual Sources |
| `INSTALL` | Install |
| `INSTALLED` | Installed |
| `INSTALLED_BY_PACKAGE` | Installed by Package |
| `INSTALLED_DETAILS` | Installed Package |
| `INSTALLED_FILES` | Installed Files |
| `INVALID_URL` | Invalid URL |
| `INVALID_URL_EX` | That is not a valid source URL. Please check it and try again. |
| `KEEP_OLD_COPY` | Keep My Old Copy |
| `LOADING` | Loading |
| `LOADING_DATA` | Loading Data |
| `LOCAL` | Local |
| `LOGIN` | Login |
| `MAILING_LISTS` | Mailing Lists |
| `MAINTAINER` | Contact |
| `MANAGE` | Manage |
| `MODIFICATIONS` | Modifications |
| `MODIFY` | Modify |
| `MORE_INFORMATION` | More Information |
| `MORE_PACKAGE_SOURCES` | More Package Sources |
| `NAME` | Name |
| `NETWORK_ERROR` | Network Error |
| `NEVER_OR_UNKNOWN` | Never or Unknown |
| `NEW` | New |
| `NEW_AT` | New at %@ |
| `NEW_INSTALL` | New Install |
| `NO` | No |
| `NOTE` | Note |
| `NOT_RATED` | Not Rated |
| `NOT_REPOSITORY` | Did not Find Repository |
| `NOT_REPOSITORY_EX` | The indicated repository could not be found. This could be because you are trying to add a legacy Installer repository (these are not supported). Also, this interface is only capable of working with exact repository URLs. |
| `NO_SECTION` | (No Section) |
| `OK` | OK |
| `OKAY` | Okay |
| `PACKAGES` | Packages |
| `PACKAGES_EX` | View or remove packages you previously installed. |
| `PACKAGE_CANNOT_BE_FOUND` | The package %@ cannot be found in your current sources. I might recommend installing more sources. |
| `PACKAGE_CANNOT_BE_FOUND_EX` | This issue may also be caused by a number of other factors. The most common one is that your package catalog is out of date. To manually refresh, click the Refresh button on the Changes tab. This package may simply no longer exist. It is also possible you are using an old firmware version: users should attempt to remain reasonably up to date with Apple's firmware releases. |
| `PACKAGE_DAMAGED` | Package Damaged |
| `PACKAGE_DETAILS` | Package Details |
| `PACKAGE_QUEUE` | Package Queue |
| `PARENTHETICAL` | %@ (%@) |
| `PASSWORD` | password |
| `PERFORM_SELECTIONS` | Perform Selections |
| `PREPARE_ARCHIVES` | Prepare Archives |
| `PREPARING_FILESYSTEM` | Preparing Filesystem |
| `PRODUCTS` | Products |
| `PURGE` | Purge |
| `QUESTION` | %@? |
| `QUEUE` | Queue |
| `QUEUED_FOR` | Queued for %@ |
| `Q_D` | Q'd |
| `REBOOT_DEVICE` | Reboot Device |
| `RECENT` | Recent |
| `RECENT_CHANGES_UPDATES` | Recent Changes/Updates |
| `RECOMMENDED_BOOKS` | Recommended Books |
| `REFRESH` | Refresh |
| `REFRESHING_DATA` | Refreshing Data |
| `REINSTALL` | Reinstall |
| `RELOAD` | Reload |
| `RELOADING_DATA` | Reloading Data |
| `RELOAD_SPRINGBOARD` | Reload SpringBoard |
| `REMOVE` | Remove |
| `REMOVING_ESSENTIALS` | Removing Essentials |
| `REMOVING_ESSENTIALS_EX` | This operation involves the removal of one or more packages that are required for the continued operation of either Cydia or iOS. If you continue, you may not be able to use Cydia to repair any damage. |
| `REPAIRING` | Repairing |
| `REPOSITORY_SIGNATURE` | View Repository Signature |
| `REQUEST_ADVERTISING_SPACE` | Request Advertising Space |
| `REQUIREMENTS_FOR_LISTING` | Requirements for Listing |
| `RESTART_SPRINGBOARD` | Restart SpringBoard |
| `RESUBMIT_FORM` | Are you sure you want to submit this form again? |
| `RESUMING_AT` | Resuming At |
| `RETURN_TO_CYDIA` | Return to Cydia |
| `ROLE_EX` | Not all of the packages available via Cydia are designed to be used by all users. Please categorize yourself so that Cydia can apply helpful filters.\n\nThis choice can be changed from "Settings" under the "Manage" tab (on iPhone or iPod touch), or the "Sources" tab (on iPad). |
| `RUNNING` | Running |
| `SAFE` | Safe |
| `SAMPLE` | Sample |
| `SCREENSHOT` | Screenshot |
| `SCREENSHOTS` | Screenshots |
| `SEARCH` | Search |
| `SEARCH_EX` | Package Names & Descriptions |
| `SECTION` | Section |
| `SECTIONS` | Sections |
| `SECTION_VISIBILITY` | Section Visibility |
| `SEE_WHAT_CHANGED` | See What Changed |
| `SETTINGS` | Settings |
| `SHOW_ALL_CHANGES` | Show All Changes |
| `SHOW_ALL_CHANGES_EX` | Changes only shows upgrades to installed packages so as to minimize spam from packagers. Activate this to see upgrades to this package even when it is not installed. |
| `SIGNED_PACKAGE` | This package has been signed. |
| `SIMPLE` | Simple |
| `SINGLE_QUOTED` | ‘%@’ |
| `SLASH_DELIMITED` | %@ / %@ |
| `SOURCES` | Sources |
| `SOURCES_EX` | List current sources and add custom ones you may know. |
| `SOURCE_DETAILS` | Source Information |
| `SOURCE_WARNING` | Source Warning |
| `SPONSOR` | Sponsor |
| `SPONSORING_PRODUCTS` | Sponsoring Products |
| `STATISTICS` | Statistics |
| `STILL_BROKEN_EX` | Trying to fix the broken selections did not seem to help. |
| `STORAGE` | Storage |
| `STORAGE_EX` | See how much room you have left for new packages. |
| `SUBMIT` | Submit |
| `SUPPORT_KNOWN_ISSUES` | Support & Known Issues |
| `TEMPORARY_IGNORE` | Ignore (Temporary) |
| `THANK_YOU` | Thank You |
| `UNABLE_TO_COMPLY` | Unable to Comply |
| `UNABLE_TO_COMPLY_EX` | This operation requires the removal of one or more packages that are required for the continued operation of either Cydia or iOS. In order to continue and force this operation you will need to be activate the Advanced under Settings. |
| `UNABLE_TO_LOAD` | Unable to Load |
| `UNKNOWN` | Unknown |
| `UNSAFE` | Unsafe |
| `UPDATING_DATABASE` | Updating Database |
| `UPDATING_SOURCES` | Updating Sources |
| `UPGRADE` | Upgrade |
| `UPGRADE_ESSENTIAL` | Upgrade Essential |
| `UPGRADING_TO_READ_THIS` | Upgrading to %@? Read This |
| `USER` | User |
| `USERNAME` | username |
| `USER_EX` | Apps, Tweaks, and Themes. |
| `USER_GUIDES` | User Guides |
| `VERIFICATION_ERROR` | Verification Error |
| `VERIFYING_URL` | Verifying URL |
| `VERSION` | Version |
| `WARNING` | Warning |
| `WELCOME_TO_CYDIA` | Welcome to Cydia™ |
| `WHO_ARE_YOU` | Who Are You? |
| `YES` | Yes |

## Section names

From `Cydia.app/en.lproj/Sections_.strings`, the English display names for package `Section:` values (51).
F5 groups packages under these.

| Key | English |
|---|---|
| `Addons` | Addons |
| `Administration` | Administration |
| `App Addons` | App Addons |
| `Archiving` | Archiving |
| `Battery` | Battery |
| `Carrier Bundles` | Carrier Bundles |
| `Carriers` | Carriers |
| `Complete` | Complete |
| `Data Storage` | Data Storage |
| `Development` | Development |
| `Dialer` | Dialer |
| `Dictionaries` | Dictionaries |
| `Dock` | Dock |
| `Education` | Education |
| `Emulation` | Emulation |
| `Entertainment` | Entertainment |
| `Fonts` | Fonts |
| `Games` | Games |
| `Icy` | Icy |
| `Java` | Java |
| `Keyboards` | Keyboards |
| `Localization` | Localization |
| `LockScreen` | LockScreen |
| `Messaging` | Messaging |
| `Multimedia` | Multimedia |
| `Navigation` | Navigation |
| `Networking` | Networking |
| `Notifications` | Notifications |
| `Packaging` | Packaging |
| `Productivity` | Productivity |
| `Repositories` | Repositories |
| `Ringtones` | Ringtones |
| `SMS` | SMS |
| `Scripting` | Scripting |
| `Security` | Security |
| `Site-Specific Apps` | Site-Specific Apps |
| `Sliders` | Sliders |
| `Social` | Social |
| `Soundboards` | Soundboards |
| `System` | System |
| `Terminal Support` | Terminal Support |
| `Text Editors` | Text Editors |
| `Themes` | Themes |
| `Toys` | Toys |
| `Tweaks` | Tweaks |
| `Utilities` | Utilities |
| `Wallpaper` | Wallpaper |
| `Weather` | Weather |
| `WebClips` | WebClips |
| `Widgets` | Widgets |
| `eBooks` | eBooks |
