# R31: Lite on iOS 27, an install that iOS freezes or evicts

## What the task needs

Start an IPA install in the Lite build on iOS 27, then put iFizBox in the background or lock the phone until iOS
evicts it, while the device log records. Check the install-log lines B89 added (background / locked, "iOS froze
iFizBox for N s", the listener listening again, "uploading to /sign/host"), and check that the install ends installed.
Note when the inbox socket gets suspended. Background: `journal/2026-11-19-b89-frozen-install-server/README.md`.

The first run (2026-11-19) was blocked: the user's iPhone19,2 wasn't plugged in, and nobody was there to tap.
The plan reopened it for the iPhone 15 Pro, driven through `tools/ui-15.sh` (T58).

**This ran on the iPhone 15 Pro: iPhone16,1, iOS 27.0.1. It did not run on the user's iPhone19,2.** `ideviceinfo`
said iPhone16,1 for UDID 00008130-0018450C3661001C. It ran on 2026-11-20, 19:37 to 20:04.

## Result

| Check | Result on iPhone16,1 |
|---|---|
| iOS evicts iFizBox mid-serve | **Yes, but it doesn't suspend it.** `symptomsd COSMCtrl evictBackgroundApps: evicting com.ryha.ifizbox` came 5 min after iFizBox left the front, both times: 19:45:00 → 19:50:04 (Home) and 19:52:31 → 19:57:34 (locked). symptomsd keeps one eviction timer, set to whichever background app is due next (`COSMCtrl ensureMaintenanceTimer set delay 300.500 for eviction timer on ...`, the full 300 s period, or less for an app already part-way through). It evicted OpenTennis, Safari and StoreKitUIService the same way. From the moment iFizBox started serving each install until iOS fetched it, SpringBoard kept it at `taskState: Running; visibility: Background` (KeepAlive's audio session: `BackgroundRunning`). It never went to a suspended state while serving. The only `Suspended` states in the excerpt (19:38:26, 19:41:44) are iFizBox idle with nothing served, about 1.5 s after it left the front: at 19:38:24 the other project's agent launched OpenTennis over it, and at 19:41:43 I pressed Home from the Confirm page (see Tried and failed). Both are normal for an app with no background mode running. So on this phone COSMCtrl's eviction is not a process freeze. B89 read the user's log as eviction = suspension, and this run doesn't back that up. |
| When the inbox socket gets suspended | **Not seen, and still open.** No "Suspending inbox socket" line came through in any run. The syslog relay doesn't carry Network.framework's Debug-level lines, though, so a Debug-level "Suspending" would have been missed (see Not verified). What the runs do show is that the socket kept working. The listener on 127.0.0.1:56064 started at 19:44:43 and took iOS's connections at 19:50:29 (after 5.5 min in the background and the eviction), at 19:58:13 (after 5.5 min locked and the eviction) and at 20:01:46. One `nw_listener_resume_all_inboxes_if_suspended` "Resuming inbox socket" line showed: `[L1] ... 127.0.0.1:56063` at 19:44:43. That's the listener of run 1, whose IPA had been served at 19:42:30 and installed. It came in the same millisecond that the next install's listener `[L2]` (port 56064) started, and about when run 1's 120 s served grace ran out (B29: the route is removed and the listener ends). The log has no explicit cancel line, so the cancel is my reading of the timing and the code. Either way, this "Resuming" line appeared for a listener whose install had worked. In the user's B89 log, the same line at the 15-minute give-up isn't proof by itself that the socket was frozen. |
| B89's lines in the install log | Seen on the progress page's Log (`shots/r31-run3-d.png`, `shots/r31-run3-e.png`): "iFizBox went to the background; still serving", "iFizBox came back to the front", "The install server is listening on 127.0.0.1:56064". That last one is `checkListener` finding the listener `.ready`, so it didn't re-create it. **Not seen**: "iOS froze iFizBox for N s", "listens again", "uploading to /sign/host". The app never froze, so the heartbeat never found a gap. Also **not seen**: "The phone locked" / "The phone unlocked". They hang on `protectedDataWillBecomeUnavailable`/`DidBecomeAvailable`, which only fire on a phone with a passcode, and this one has none (docs/iphone15.md). |
| The install ends installed | **Yes, every run.** `ios apps` lists `com.ryha.r31test` after each, and the excerpt has LaunchServices' `applicationRegistered ... "isPlaceholder": false` for it (for example at 19:42:35 in run 1). Every time it came from the **original local listener**: appstored's `HEAD`/`GET http://127.0.0.1:5606x/.../app.ipa` → 200, then installd. The re-created listener and the Signing Server's copy weren't needed, so neither was tried. |
| The device log carries B89's lines | **No.** `InstallLog.say` (and KeepAlive's and the watch's lines) use `NSLog`, and on iOS 27 none of them reached `idevicesyslog` or `pymobiledevice3 syslog live`. Zero matches for "went to the background", "iOS has the whole IPA", "Install watch ended" or "KeepAlive" in 16 MB of captured log. Only `IDevice.ilog` lines get there, because that's `os_log` with `%{public}@`. So a user's syslog capture, which is what R31 asked for, can't show B89's lines. Only the progress page shows them, and IPA runs aren't kept in Settings > Console Logs. Filed as a follow-up (below). |

