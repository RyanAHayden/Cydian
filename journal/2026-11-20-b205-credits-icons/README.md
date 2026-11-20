# B205 Credits: every row gets its proper icon

## What I did
- `web/app/screens/home.js` `softwareSections()`: each Software row now passes `icon.src` (the letter stays as
  the fallback `nav/ui.js` shows when the image fails):
  - ElleKit: github.com/tealbathingsuit.png (the repo has no logo of its own; the account shows GitHub's default
    identicon, which is the owner's real avatar)
  - Canister: https://canister.me/favicon.png (its own app-icon logo). Not github.com/canister-app: that org is an
    unrelated Internet Computer project.
  - zsign: zhlynn, OpenSSL: openssl, idevice: jkcoxson, Tailscale: tailscale (GitHub avatars)
  - zlib: its own wordmark, https://zlib.net/images/zlib3d-b1.png (zlib.net's favicon is only 16/32 px)
- The zlib wordmark is wide (369×204), so `object-fit: cover` cropped it to "li". Added one rule in
  `web/app/home.css` (`.thanks-row .cell-icon.thanks-logo img { object-fit: contain; padding: 6px }`) and the
  row passes `icon.cls: "thanks-logo"`. home.css wasn't in the task's file list; it's one added line.
- Artwork rows already showed local Cydia section icons (Tweaks, Text_Editors). Special Thanks already used GitHub
  avatars. Left both as they were.
- New test `web/app/screens/credits-icons.test.js`: every Software row has an https `icon.src` and its letter.

## Check
Headless Chromium, the site (iPhone UA, firstVisit=later), `#/home/credits` at 390 px, 3x: all 16 `.thanks-row`
cells had a loaded `<img>` (Special Thanks 7, Artwork 2, Software 7), none fell back to a letter. Looked at the
3x shot: logos are sharp, zlib shows whole.
(Failed first try: without the iPhone UA the site shows the desktop "Open on Your iPhone" gate.)

## Not verified
- The jailbreak app's WKWebView and the sideload app: no phone test. No CSP restricts img-src in web/app or
  native (grepped), and Special Thanks already loads github.com avatars there, so canister.me and zlib.net
  should load the same way.
- Hotlinked images depend on canister.me and zlib.net keeping those paths; the letter shows if they go away.
