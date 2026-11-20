# F290: showcase video for X

## Result

- `showcase-4x5.mp4`: 1080x1350, 40.0 s, 60 fps (2400 frames), H.264 High, yuv420p (limited range, BT.709 tags),
  no audio track, 7.4 MB. In this folder (under the 20 MB cap, so committed).
- `showcase-9x16.mp4`: the 1080x1920 vertical cut, same timeline (the phone is bigger, the other beats sit centred),
  8.3 MB. Also here.
- `stills/t<seconds>.jpg`: 16 frames at the key beats from the renderer (`render.mjs --still`); `ffmpeg/`: frames
  pulled out of the final MP4s with `ffmpeg -ss <t> -frames:v 1` (12 of the 4:5 cut, 4 of the 9:16), as JPEG.
- Source: `marketing/video/` (README there). One command re-runs everything: `marketing/video/make.sh [OUT_DIR]`.

## The story (seconds) and what each claim rests on

| t | Caption (pill) | Screen | Claim checked against |
|---|---|---|---|
| 0 | icon, name, "A package manager with the classic iOS look, for modern iPhones" | none | the brief's line; AGENTS.md |
| 3.4 | Every source, one catalog / APT repos and AltStore sources (Jailbreak) | Home > Sources > Havoc > Tweaks, pushed like iOS 6 | the jailbreak backend wraps apt sources with `withAltSources` (backend-native.js) |
| 6.6 | Search every source / Tweaks, themes and apps in one list | Search "dock" | the All / Tweaks / Themes / Apps segments on screen |
| 9.4 | Updates at a glance / Changes, with a badge on the tab | Changes, rings on the tab badge (5) and Upgrade (5) | live in the capture |
| 12.2 | Everything installed / Packages and apps, A to Z | Installed (packages + Install IPAs) | live |
| 14.8 | Swipe to queue / Then confirm the whole queue at once | the swipe on FloatingDockXVI frame by frame (zoomed), a second row queued, then Confirm | rowswipe.js + queue.js, real touches over CDP |
| 19.2 | Sign apps on the phone / This iPhone · your certificate · Free Apple ID (Lite) | Installation & Signing > Install Apps With (This iPhone boxed), then the website's Signing page (Use a Free Apple ID boxed) | core/installroute.js; the Free Apple ID group shows only where the Apple relay is on, and `https://ifizbox.com/apple/status` answered `{"on":true}` today; its footer says those apps are installed by the app on the phone |
| 22.6 | Re-sign before they expire / Days left on every app · Re-sign All (Lite) | Signed Apps (3 days ringed, Re-sign All boxed) | screens/signed-apps.js |
| 25.4 | Push alerts for app updates / Within half an hour of a release (Lite) | Settings > Updates, Push on | docs/push.md; the footer text on that page. See **Not verified**: the hosted server can't push yet |
| 28.0 | Make it yours / Classic · Gunmetal · OLED | Changes in the three themes | core/settings.js lightTheme / darkTheme options (OLED is "OLED Black" in the app) |
| 31.4 | Two builds, one app: Lite (IPA · no jailbreak): AltStore sources; Sign + install IPAs on the phone; Re-sign before expiry; Push alerts for updates. Jailbreak (.deb · jailbroken iPhones): APT repos; Tweaks and themes; Install queue, apt underneath; Everything Lite does, where it applies | both Home screens | AGENTS.md (three front doors), the brief's split |
| 36.4 | end card: icon, name, "The classic iOS look, for modern iPhones", ifizbox.com, "Free, GPL-3.0" | none | brand.js DOMAIN, LICENSE (GPL-3.0-or-later) |

The pills say which build a screen comes from. The name and domain are brand.js's `NAME` / `DOMAIN` (video.html
and capture.mjs import it, make.sh sources native/brand.env); nothing says the old project's name or shows its logo.
The in-app icons that came from that project are its GPL artwork, which the app ships (allowed). The phone is a CSS
rounded slab with a drawn status bar (12:30, bars, battery): no Apple device artwork.

## How it's built

`tools/readme_shots.py` is unchanged and unused: it puts captures in Apple's iPhone 18 Pro bezel, and this video
must not show Apple device artwork. The captures come from the same Chromium fake-bridge route it frames, and the
phone is drawn in `video.html`.