### The runs

All four used a throwaway app, `com.ryha.r31test` ("R31Test": this branch's Lite IPA, 0.17.3, given a new bundle ID with
the rig's zsign). I copied it into iFizBox's Documents with `afcclient --container com.ryha.ifizbox -- put`, so it
showed under Install IPAs. Each run was SIGN → INSTALL → Confirm, then iOS's "sign.ifizbox.com would like to install
R31Test" prompt. Settings had Install Apps With = Signing Server (the local-listener route B89 is about). The phone
ran iFizBox 0.17.3 (3092), the user's install, and it was left as it was.

1. **Install, then Home at once** (19:42:30). appstored fetched the 47 MB IPA from 127.0.0.1 in under 0.2 s, about
   1.5 s before Home took effect. Installed at 19:42:35. Over loopback the download is too fast for a freeze to land
   in the middle of it, even for a large IPA.
2. **Background with the prompt unanswered.** Home at 19:45:00. The prompt stays over the Home Screen. Evicted at
   19:50:04, still Running. I tapped Install at 19:50:29. iOS fetched from the same listener and it installed.
3. **Locked with the prompt unanswered.** Side button at 19:52:31. Locking dismissed iOS's prompt
   (`deactivate alertItem ... for reason: Lock`). Evicted at 19:57:34, still Running. On unlock at 19:57:54, iOS showed
   the prompt again. Install at 19:58:13 → installed from the same listener. The page logged B85's "The Install
   prompt for R31Test closed; waiting for iOS to ask for the IPA" before the fetch, then "Sent R31Test to iOS / 1
   installed".
4. **Trying for a real suspension through an audio interruption** (beyond the brief's Home and lock, because
   neither suspended the app). KeepAlive's session is `.playback` +
   `.mixWithOthers`, so ordinary app audio doesn't interrupt it. I called WDA's `/wda/siri/activate` with the prompt
   up. Siri isn't set up on this phone, so it only opened the Siri setup sheet (dismissed with Not Now, no setting
   changed). There was no audio interruption, and iFizBox stayed Running. Install at 20:01:45 → installed from the
   same listener.

