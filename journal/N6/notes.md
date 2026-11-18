# N6 findings

## Rootless jailbreak (palera1n, iOS 15.8.8): binaries need no-container or no-sandbox
On the iPhone 7, any Mach-O started outside an app container (by hand over ssh, by launchd, or spawned by the app)
is SIGKILLed at exec (exit 137, no output, no crash log) unless its signature carries
`com.apple.private.security.no-container` or `com.apple.private.security.no-sandbox`. `platform-application` alone
is not enough. Procursus signs its tools with no-container. `mkdeb.check` enforces this for the helper and the
daemon (`UNSANDBOXED`). New binaries in the .deb need it too.

## Jailbreak apps need `SBAppUsesLocalNotifications` for notifications
An app in `/var/jb/Applications` is a system app to iOS: without `SBAppUsesLocalNotifications = true` in its
Info.plist it gets no BulletinBoard section, so the permission prompt comes back on every launch, Allow is
forgotten, the app is missing from Settings > Notifications, and anything posted under its bundle id (N5's daemon)
is silently dropped. Sileo has the key. Check: `sudo grep -c com.ryha.cydian
/var/mobile/Library/BulletinBoard/VersionedSectionInfo.plist` is 1 once Allow stuck. Uninstalling drops the
section; the next launch asks again.

## Most jailbreak repos are unsigned
BigBoss, Cydian's own GitHub repo, jjolano, and repo.palera.in (palera1n's keyring lacks its key) have no usable
signature. Plain `apt-get update` exits 100 on any of them and their packages never reach apt's lists; plain
`apt-get -y install` refuses unauthenticated packages. The helper and the daemon pass
`Acquire::AllowInsecureRepositories=true` / `--allow-unauthenticated` (native/helper/README.md "Unsigned repos").

## Driving the iPhone 7 keyboard
Text fields take taps on the on-screen keyboard (750x1334 pixels): row 1 y=958 (q 37, w 112, e 187, r 262, t 337,
y 412, u 487, i 562, o 637, p 712), row 2 y=1066 (a 75, s 150, d 225, f 300, g 375, h 450, j 525, k 600, l 675),
row 3 y=1174 (z 150 … m 600, backspace 700), "." 250,1284 on the URL keyboard. There's no pbcopy on the phone.