- **Captures** (`capture.mjs`, forked from the README shots' T12 script and B129/B137's copies): web/app in headless
  Chromium at 402x874 CSS px, DPR 2, the 18 Pro's safe areas, a fake `ifizboxNative`.
  - Jailbreak build: `make_state.py` writes a made-up rootless apt state (Procursus, Havoc, Chariz, ElleKit sources;
    a dpkg status of 18 real packages from them; curl and htop set a version behind, Crane Lite, FloatingDockXVI and
    Bea one release behind what Havoc lists), so Changes has 5 upgrades. apt's lists stay empty, so every source is
    read from the network through `net.packages`, as after a fresh install. `helper.run` is faked: update does nothing,
    simulate answers an `apt-get -s` plan from the status and the fetched Packages (enough for Confirm). It no longer
    touches the iPhone 7 (the T12 script ran installs there over ssh).
  - Lite build (`--mode sideload`): fakes for signing.status (a "Demo Team" certificate and wildcard profile),
    signing.installed (Provenance 3.5 days left, iTorrent and Flycast 41), idevice (paired), app.notifyStatus and
    push.status; `PUSH_ON=1` makes the page's fetch of the signing server's `/api/push` answer `enabled: true`.
  - The Free Apple ID screen is the live website (`https://ifizbox.com/#/home/settings/signing`), since the local
    worker has no Apple relay.
  - The swipe: a `touch` step dispatches CDP touch events (the app's rowswipe listens to pointer events, which
    Chromium makes from them) and screenshots after every move and 14 times after the lift: 45 frames.
- **Animation** (`video.html`): one page, a keyframe engine of my own (tracks of x / y / scale / rotate / opacity per
  element, eased); `render(t)` sets transforms and opacity only. iOS 6 palette from ios6.css: the nav bar gradient
  #b0bccd → #6d84a2 as the caption band, the grouped pinstripes as the ground, Helvetica Neue (installed here).
  Screen changes inside the phone are iOS 6 pushes, cross-fades, a sheet sliding up, and a frame-by-frame flipbook.
- **Render** (`render.mjs`): a small static server (repo root, plus /shots/), Chromium at 1080 x H, DPR 1; for each
  of 2400 frames `render(i/60)`, wait one animation frame, `Page.captureScreenshot` (JPEG q95) piped into ffmpeg.
  About 2-3 minutes per cut. `make.sh` end to end took about 15 minutes, most of it the captures' waits.

## Checks

- `make.sh` ran end to end once into the scratchpad (exit 0). After it I fixed two things and re-ran the web capture
  and both renders: the live site was still showing its "Reloading Data" HUD at the 10 s shot (the web script now
  waits for it to go, up to 45 s), and ffmpeg had written full-range `yuvj420p` from the JPEG frames (now converted
  to limited-range yuv420p with BT.709 tags).
- ffprobe on both files: h264 High, 1080x1350 / 1080x1920, 60/1 fps, 2400 frames, 40.000 s, yuv420p, no audio stream.
- Looked at every still in `stills/` (contact sheets at 360x450 and full size): captions readable, rings and boxes
  land on the badge, Upgrade (5), This iPhone, Use a Free Apple ID, 3 days, Re-sign All, the Push switch. Text read
  for typos: none found. `ffmpeg/` holds frames pulled from the final 4:5 MP4 at the same beats (decode check: the
  encoded colours and text match the renderer's stills).
- Text size on a phone: the headline is 72 px of 1080 (about 24 pt on a 360 pt wide feed), the line under it 40 px
  (13 pt). Judged from a 360 px wide scale of the stills; not watched on a real phone.
- Gate: `tools/check.sh` (run by `done`).

## Tried, and what failed

- The first swipe didn't move the row: DockCuts is a paid package, and the row swipe offers nothing for a paid
  package that isn't installed (browse.js rowMenuItems `!item.paid`). Swiping FloatingDockXVI (installed, an upgrade
  waiting) and RoundDock Remastered (free) works.
- Fetching Procursus with apt's own user agent from Python answered 403; make_state.py sends Sileo's.
- Gunmetal and OLED read alike at the theme beat's size (the bars are 73,78,87 against 33,33,35; the ground 37,39,43
  against black). Left as is: they're labelled, and the difference shows at full size.

## Not verified

- **Push on the hosted server**: `https://sign.ifizbox.com/api/push` answers `{"enabled":false,"reason":"no_key"}`
  today, so the Push beat and the Lite card's "Push alerts for updates" describe what the build does once the signing
  server has an APNs key; the capture fakes that answer (PUSH_ON=1). Update alerts from the background check work
  without it. If the video goes out before the key is added, drop or reword that beat (`video.html`: the `S.push`
  caption and the Lite card's last item).
- Not uploaded to X: the task said not to publish beyond git. The file meets X's documented limits (under 512 MB,
  under 2:20, H.264, 1080 wide, 60 fps), but X's own processing was not tried.
- Not watched on a real phone in the X app; readability was judged from scaled-down stills.
- The jailbreak screens are a made-up apt state (real packages and repos, invented install set), not a real phone's;
  the Lite screens use a made-up certificate ("Demo Team") and signed-app list. Nothing claims they are a real user's.
- No audio: the brief allowed a silent video.
