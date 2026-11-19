# R28: Downgrade and Version History list older iFizBox builds (iPhone 7)

## Precondition check (first run, 2026-11-19 morning)

The first run found no release after B73 (newest tag v0.9.8, older than the B73 merge). The live
`https://ifizbox.com/repo/Packages` had one stanza with a bare Filename, so the task was blocked until the next
release. 0.9.9 has since been released with `tools/release.sh`.

## Live source (desktop)

`https://ifizbox.com/repo/Packages` now has six `com.ryha.ifizbox` stanzas: 0.9.9-1676, 0.9.8-1557, 0.9.7-1337,
0.9.6-1301, 0.9.5-1278 and 0.9.4-1201. Each has `Filename: v<X.Y.Z>/com.ryha.ifizbox_<ver>_iphoneos-arm64.deb`.
`curl` of `/repo/v0.9.8/...` and `/repo/v0.9.4/...` gave 200 with no redirect, and the SHA256 of each matched its
stanza.

## iPhone 7 (iFizBox 0.9.8-1623 installed at the start, a dev build from another slot)

- The app's cached source was from before the release: the package page showed 0.9.8-1557 and "Version History:
  1 version". After Sources > Refresh ("25 refreshed, 1 failed"; I didn't check which source failed), the page showed
  0.9.9-1676 and **6 versions**.
- **Version History** listed 0.9.9-1676 (Latest), 0.9.8-1623 (Installed, "No source offers it any more"),
  0.9.8-1557, 0.9.7-1337, 0.9.6-1301, 0.9.5-1278 and 0.9.4-1201. Correct.
- **Modify** sheet: Upgrade, Ignore Upgrades, Remove, Downgrade. **Downgrade** listed the five older builds,
  0.9.8-1557 down to 0.9.4-1201. Correct.
- I tapped 0.9.8-1557, and Confirm showed one modification, "Downgrade iFizBox". After Confirm the app closed within
  4 s, and `dpkg-query` showed 0.9.8-1557.
  - I picked the build closest to the installed one, to change the shared phone as little as possible. It still has
    to come from `/repo/v0.9.8/`.
- **Where the .deb came from:** the app downloads the .deb itself and gives apt the local file. apt history shows
  `apt-get ... install /var/tmp/ifizbox-deb.XXXX/deb.deb`, not an apt fetch.
  - The copy in `/var/jb/var/cache/apt/archives/` has SHA256 `c8c10eb4…5d82`, equal to the v0.9.8 stanza.
  - Only the `Filename: v0.9.8/...` stanza offers that version. A bare Filename would have resolved to the latest
    asset (0.9.9), whose hash differs. So the download came through the Worker's `/repo/v0.9.8/` route.
- apt fetching from the tagged route itself: to put the phone back I ran apt with a throwaway sources list naming
  only `https://ifizbox.com/repo/` (`[trusted=yes]`, `SourceParts=/dev/null`). `apt-cache policy` showed all six
  versions, and `apt-get install com.ryha.ifizbox=0.9.9-1676` printed
  `Get:1 https://ifizbox.com/repo ./ com.ryha.ifizbox 0.9.9-1676` and installed it.

## Bug found: in-app self-install leaves dpkg half-configured (filed as B84)

After the in-app downgrade, `dpkg -s com.ryha.ifizbox` showed `install ok half-configured`, and the next apt-get
refused with "dpkg was interrupted, you must manually run 'sudo dpkg --configure -a'". apt's term.log for that run
has a "Log started" line and no "Log ended".

Likely cause: the helper's apt is a child of the app (spawn.c, persona spawn). The postinst begins with
`uicache -p .../iFizBox.app`, iOS then closes the running app, and apt, dpkg and the postinst die with it. On main the
postinst is the same, so an in-app upgrade of iFizBox (banner or Changes) very likely does the same. Not tested: it
would break the phone's dpkg again.

Repair on the phone: `sudo -n dpkg --configure -a` ("Setting up com.ryha.ifizbox (0.9.8-1557)"). Then apt took it to
0.9.9-1676, and it now shows `install ok installed`. The upgrades daemon was still loaded throughout.

## Phone state left behind

- iFizBox 0.9.9-1676 (the current release), installed by apt from ifizbox.com, `install ok installed`.
- The 0.9.8-1623 dev build it had before is gone: its .deb wasn't on the phone any more. Other slots install their
  own builds anyway.
- `/tmp/r28.list` removed. `/var/jb/var/lib/apt/lists` now has fresh ifizbox.com lists, which is harmless.
- ui-7.sh lock released.

## Failed attempts

- `apt-get update` with an unmarked `deb https://ifizbox.com/repo/ ./` failed with "Release is not signed". Adding
  `[trusted=yes]` fixed it.
- The first restore try stopped at "dpkg was interrupted", which is how I found the bug above.

## Not verified

- **An in-app *upgrade* of iFizBox** (banner Upgrade or Changes) hitting the same half-configured state. I inferred
  it from the code path and the same postinst. I didn't run it because it would break the shared phone's dpkg again.
  B84 asks for the check.
- **Which source failed** in "25 refreshed, 1 failed": not looked at. The iFizBox source did refresh (0.9.9 and
  6 versions showed up).
- **Downgrading to the oldest builds (0.9.4–0.9.7) in the app:** not done, so the phone wasn't moved further back.
  The route served 0.9.4's file with the right hash from the desktop, and the list showed them all.
- **The Worker log of the app's request:** I have no access to it. The URL is inferred from the hash and from the
  stanza being the only one with that version.
