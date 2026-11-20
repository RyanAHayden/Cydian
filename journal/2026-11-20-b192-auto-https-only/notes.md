# B192: automatic installs only from https sources

## What auto.c restricted before

Nothing about the transport. The hourly daemon (`native/daemon/main.m` `apt()`) installs with
`--allow-unauthenticated` (N6: unsigned repos), and `auto_step` only filtered on: Install Updates Automatically
(off / marked / all), holds and ignored versions, charging+locked / network, `auto_safe_id`, B16's full-URL
`Filename:` links, dpkg busy, and a plan without `Remv`. An upgrade from an `http://` source installed without a tap:
anyone on the path could swap the .deb, and nothing checks a signature.

## What changed

- `auto.c`: `auto_list_prefix` (apt's `URItoFileName`: scheme and user:password dropped, `\|{}[]<>"^~_=!@#$%^&*`,
  control and non-ASCII bytes %-quoted lower-case, `/` -> `_`, ending in `_`), `auto_plain_http` (`http://` or a
  `<x>+http://` transport, case aside), and `auto_insecure`: reads `<prefix>/etc/apt` (`sources.list`,
  `sources.list.d/*.list` one-line style with `[options]`, and `*.sources` deb822 with `Types:`, `URIs:` incl.
  continuation lines, `Enabled: no`), maps each `lists/*_Packages` to the source with the longest matching prefix
  (a tie counts as http if any is: same host+path listed as both http and https), and flags each id=version an
  http list offers. apt's list file names drop the scheme, so the sources are the only place that knows it.
- `auto_step`: after B16's link filter, the chosen upgrades an http list offers are logged ("comes from an http
  source: automatic installs take https only, left for you") and dropped, not a failure (they stay in the count,
  like B16's). A dependency the install plan would pull from an http list makes the run wait for a person
  ("Update Failed"), as B16 does for a linked dependency.
- `struct auto_env` gets `apt_dir` (last field; NULL: not looked at). `main.m` sets it to `IFIZBOX_PREFIX
  "/etc/apt"`; `auto_driver.c` sets it to `<dir>/apt` when a test made one, and gains `insecure` and `prefix` commands.
- Changes (`web/app/screens/changes.js`): in the jailbreak app, with Install Updates Automatically on, an available
  upgrade the daemon would pick (Everything, or Only Packages I Mark and marked) whose source's uri is `http://`
  (core/sources.js `isInsecureSource`) shows "Not installed automatically: its source uses http, not https." in
  place of its description. Upgrade (N) still installs it (a tap is a person's decision). Reloads when autoInstall
  or autoMarked change.
- A per-row description, not a group footer: the Changes list is a virtual list (`nav/vlist.js`) of rows and
  headers with no footer item, and the rows can be any mix; the row text needed no change outside this task's files.
- README (native/daemon) gained an "https only" bullet.

## Tests

- `test_auto.py` `Insecure`: prefixes (ports, user:pw, `_`/`~` quoting, file:, tor+http, non-http schemes), the
  mapping (longest prefix wins, disabled source and deb-src ignored, http+https same list = http, plain
  `sources.list` read). `Runs`: an http source's upgrade is skipped while the https ones install, only-http installs
  nothing and is no failure, an http dependency waits for a person, all-https installs everything.
- `web/app/screens/changes-b192.test.js`: which ids get flagged per setting, and the row text.
- All 53 test_auto cases pass under ASan + UBSan; test_daemon/test_quiet pass (main.m compiles).

## Not verified

- On the iPhone 7: not run there (the task didn't ask for the phone, and other slots overwrite its .deb). So the
  real `/var/jb/etc/apt/sources.list.d` of a palera1n/Sileo/Zebra install mapping onto real list names is checked
  only against apt's `URItoFileName` as I know it, not against the phone's files.
- apt's quoting of non-ASCII bytes: apt formats a signed `char` there; sources with non-ASCII URIs may not match
  (then the list counts as not http). Rare enough to leave.
- The Changes row text drawn in the app: covered by the unit test of `itemsOf`, not looked at on screen.
