# The iPhone 7 test phone

The phone that runs Cydian's jailbreak build (.deb). Set up 2026-11-18. The iPhone 4S (`ssh 4s`, iOS 6) stays the
Cydia look reference only and never runs Cydian.

| | |
|---|---|
| Model | iPhone 7 (iPhone9,1, A10, T8010) |
| iOS | 15.8.8 (19H422), the last iOS for the iPhone 7 |
| Jailbreak | palera1n v2.4, **rootless** (`/var/jb`, iphoneos-arm64), semi-tethered |
| Network | Wi-Fi `192.168.0.189`, `ssh 7` (Host 7 in `~/.ssh/config` on the desktop) |
| Login | `mobile`, the desktop's key. `sudo` is passwordless since 2026-11-18 (`/var/jb/etc/sudoers.d/mobile`); if `sudo -n true` fails, ask the user, never store a password |
| Plugged into | the T490 (`ssh rytp@omarchy-tp`), used to re-jailbreak it |

## Rules

- Touch it only when your task says so. It is the only modern jailbroken phone.
- Drive its screen only through `tools/ui-7.sh`, under its lock (below). `ssh`, `dpkg -s`, reading files and pulling
  logs need no lock.
- No `apt upgrade` of system packages, no removing palera1n, Sileo, ElleKit or openssh. Installing and removing
  Cydian and test packages is fine when the task is about that.
- If `ssh 7` fails or `/var/jb` is missing, the phone rebooted and lost its jailbreak. Stop and ask the user to
  re-jailbreak it (below); don't try to do it yourself.

## Driving the screen: `tools/ui-7.sh`

```sh
tools/ui-7.sh lock N6                 # take the lock (fails, naming the holder, if someone else has it)
tools/ui-7.sh N6 shot before          # screenshot -> ref/7/screens/before.png (750x1334)
tools/ui-7.sh N6 open cydian://sources
tools/ui-7.sh N6 tap 375 600          # screenshot pixels, portrait
tools/ui-7.sh N6 swipe 375 2 375 900 0.4   # from the top edge: Notification Centre
tools/ui-7.sh N6 home
tools/ui-7.sh unlock N6               # always, also after a failure
```

- `open` takes any URL. `cydian://<tab>` (home, sources, changes, installed, search, settings) opens Cydian on
  that tab, launched or already running (B14); the other `cydian://` links are listed in `web/app/incoming.js`.
- Coordinates are screenshot pixels (750x1334; points x2), so read a spot off a screenshot and tap it.
- From the top edge, `swipe 375 2 375 900 0.4` opens Notification Centre (checked 2026-11-18); `home` closes it.
- **Control Centre doesn't open yet:** bottom-edge swipes (`375 1333 → 375 500`, 0.4 s and 0.8 s) do nothing.
  Bottom-edge gestures probably need something phonectl doesn't send (a touch starting below the screen, or a
  different digitizer flag). Until that's fixed, a person checks the Control Centre controls (N8).
- Left-edge swipe-back (`swipe 2 600 600 600 0.3`) is the same kind of gesture, untested so far.
- Typing: tap the on-screen keyboard's keys (coordinates in `journal/N6/notes.md`); there is no pbcopy.
- Tapping a notification in Notification Centre through phonectl does nothing (N6); a person checks notification taps.
- `lock-button` presses the side button (sleeps or wakes the screen). If a screenshot is all black, the screen is
  asleep: `home` wakes it. The phone has no passcode, so `home` again opens it from the lock screen.
- A lock unused for 30 minutes is stale and can be taken over.

### `phonectl` (what ui-7.sh calls)

A small C tool on the phone, `/var/jb/usr/local/bin/phonectl` (setuid root), source in `tools/phonectl/`:

```
phonectl size | sender | tap X Y | swipe X1 Y1 X2 Y2 [secs] | home | lock | shot FILE.png|-
```

