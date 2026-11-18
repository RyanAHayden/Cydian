# R14: F121's install-from-the-tap, checked on the iPhone 7

**Outcome: the early link stays on.** Safari isn't suspended and iOS doesn't time out. No change to
`signing-client.js` or `worker/src/index.js`. The findings are in `docs/signing.md` (the F121 paragraph).

## Setup

- cydian.dev was on F121's merge (`build.json` commit `f31fccf`, deployed 10:25Z by Workers Builds).
  `GET /sign/up/<random>/manifest.plist?bundleid=…` answered from its query, so the new Worker was live.
- `npx wrangler@4 tail cydian-sign --format json` (read-only; wrangler was already logged in on this machine) logged
  every `/sign/*` request with its start time, wall time and outcome. `canceled` means the client hung up.
- iPhone 7 Safari already held a certificate on cydian.dev: `cert.p12` + `adhoc.mobileprovision`
  (`S8NFX3A2LT.com.ryha.*`, a wildcard). So `expectedBundleId` gives `com.ryha.cydian` and the early path runs.
- Screen driven with `tools/ui-7.sh` under lock R14. Screenshots are in `ref/7/screens/r14-*.png` (not committed).

## 1. The real flow: Home > Install Cydian App

Times are from the tap:

| t | what |
|---|---|
| 0.48 s | Safari: `POST /sign/upload?…&token=` (reservation) |
| 0.50 s | Safari: `/api/fetch` Cydian.ipa |
| 0.59 s | **appstored: manifest.plist**. iOS took the itms link straight from the tap, with no "Open in iTunes?" |
| ~1.5 s | iOS alert on screen (screenshot r14-10) |
| 2.64 s | Safari: upload start (`size=4483367`) |
| 3.10 s | Safari: PUT part 0 |
| 4.00 s | Safari: `done` |

- Safari kept downloading, signing (zsign WASM) and uploading **behind iOS's alert**, and finished 4.0 s after
  the tap. After the alert was dismissed the HUD was gone, with **no Ready to Install alert** (r14-13).
- iOS said **"Cydian" is Already Installed: delete "Cydian" and try again** instead of the Install prompt. The
  jailbreak `.deb` build of `com.ryha.cydian` is installed in `/var/jb/Applications`, and iOS won't replace a
  system-registered app with an itms install. It is an accurate message for a jailbroken visitor tapping Install
  Cydian App, so I filed nothing for it. Removing the .deb needs `sudo`, and its password isn't available to an
  unattended run. So app.ipa was never requested in this flow.

## 2. iOS's patience with a held app.ipa (probe runs)

To still answer "does iOS give up on app.ipa's wait", I worked the same Worker path from the desktop. A small script
(scratchpad `probe.py`, not committed) reserved a token for a throwaway bundle ID (`com.ryha.r14probe`, `…2`,
`…3`), and `ui-7.sh open` opened the same `itms-services://…/sign/up/<t>/manifest.plist?bundleid=…` link. I tapped
Install in iOS's prompt ("cydian.dev would like to install R14 Probe", r14-20). The script then uploaded a 1 KB test
IPA (`tiny-cydian.ipa` fixture) after a set delay. The install then fails on the dummy IPA (cloud icon), as the brief
expected. What counts is what iOS fetched.

Every run, times from the Install tap:

| run | upload | what appstored did |
|---|---|---|
| 1 | size + done at 100 s | HEAD 0 s (canceled at 30.9 s), HEAD 31 s (canceled 30.1 s), GET 61.8 s held 39 s, **200** |
| 2 | size at 75 s, done at 170 s | HEAD, HEAD (30 s each), GET 61 s got headers at 75 s but **canceled at 60.0 s**, HEAD 121 s 200 at once, GET 121.5 s held 49.6 s, **200** |
| 3 | size + done at 300 s | HEAD 30 / HEAD 30 / GET 60 / HEAD 30 / GET 60 / HEAD 30 / GET 244 s held 57 s, **200** |

- HEAD times out after 30 s and GET after 60 s, both counted **from the request's start**. Run 2 shows that headers
  sent part-way don't reset the GET's clock.
- iOS doesn't give up: it starts a new request each time, for at least 5 minutes ("Waiting…" icon the whole time,
  r14-41). The Worker's 2-minute wait per request never runs out, because iOS hangs up first.
- So the brief's worry (~60 s of silence) is a per-request limit, not a limit on the install.
- Follow-up filed: **F132** (low). `EARLY_WINDOW` (110 s) is shorter than iOS's patience. A sign+upload slower than
  110 s shows the Ready to Install alert and opens a second link while iOS still waits on the first.

Cleanup: the three failed "R14 Probe" placeholders were deleted on the phone (long-press > Remove App > Delete App,
r14-53). The probe uploads expire from KV with the 10-minute TTL.

## Also found

- Opening `https://cydian.dev/settings/signing` (a path, not `#/…`) sticks on an unstyled "Loading". The relative
  `style.css`/`app.js` resolve under `/settings/` and the SPA fallback answers them with HTML. Filed **B15** (low).
  `https://cydian.dev/#/settings/signing` works.

## Tried and dropped

- Reading Safari's IndexedDB over ssh to see the saved certificate: `/var/mobile/Library/WebKit/WebsiteData` is
  root-only. I looked on screen in Settings > Signing instead.

## Not verified

- **A full install of the real Cydian IPA through the early link, with Install tapped and app.ipa fetched.** iOS
  stopped at "Already Installed" because of the jailbreak .deb, and removing that needs `sudo` (password only from the
  user). The probe runs cover the same Worker path and iOS behaviour, but with a dummy IPA, and the link was opened
  by `uiopen`, not by Safari's tap.
- **Safari still working after Install is tapped, for a slow sign.** On this phone the whole sign+upload took 4 s
  and finished behind iOS's first alert, before any Install tap could matter. Install was never offered (see above).
  I didn't throttle the network to make a longer run.
- **The final install on a phone in the ad hoc profile** (integrity, the manifest's `bundle-version` "1.0" against
  the IPA's real 0.3.8). The iPhone 7 isn't in the profile, and the probe IPA was a dummy anyway.
- **Newer iOS (16–18)**: the HEAD 30 s / GET 60 s / retry pattern was measured on iOS 15.8.8 only.
