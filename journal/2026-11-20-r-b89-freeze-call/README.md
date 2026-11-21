# R51: B89's freeze path on iOS 27 with a real suspension (call to the phone)

## What the task needs

On the iPhone 15 Pro (iPhone16,1, iOS 27.0.1, `tools/ui-15.sh`), start an IPA install with Install Apps With =
Signing Server, interrupt KeepAlive's audio for more than 30 s with iFizBox in the background (the brief says a
phone or FaceTime call), then tap Install. Record the device log and the progress page's Log, and look for
"iOS froze iFizBox for N s", "listens again", "uploading to .../sign/host", and where the install came from.

## Result: blocked, the call needs a person

**No real suspension happened, so B89's freeze path is still untested on a phone.** Nobody can call the phone from
this machine: it has no SIM (the status bar says SOS), and a FaceTime call needs another Apple ID or device that
the agent doesn't have. So I tried a stand-in that needs no person: a Clock timer or alarm, which also interrupts
other apps' audio. The person running the run then asked me to stop, because the user could hear the sounds. I
cancelled everything and blocked the task with a CONFIRM for the user to make the call.

## What the stand-in showed (2026-11-20, 20:53 to 21:08)

The throwaway app was `com.ryha.r51test` (`R51Test`): `web/app/core/fixtures/signing/tiny-ifizbox.ipa` with a new
bundle ID and name from the rig's `zsign -a -b com.ryha.r51test -n R51Test`, copied into iFizBox's Documents with
`afcclient --container`. The phone had iFizBox 0.17.3 (3137). Each run was SIGN → INSTALL → Confirm, then iOS's
"sign.ifizbox.com would like to install R51Test" prompt, then Home. The device log came from
`pymobiledevice3 syslog live`. `syslog-excerpt.txt` has the lines quoted below: the interruptions, the role and
`taskState` updates, WebKit's suspend timer, the alarm firing and being dismissed, the finger touches, and
appstored's fetch. The progress page's Log is in `shots/`: `r51-f.png` is run 1 with iOS's prompt up, and
`r51-run2-c.png` is run 2's Log after the prompt closed. Home-screen shots are not kept, because they show
Apple's icons.

| Run | What interrupted the audio | What the log shows | End |
|---|---|---|---|
| 1 | Clock timer (3 min), prompt up, iFizBox in the background | 20:56:45 audiomxd: `SpringBoard ... category 'Alarm' INTERRUPTING 'iFizBox(712)'`, KeepAlive's session (`[MediaPlayback/Default] [Mixable]`) stopped. 20:56:50: RunningBoard set iFizBox's darwin role to `Background`, but `taskState 4` (still running), not suspended. 20:57:05: WebKit `ProcessStateMonitor::processWillBeSuspendedImmediately` (its 15 s timer ran out). 20:57:06: the timer tone stopped after about 21 s (`SpringBoard ... About to deactivate audio session`), iFizBox got `EndInterruption` (resumable), and its role went back to `NonUserInteractive`. | Install tapped at 20:57:58. appstored fetched `http://127.0.0.1:61002/.../app.ipa` from the **original listener** `[L3]` and R51Test installed. The page logged no freeze line. |
| 2 | Clock alarm at 21:02, prompt up | The alarm interrupted iFizBox's audio at 21:02:00.98. At 21:02:13 a real finger (backboardd `HSTouchHIDService` digitizer events) touched the alert window and stopped the alarm (`ClockAngel ... dismiss alarm` 21:02:15). The install prompt closed too. | Not installed. The page logged "The Install prompt for R51Test closed; waiting for iOS to ask for the IPA". I cancelled the run. |
| 3 | Clock alarm at 21:07, prompt up, volume lowered | 21:07:05 role `Background`, `taskState 4`; WebKit `processWillBeSuspended starts timer for 14.98s`. 21:07:11 `EndInterruption`, role `NonUserInteractive`, WebKit `processDidBecomeRunning`, about 6 s in. Why the interruption ended this early isn't clear from the log. Then the note to stop came. I dismissed the alarm and tapped Cancel on the prompt. | Not installed (cancelled). |

What the stand-in did establish:

- **A Clock timer or alarm does interrupt KeepAlive's audio**, although the session is `.playback` +
  `.mixWithOthers`: audiomxd's interruptor is SpringBoard's `Alarm` category. So any long interruption with this
  priority can take iFizBox's background running away, not only a call.
- **Within about 20 s iFizBox wasn't suspended.** Five seconds after the interruption, RunningBoard moved it to the
  `Background` role, but its task state stayed running. WebKit's own suspend timer fired at about 20 s, and the
  interruption ended a second later. Whether iOS suspends the whole process past about 30 s, which is what B89's
  heartbeat-gap recovery needs, is still open.
- On this build, B89's lines are still not in the device log (R31's NSLog finding), only on the progress page.

## Phone state at the end

The alarm is deleted (Clock > Alarms shows none) and no timer is running (only Recents). R51Test isn't installed,
its IPA is removed from iFizBox's Documents (`probe.ipa`, another task's file, is left alone), and the last
install run was cancelled. **The ringer volume is lower than before**: I pressed volume-down 16 times through WDA
before run 3. I didn't press it back up, because the person running the run asked for no more sound, and turning
the volume up can play a sample. The user may want to turn it back up. The `ui-15.sh` lock is released. The
`pymobiledevice3 syslog live` capture was started with `timeout 3600` and ends by itself at about 21:51.

## Tried and failed

- Setting the timer's minutes wheel through WDA's element value API (`/element/<id>/value` "4 min"): the
  accessibility value changed, but the started timer used the old 15 min. I cancelled it and set the wheel with
  swipes (about 5 rows per 490 px slow swipe).
- A long interruption without a person: the timer tone stops after about 21 s, the alarm got stopped by hand in run
  2, and in run 3 the interruption ended after about 6 s. None got past 30 s.

## Not verified

- **B89's freeze path**: "iOS froze iFizBox for N s", the listener re-created ("listens again"), the
  `/sign/host` upload and an install from the Signing Server's copy. No run got a real suspension. It needs the
  user to call the phone (phone or FaceTime) while iOS's Install prompt is up and leave it ringing or answered
  for more than 30 s. Blocked with CONFIRM for that.
- **Whether a longer alarm would have done it**: not tried, because the person running the run asked for no more
  Clock sounds on this phone.
- **Why run 3's interruption ended after about 6 s**: the log has no clear cause (no touch, no `dismiss` before
  21:07:11). I didn't dig further once told to stop.