- Touches go through `IOHIDEventSystemClientDispatchEvent`, sent as the built-in touchscreen (its registry ID,
  `phonectl sender`). With any other sender ID backboardd drops them silently.
- Home and side buttons are consumer-page key events (0x0C/0x40, 0x0C/0x30).
- Screenshots use `CARenderServerRenderDisplay` into an IOSurface. The entitlements in
  `tools/phonectl/entitlements.plist` are all needed: without `com.apple.security.iokit-user-client-class`
  (IOSurfaceRootUserClient) `IOSurfaceCreate` returns NULL, and without `com.apple.QuartzCore.global-capture` the
  screenshot is black.
- `shot -` writes the PNG to stdout; ui-7.sh uses that so a setuid run leaves no root-owned file on the phone.
- Rebuild and reinstall: `PHONE_SUDO_PASS=x tools/phonectl/build.sh` (needs `IOS_SDK` and ld64.lld like
  `native/build.sh`; signs on the phone with its `ldid`). The script still insists on `PHONE_SUDO_PASS`, but sudo
  is passwordless now and ignores it, so any value does. It survives reboots (it's in `/var/jb`).

## Installing Cydian on it

```sh
native/build.sh deb                                 # -> native/build/Cydian.deb
scp native/build/Cydian.deb 7:/tmp/
ssh 7 'sudo -n apt-get install -y /tmp/Cydian.deb'  # apt resolves Depends; plain dpkg -i doesn't
ssh 7 'launchctl list | grep com.ryha.cydian'       # the upgrades daemon
```

`sudo` needs no password (passwordless rule since 2026-11-18); scripts use `sudo -n` so they fail instead of
hanging at a prompt if the rule is ever gone. Remove with `sudo apt-get remove -y com.ryha.cydian`.

Cydian is installed on the phone: `com.ryha.cydian` 0.3.8-791 (checked 2026-11-18 with
`ssh 7 dpkg-query -W com.ryha.cydian`). Check the version before assuming what a test runs.

## What's installed

Sileo 2.5.1, apt 2.9.4, dpkg 1.22.6, uikittools (`uicache`, `uiopen`, `sbreload`), `launchctl`, openssh 9.7,
`unzip` and `ldid` (Cydian's Depends/Recommends), ElleKit 1.2 (tweak injection, for AppSync/paid tweaks in R10),
`curl`. Sources: palera1n, ElleKit, Procursus, Havoc, Chariz, BigBoss. No `awk`.

Known quirks:
- Havoc answers command-line `apt` downloads with **418 I'm a teapot**; it serves only Sileo. Install Havoc
  packages from Sileo on the phone (a person has to tap).
- `apt update` warns that repo.palera.in is unsigned (`NO_PUBKEY 9E7E89B50CCF8DAA`; `nebula-keyring` is too old).
  Harmless: only the palera1n loader's own packages come from there.

## Re-jailbreaking after a reboot (a person does this)

palera1n is semi-tethered: after a reboot the phone boots stock, without `/var/jb` or SSH.

1. The phone stays plugged into the **T490** (Intel). checkm8 failed on the desktop (AMD Ryzen USB controllers:
   "UaF race … setup packet was not accepted") and on the M3 MacBook Air.
2. From the desktop: `ssh -t rytp@omarchy-tp 'sudo ~/jailbreak/palera1n -l'`.
3. usbmuxd isn't installed on the T490, so palera1n can't see a normally booted phone. Put it in DFU by hand while
   palera1n waits: hold Side + Volume Down 8 s, let go of Side, keep Volume Down 5 s more. Black screen = DFU.
4. palera1n boots the phone jailbroken; `ssh 7` works again within a minute.

The T490 has `apple_mfi_fastcharge` blacklisted (`/etc/modprobe.d/no-mfi-fastcharge.conf`): that driver grabs the
phone in DFU and breaks checkm8 on Linux. If palera1n says "Resource busy", another palera1n/checkra1n process is
still holding the phone: kill it and retry.
