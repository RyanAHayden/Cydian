# R59 Lite on the iPhone 15 Pro: the signing certificate after delete + reinstall (B276's phone check)

**Result: both checks pass.** After deleting and reinstalling iFizBox (a fresh container), Signing > Certificate
shows the imported identity and its profile. After Remove Certificate, a delete + reinstall starts at Signing Needs
Setup.

## Setup

- Phone: `ideviceinfo -k ProductType` = iPhone16,1 (the 15 Pro), iOS 27. Driven with `tools/ui-15.sh` under the R59
  lock; state read through Web Inspector (`pymobiledevice3 webinspector cdp --port 9358`, `ev.mjs` here, calling
  `ifizboxNative.call("signing.status")`).
- Before: iFizBox 0.18.3 (3590), built from main 7d00351 by R58, which is **before** B276. Its `signing.status`:
  identity "Apple Distribution: … (S8NFX3A2LT)", profile "sidedrop adhoc" (`com.ryha.*`, Ad Hoc, 2 devices, this
  phone in it) (`status-0-before.json`). So the identity had been imported by a build that wrote no B276 Keychain items.
- Build: Lite from this branch (78dd387f, includes B276's merge c73283bb), `make -C native package`: 0.18.3 (3648).
  Installed with `tools/ui-15.sh R59 install` (rig signer, keeps the Keychain groups).
- Backed up the container first (`afcclient --container com.ryha.ifizbox -- get -r`): `Library/Application Support`
  (profile, `signed.json`, MyIPAs' probe files, tailscale state), `Library/Preferences`, `Documents` (124 KB in all).

## Runs

| Step | What | `signing.status` / screen |
| --- | --- | --- |
| 1 | Over-install of the B276 build (container kept), launch | identity + profile as before (`status-1-overinstall.json`). This launch is when B276 copies a pre-B276 import into the Keychain. |
| 2 | `ios uninstall com.ryha.ifizbox`, then install the same build: fresh container (Library held only Caches, SplashBoard, empty Preferences), launch | **identity + profile back** (`status-2-fresh-container.json`, read at once). Then `idevice.verify` (`status-2b-after-verify.json`), and only after that the screenshots: Settings: Ready to Install, Certificate "341 days left" (`fresh-container-signing.jpg`); Certificate page: the identity's name, team, expiry, "Kept in this iPhone's Keychain", profile sidedrop adhoc, 2 devices, `com.ryha.*`, This iPhone In Profile (`fresh-container-certificate.jpg`; In Profile only because the verify had run, see step 5). |
| 3 | Certificate > Remove Certificate > Remove | `{"identity": null}` (`status-3-after-remove.json`) |
| 4 | `ios uninstall`, install again (fresh container), launch | `{"identity": null}` (`status-4-fresh-after-remove.json`); Home shows **Signing Needs Setup** (`after-remove-needs-setup.jpg`). |
| (restore) | `signing.import` of the team's .p12 + profile by **this B276 build** (see Phone left as) | identity + profile |
| 5 | Backed up again, `ios uninstall`, install (fresh container), launch | **identity + profile back** (`status-5-fresh-after-b276-import.json`); no Needs Setup on Home. Certificate page, shot before anything used the pairing (`fresh-b276-import-certificate.jpg`): identity and profile as in step 2, but **This iPhone: Unknown**, "Not checked: the UDID can't be read here" (filed B284). |

Step 2 covers a phone that imported before B276 (restored from the items step 1 wrote, or from the F73 `.p12`
item's `cert`; which of the two can't be told from outside, as both hold the same SHA-256). Step 5 covers the plain
path: imported by a B276 build, then deleted.

## Observed beside the check

- Right after the fresh install, the profile's `device` field read `state: "unknown"` (no UDID: `ifizbox.phone.udid`
  lives in UserDefaults and went with the container). After `idevice.verify` (`{ok: true, kind: "rp"}`; the pairing
  came back from the Keychain, B218) it read `state: "in"` with this phone's UDID (`status-2b-after-verify.json`),
  and the Certificate page showed In Profile. Before that, the page says This iPhone Unknown, "the UDID can't be read
  here" (step 5's shot), although the kept pairing could tell it. It heals once the pairing is used (any install
  verifies it), but the page is wrong until then: filed **B284** (low, `native/Sources/PhoneID.swift`).
- iOS asked again for local network and notifications after each fresh install (expected: those go with the app).

## Phone left as

iFizBox 0.18.3 (3648, this branch, rig-signed). The team's ad hoc identity re-imported with `signing.import`
(`~/sync/default/signing/cert.p12` + `adhoc.mobileprovision`, the same profile file the container had), which also
writes B276's Keychain items; step 5 then deleted and reinstalled once more, and the files below were put back again
after it. Put back from the backup: `Signing/signed.json` (Signed Apps 10), MyIPAs' `probe.ipa.*`
and `Documents/probe.ipa` (another slot's fixture). Not put back: `Library/Preferences` (the shell theme setting, auto
with gunmetal/classic, the update list and the push registration, which the app rebuilds; the theme may now be
at the app's default) and the old
`tailscale` folder (Tailscale comes back from the Keychain, B218). Pairing verified (`idevice.verify` ok), This iPhone ·
Paired, local network and notifications allowed. CDP server stopped, UI lock released.

## Not verified

- **What else uses the phone's UDID** while it is Unknown after a reinstall (B284): only the Certificate page was
  looked at.
- **Which source restored `certKey`** in step 2 (B276's kept item or the F73 `.p12` item's `cert`): both give the
  same answer and neither is readable from outside the app.
- **A reinstall signed by another team** (other Keychain groups): not tried; B276 says it starts at Needs Setup by
  design. It would need a second team's identity and profile for this phone.
- **Installing a signed app after the restore**: only the identity and profile were checked, not a full sign +
  install with the restored identity (R55/R58 cover installs with this same identity).
