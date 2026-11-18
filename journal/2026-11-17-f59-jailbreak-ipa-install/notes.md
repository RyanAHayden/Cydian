# F59: install an IPA through the jailbreak helper

## What was done

- **Helper verb `install-ipa <path>`** (`native/helper/policy.c` `ipa_plan`, `helper_ipa_path_ok`): one path, only
  `/var/mobile/Library/Caches/com.ryha.cydian/ipa/<name>.ipa` (`HELPER_IPA_DIR`; name `[A-Za-z0-9][A-Za-z0-9._-]*.ipa`,
  ≤ 255 bytes, no `..`). Tests can override the directory with `-DHELPER_IPA_DIR`.
- **`native/helper/ipa.c`**, the work, in plain C (the ObjC call goes through `objc_msgSend` + CoreFoundation, so no
  ObjC compiler and it builds with the same clang line; link adds `-framework CoreFoundation -lobjc`):
  1. open the IPA via the realpath of the directory (`/private/var` accepted) and `openat(..., O_NOFOLLOW)`; it must be
     a regular file, nlink 1, owned by the directory's owner and not root, ≤ 8 GiB; copy into a root-owned
     `/var/tmp/cydian-ipa.XXXXXX/app.ipa`;
  2. `<prefix>/usr/bin/unzip` **as the file's owner** (setuid to mobile) into `pkg/`; bundle id from the one
     `Payload/*.app/Info.plist` (O_NOFOLLOW, CFPropertyList on iOS, an XML scan elsewhere);
  3. AppSync Unified present → installd gets the root copy with `{CFBundleIdentifier}` (appinst's way). Else
     `ldid -s <app>` as mobile (TrollStore Lite's way) and installd gets the `.app` with `PackageType: Developer`. No
     ldid, or installd refuses the ad hoc app → **exit 69** with a message telling the user to install AppSync Unified
     (or ldid) or to sign the IPA for the phone. Work dir always removed. `pmstatus:` lines on fd 3.
- **Entitlements**: `native/helper/entitlements.plist` = appinst's (allowedSPI Install/InstallForLaunchServices,
  installd mach-lookup, platform-application). `native/build.sh` now links ipa.c and signs the helper with it
  (`ldid -S…` or `rcodesign --entitlements-xml-file`; before, rcodesign builds left the helper unsigned beyond lld's
  ad hoc signature). Checked: the built .deb's helper has the Entitlements and DER Entitlements slots
  (`rcodesign print-signature-info`). I did **not** change `native/entitlements.plist` (the app's): the app only spawns
  the helper, which it already can; the installd entitlements belong on the helper.
  `native/build.sh` was outside the task's file list, but the helper's link and signing line lives there.
- **Bridge `ipa.install {url[, stream]}`** (`native/Sources/Apt.swift`, `IPAInstall`): jailbreak mode only (sideload
  answers `sideload:`), http(s) only, downloadTask (1 h resource timeout, its own session) into the helper's directory
  as `<UUID>.ipa`, `Helper.run(["install-ipa", path])`, removes the download. Errors: `bad_url`, `network`, `timeout`,
  `not_found`, `bad_ipa` (64), `no_adhoc` (69), `install` (1/74), `helper` (77 or no helper). Reply on success
  `{code: 0, stdout, stderr, bundleId}`. Builds clean with `build.sh deb`.
- **Fakes**: `native/fake/cydian-helper` gained `install-ipa` (same allowlist, `CYDIAN_IPA_DIR`, `FAKE_APPSYNC`,
  `FAKE_LDID`, `.refused` ids); `native/fake/fake-native.mjs` gained `ipa.install` mirroring Apt.swift (and `mode`,
  `ipaDir` options).
- **Tests**: `native/helper/test_helper.py` `InstallIpa` (allowlist, plan, plist id, AppSync detection, entitlements,
  and the whole chain on Linux with unzip/ldid stand-ins: ad hoc, AppSync, no-ldid → 69, installd refusal → 69,
  symlink/hard link/junk/no Payload/bad id/outside path/wrong caller refusals, work dir cleaned every time); the
  existing iOS compile test now includes ipa.c. `web/app/backend-native-ipa.test.js`: the bridge route on the fake.
  `build()` in test_helper.py adds ipa.c to any build of main.c/test_driver.c, so other agents' new chain tests keep
  linking after the merge.

## Tried and failed

- First iOS compile failed: ipa.c's `install()` had a parameter named `id`, which is ObjC's type on Apple. Renamed.
- The unzip stand-in first took the wrong positional args (`$4`/`$6`) and exited 1 on a bad zip, which unzip uses for
  warnings; now `$3`/`$5` and exit 9 like Info-ZIP.

## Decisions (unattended)

- The download dir is mobile's Caches (the app is no-container), not under the jailbreak prefix: the helper must
  only read a user-owned file from a fixed place.
- Extraction and ldid run as mobile, not root, so a hostile zip can't use root to write anywhere.
- No TrollStore-style MCM container fallback when installd refuses ad hoc apps: the task asked to *say* so; that's
  exit 69 / `no_adhoc`.
- Follow-ups filed: F66 (deb Depends unzip / Recommends ldid), F67 (the web UI flow over ipa.install).

## Not verified

- **Nothing ran on a phone** (no jailbroken modern iPhone; the 4S is iOS 6 and not in scope): whether
  `installApplication:withOptions:error:` works from the helper with these entitlements under the persona spawn;
  whether installd accepts a `.app` directory URL with `PackageType: Developer` for the ad hoc path (TrollStore Lite
  may pass something else); whether `ldid -s` keeps the app's entitlements as intended (Procursus ldid flag semantics
  taken from memory, not checked against its source); whether `/var/tmp` exists and is usable on rootless/roothide
  jailbreaks; whether the jailbreak ships `unzip` at `<prefix>/usr/bin/unzip`; whether installd (not root) can read
  the 0755/0644 work copy; Dopamine/palera1n behaviour with ad hoc apps.
- The Swift `IPAInstall` code only compiled; it never ran (no simulator on Linux). The fake mirrors its logic.
- The AppSync dylib paths (`Library/MobileSubstrate/DynamicLibraries`, `usr/lib/TweakInject`) are the usual ElleKit /
  Substrate locations, not checked on a device.
