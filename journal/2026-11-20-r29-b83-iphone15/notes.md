# R29: B83's sideload self-update, checked on the iPhone 15 Pro

The earlier R29 run (journal/2026-11-19-r29-b83-sideload-phone-check/) was blocked because there was no phone with the
Lite build. This run used the iPhone 15 Pro (iPhone16,1, iOS 27.0.1) through `tools/ui-15.sh`, as the reopened brief
says. Checked 2026-11-20, 17:46 to 18:06.

## Result

B83 works on the phone, on the hosted route (Signing Server, iOS's prompt), with another app installing at the
same time. But a self-update to **0.17.2** can't work at all right now (B215, below), so the checks ran on an update
to 0.17.1.

| Brief's check | Result |
|---|---|
| iFizBox stays open after iOS's prompt, with the "Finishing the update" line on the progress page | Yes: "Finishing the update: waiting for iOS to download the new iFizBox", button locked on "Waiting for iOS" (`r29-cancel-0.png`, `r29-w-1.png`) |
| It closes only after iOS has the IPA | Yes. Phone log (`syslog-excerpt.txt`): iOS's download of `/sign/host/<t>/app.ipa` ends 18:04:21.69 ("Waiting for installation to complete"), iFizBox logs `self-close: exiting in 0.6 s` at 18:04:23.65 (the next 2 s status poll), `Process exited ... voluntary` at 18:04:24.73, installd starts the install at 18:04:24.89 and succeeds at 18:04:25.15. No `guessed` line, so it was the server's `finished` mark. |
| Another app installing at the same time | A filler app (the same build re-signed as `com.ryha.r29filler`) was installed over and over through go-ios. One of those installs ran 18:04:18 to 18:04:23, across iOS's download and iFizBox closing. Run 1 the same: 18:00:17 to 18:00:22. |
| Opens on the new version the first time | Yes, twice: `ios apps` says 0.17.1 (2850), and the first launch's Home footer says "Version 0.17.1 (2850)" (`r29-b-open-footer.png`). No "didn't finish installing" banner; the "0.17.2 is out." banner is right, since 0.17.2 is newer. |
| Cancel iOS's prompt once: Try Again after about 2 min | Yes. Cancel at 17:56:28; at 17:58:39 the page showed "The update didn't start: iOS didn't download the new iFizBox. If Install was pressed, try again." with Try Again (`r29-cancel-140s.png`). The 60 s shot still showed the wait. Try Again opened iOS's prompt again, and Install there made run 1. |

## How it was set up

- The phone had Lite 0.17.1. Upgrading from that build hung on a blank Running/Preparing page: B214 (C22 dropped
  `body` in `nav/progress.js`), already filed and landed on main at 17:56, during this run.
- So I built this branch's Lite IPA (`native/build.sh ipa`) with two **temporary, uncommitted** changes:
  `native/VERSION` set to 0.17.0 (so the phone offers an update) and B214's one-line fix
  (`const { sheet, h1, left, right, content: body } = shell;`). Both were reverted after the build. I signed it with
  the rig's zsign and the team's ad hoc profile (`~/.local/share/ifizbox-rig/sign`, T60's setup), installed it with
  `tools/ui-15.sh R29 install` over the user's 0.17.1 (container and certificate kept).
- Update path: Changes > Upgrade (1) > Confirm (the IPA queue's run, `screens/apprun.js` followSelf), and later the
  app page's Version History > Version 0.17.1 > Install > Confirm (the same queue run).
- Filler: `zsign -b com.ryha.r29filler -n R29Filler` of the same build, installed in a loop (about 5 s an install)
  while the update ran. Uninstalled at the end (`ios uninstall com.ryha.r29filler`).
- Run 2 repeated run 1 with `pymobiledevice3 syslog live` capturing, to tell a self-close from iOS killing the app.
- The phone ends as it started: iFizBox Lite 0.17.1, signed in the app with the same team. The filler is removed.

## Found on the way

- **B215 (filed, critical)**: the hosted self-update to 0.17.2 fails for everyone. `POST /sign/host` takes one body
  of at most 25 MB (KV's value limit, `worker/src/index.js` `MAX_IPA`), and the signed 0.17.2 IPA is 29.6 MB. The
  release IPA grew from 17.7 MB (0.17.1) to 28.5 MB (0.17.2). The run ended "iFizBox: Send the signed IPA as the body
  (up to 25 MB)." (`r29-run2-c.png`). That's why the B83 checks used 0.17.1 as the new version.
- **B216 (filed, low)**: Version History's sheet in the Lite build with a certificate says "A sideloader signs it on
  the iPhone with your Apple ID." although iFizBox signs it itself there.
- Small, not filed: after the cancelled prompt the log said "Sent iFizBox to iOS / 1 installed" before the wait
  ended in "didn't start". The Failed line and Try Again then correct it.

## Tried and failed

- Run 1 from the user's own 0.17.1: stuck on the blank Running/Preparing page (B214).
- First run from my 0.17.0 build to 0.17.2: refused by the server as over 25 MB (B215).
- First filler loop: 4 installs finished before iOS's prompt appeared. Later loops ran 25 to 40 installs.
- `pymobiledevice3 syslog live` with several `-m` filters matched nothing (they seem to AND); one `-e` regex worked.

## Not verified

- **An update to 0.17.2 or any IPA over 25 MB**: can't run until B215 is fixed.
- **The edge caching the status key's first not-found read** (up to about 60 s late): not seen. Both times iFizBox
  closed about 2 s after iOS's download ended, so the `finished` mark came through on the first poll after it.
- **The `stalled` path and the B208 backstops** (60 s `downloadGuess`, the 15 s page hint): the download took about
  1 s at 195 Mbps on Wi-Fi, so these never came up. A slow network would be needed.
- **The background case**: iFizBox stayed in front the whole time; nobody pressed Home while it waited.
- **The installed release builds' own code**: the update was driven by this branch's code (plus B214's fix), not by
  the 0.17.1 release's. The user's 0.17.1 can't run the queue at all (B214).
- **The "This iPhone" route** (local idevice install): not part of B83 and not used here.
