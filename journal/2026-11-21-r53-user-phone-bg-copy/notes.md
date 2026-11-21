# R53: This iPhone install on the user's phone (background copy, drops)

## What I did

- Read B246's journal (`journal/2026-11-20-b246-here-install-drop/notes.md`). It already ran the 15 Pro part of
  this task on iOS 27.0.1 over Tailscale (direct LAN path): background/locked copy 15-17 MB/s against 18 MB/s in
  front, no suspension, drops during the copy resume, a drop after installd started ends "installed", Browse returns
  `Path`, each install got a new bundle folder.
- What the task still asks is only possible on the user's own phone: iOS 26+, a big real app (300+ MB, e.g.
  RyukGram), and switching to an app that takes the audio session (KeepAlive's silent loop stops). The 15 Pro has
  no Apple ID for such apps, plays no sound (see memory: iPhone 15 no sounds), and its Tailscale path is direct, not
  DERP. Nothing on this machine reaches the user's phone, so I blocked with a CONFIRM for the person.
- Changed no product code.

## What to run on the user's phone (the CONFIRM)

1. Install the current build (main, after B246) of the Lite IPA, Tailscale or LocalDevVPN on, app paired.
2. Install a 300+ MB IPA with This iPhone. During the copy, switch to an app that plays audio (Music, a video app)
   for ~30 s, then come back. Then once more, lock the phone mid-copy.
3. Toggle the VPN off and on mid-copy (a drop), and once more after "Installing" shows.
4. Send the os_log lines (they start "iFizBox install:"; read them in Console.app on a Mac with the phone attached,
   or `pymobiledevice3 syslog live` filtered on that text) with: `AFC: … MB/s, in front|in
   the background`, `the app went to the background`, `the app was suspended for N s`, `dropped … try N`,
   `iOS lists …`, and the speeds summary "X MB/s in front, Y MB/s in the background". The progress page itself only
   says "Copied N MB to iOS" (B246's review moved the speeds to the log).
5. Reinstall the same version once to check the new bundle folder.

If the background speed is far below front: compare the `suspended for N s` lines (iOS stopped the app: KeepAlive
lost the audio session) against steady but slow `AFC` lines (tsnet/DERP throttled in the background).

## Tried and failed

none: no attempt was possible without the phone.

## Not verified

- Everything this task still asks (background speed with another app holding audio, iOS 26, a 300+ MB real app,
  DERP-relayed path, LocalDevVPN route, same-version reinstall after a drop): needs the user's own phone and
  accounts; nothing here reaches it. B246's 15 Pro results stand for the rest.