An excerpt of the device log (process states, evictions, the prompt, appstored's fetches, the inbox lines) is in
`syslog-excerpt.txt`.

## What this means for B89

- The user's failure (iPhone19,2) still needs a cause. On iPhone16,1, a 5-minute background or lock,
  COSMCtrl's eviction included, leaves iFizBox running and its listener reachable. Their log may have had a real
  suspension for another reason: KeepAlive's audio interrupted (a call, Siri, an alarm), memory pressure, or
  something specific to the 18 Pro. Or the cause wasn't a freeze at all. Their log's "Resuming inbox socket" at the
  cancel isn't evidence of one (see above).
- B89's freeze recovery (heartbeat gap → listener re-created → `/sign/host` fallback) is still **untested on a
  phone**. Getting there needs a real suspension mid-serve. The surest way is an audio interruption, which needs a
  person (a phone or FaceTime call to the iPhone 15 Pro while iOS's prompt is up). Filed as an R for a person.

## Found on the way (filed)

- **NSLog lines don't reach the iOS 27 device log** (InstallLog.say, KeepAlive, the install watch's summary). They
  should go through `os_log` public like `IDevice.ilog`, or the B89 lines can't be seen in a user's syslog.
- **Install IPAs row stays "Not Installed" / "Not signed" after its install ended installed.** After runs 1 and 2,
  the R31Test row still sat under Not Installed with SIGN and "Not signed", even after leaving the page and coming
  back, though `ios apps` listed `com.ryha.r31test` (`shots/r31-list-again.png`). The progress page also closed by
  itself back to that list after runs 1 and 2.
- **R: B89's freeze path on a phone, with a person**: a call to the iPhone 15 Pro mid-serve, to get a real
  suspension.

## Tried and failed

- The first try at run 1 left from the Confirm page without tapping Confirm, so no install started. Idle,
  iFizBox was suspended 1.5 s after Home, which is normal: KeepAlive only plays while something is served.
- `idevicesyslog -m iFizBox ...` and `pymobiledevice3 syslog live -e "iFizBox install|..."` both caught nothing from
  InstallLog (the NSLog finding above). The page's Log was read from screenshots instead.
- At 19:38, before my runs, another project's agent (opentennis B752, which uses this phone per its plan) launched
  OpenTennis through instruments (`DTServiceHub ... launch process with bundle ID 'io.github.fizl0.hst'`) while I held
  `ui-15.sh`'s lock. My first two taps landed in OpenTennis and opened a ko-fi page in Safari. Nothing launched
  after that during the runs (checked in the log). That agent doesn't seem to take the iFizBox UI lock for every
  action. That's for the opentennis repo, so I didn't file it here.

## Phone state at the end

R31Test uninstalled (`ios uninstall com.ryha.r31test`), its IPA removed from iFizBox's Documents, and its record
deleted from Signed Apps (swipe → Delete). iFizBox 0.17.3 (3092) untouched, Install Apps With still Signing Server.
The `ui-15.sh` lock is released. The two background log captures (idevicesyslog, pymobiledevice3) were started with
`timeout 5400` and end by themselves.

## Notes

- The brief's file list names `journal/2026-11-17-b1-dist-source-icon`, an old B1 journal that has nothing to do
  with this task. It looks like a slip in the plan entry. I left it alone, as the first run did.

## Not verified

- **The user's iPhone19,2.** Everything above is iPhone16,1 (same iOS 27.0.1). The brief says to use this phone.
  Whether the 18 Pro behaves the same is open.
- **B89's freeze path**: "iOS froze iFizBox for N s", the listener re-created on the same port, the `/sign/host`
  upload, Try Again with the hosted link (B91), and an install from the Signing Server's copy. None of it was
  triggered, because neither eviction nor lock suspended the app here, and the Siri route gave no interruption. It
  needs a person to call the phone mid-serve (filed).
- **"The phone locked" / "The phone unlocked" lines**: these need a passcode, and this phone has none.
- **When the inbox socket gets suspended**: not seen in any run. The relay doesn't carry Network.framework's
  Debug-level lines, so a "Suspending" line at Debug level would have been missed. A full `pymobiledevice3 syslog
  collect` archive would show Debug lines, but I didn't take one: nothing failed, so there was nothing to explain.
- **A large IPA still downloading when the freeze hits**: over loopback, 47 MB took under 0.2 s, so this can't
  happen with the local route as it stands.
