# R31: Lite on iOS 27, an install that iOS freezes or evicts

## What the task needs

On the user's iPhone19,2 (iOS 27), start an IPA install in the Lite build, then put iFizBox in the background or
lock the phone until iOS evicts it, while `idevicesyslog -m iFizBox -m installd -m symptomsd` records. Then check
the install-log lines B89 added (going to the background / locked, "iOS froze iFizBox for N s", the listener
listening again, "uploading to /sign/host") and that the install ends installed, from the re-created listener or
from the Signing Server's copy. Also note when the inbox socket gets suspended (on eviction or on lock).
Background: `journal/2026-11-19-b89-frozen-install-server/README.md`.

## What I did

Nothing on the device. `idevice_id -l` found no device ("Unable to retrieve device list"), so the phone isn't
plugged into this machine. And even plugged in, the test needs a person: someone has to tap Install, then leave the
app or lock the phone. That phone has no remote-screen tool like `tools/ui-7.sh`, and this run was unattended.
The iPhone 7 can't stand in for it, because it runs iOS 15 and the jailbreak build, not Lite on iOS 27.

Blocked the task. It needs the user at the phone.

## How to run it (for the session that has the user there)

1. Plug in the iPhone19,2 and confirm `idevice_id -l` lists it. Install a Lite build that has B89 (0.9.9 builds
   after the B89 merge; the install log's "iOS froze" wording is the tell).
2. `idevicesyslog -m iFizBox -m installd -m symptomsd > scratch/r31-syslog.txt` in the background, keeping its pid.
3. Run 1, background: start an install of a large IPA (so it's still downloading), press Home, open another heavy
   app, and wait for `COSMCtrl evictBackgroundApps: evicting com.ryha.ifizbox` in the log. Wait a minute, then open
   iFizBox again.
4. Run 2, lock: same, but lock the phone instead of leaving the app; wait 2–3 minutes and unlock.
5. For each run, write down from the syslog and the progress page's console: the time of eviction/lock, the time
   of "Suspending inbox socket" / "Resuming inbox socket" from Network.framework (this answers when the socket gets
   suspended), B89's lines (background, locked, "iOS froze iFizBox for N s", listens again, "uploading to
   /sign/host"), installd's result, and whether the app ends up installed and by which route (iOS fetching from the
   local port again, or `/sign/host/<t>/status` going started → finished).

## Notes

- The brief's file list names `journal/2026-11-17-b1-dist-source-icon`, an old B1 journal that has nothing to do
  with this task; it looks like a slip in the plan entry. I left it alone and wrote this journal under R31's own name.

## Not verified

- **Everything the task asks for.** No device is connected (`idevice_id -l` fails) and nobody was at the phone to
  tap Install, leave the app or lock it. So these are all still open: when iOS 27 suspends the inbox socket
  (eviction or lock), whether B89's heartbeat logs the freeze, whether the listener re-created on the same port
  takes iOS's connections, whether the `/sign/host` fallback uploads and installs, and whether the install ends
  installed.
