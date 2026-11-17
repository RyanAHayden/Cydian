# R1: SSH into the 4S and pull reference files

## Device
- iPhone 4S (iPhone4,1, N94AP), iOS 6.1.3 (10B329), Darwin 13.0.0, armv7.
- Cydia 1.1.30, apt7 0.7.25.3, OpenSSH 6.7p1-13. 205 packages in dpkg status.
- Wi-Fi 192.168.0.84 (DHCP; if `ssh 4s` stops working, check the IP first).

## SSH
- `Host 4s` in `~/.ssh/config`: `HostKeyAlgorithms +ssh-rsa`, `PubkeyAcceptedAlgorithms +ssh-rsa`,
  `KexAlgorithms +diffie-hellman-group14-sha1,diffie-hellman-group1-sha1`. Leave out `ssh-dss`: OpenSSH 10.x
  rejects the whole config if it's there.
- OpenSSH 6.7 takes ed25519 keys, so the normal `~/.ssh/id_ed25519` works (installed with `ssh-copy-id 4s`).
- The first connection after installing OpenSSH hangs for about a minute with no banner while the phone makes
  its host keys. Later connections are quick.
- `ssh-copy-id` from Claude Code's `!` prompt fails: there's no TTY for the password prompt. Run it in a real
  terminal.

## Pulled (`tools/pull-4s.sh`, 171 MB, ~70 s over Wi-Fi)
- `etc/apt/sources.list.d/cydia.list` is an absolute symlink to
  `/var/mobile/Library/Caches/com.saurik.Cydia/sources.list`. Read the copy under `ref/4s/var/...` instead.
- Sources on the phone: Telesphoreo (`apt.saurik.com ios/793.00 main`), BigBoss, ModMyi, ZodTTD, plus flat repos
  (rpetri.ch, iphonecake, akemi, h6nry, 7bubbl3s, mtmdev, invoxiplaygames).
- `var/lib/apt/lists` and Cydia's own `Caches/.../lists` hold real `Packages` files, flat (`_._Packages`) and
  dist style. Useful as F2 fixture sources. `var/lib/dpkg/status` is a real F7 fixture (trim it before
  committing anything from it).
- The Cydia cache also has `Cache.db`, `LocalStorage` and `ApplicationCache.db` (WebKit caches of the home page
  and depictions). Look at these during R2.
- UI strings and section names were copied into `docs/cydia.md`.

## Left
- Home+Power screenshots of every Cydia screen, sent to `ref/4s/screens/` (needs the user).

## Phone control (added after SimulateTouch + Veency)
- Taps: `ssh 4s stouch touch X Y` (points, 320x480 portrait); swipes: `stouch swipe x1 y1 x2 y2 [dur]`.
- Screens: `uiopen cydia://sources` etc. Screenshots: `activator send libactivator.system.take-screenshot`;
  `tools/ui-4s.sh` wraps taps, swipes, `uiopen`, home and screenshots behind a one-agent lock. Screenshots pile up in the Camera Roll
  (no `rm` on the 4S).
- Veency listens on 5900 and asks Accept/Reject on the phone for every connection until a VNC password is set.
  Even a plain TCP probe of 5900 brings up the prompt.

## UIKit artwork -> kit HD counterparts
- `tools/artwork.py` reads iOS 6 `.artwork` (layout in its docstring): 1178 images from Shared@2x, 8 from
  Shared@2x~iphone. Flags 0/1 are premultiplied BGRA and 2 is 8-bit grey with rows padded to 4 bytes.
- The kit's `img/` layers hold only 3 of the device images (share icons). The kit draws everything else as
  vectors, so `tools/kitmatch.py` finds each device image on the whole composite (`original-2x.png`, masked
  NCC) and cuts the same rectangle from `render-4x.png`: 863 located, 55 good (diff <= 12, ncc >= 0.85). They're
  mostly bar backgrounds, bar buttons, round buttons, switch/slider parts and share icons.
- Render `sheet-hd.svg` with Chromium, not rsvg-convert. rsvg ignores `transform-origin` on gradients, so
  every button and bar loses its gloss. Chromium matches Photoshop's composite apart from a faint bar
  highlight.
- Limits: tintable white glyphs (`UITinted*`, `UIButtonBarGarbage*`) come out of the HD cut with the kit's
  colour around their edges. Stretch caps match, but the kit draws labels over most buttons, which pushes
  their diff up (e.g. `UINavigationBarDefaultBack` = 68). Some kit redraws differ on purpose (no linen texture
  on `UISegmentTexturedButtonSelectedCenter`).
