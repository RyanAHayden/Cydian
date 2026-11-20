# Showcase video

A 40-second video for X (Twitter) and other feeds: 1080x1350 (4:5) and a 1080x1920 (9:16) cut, 60 fps H.264, no
audio. Real screens of both builds in a plain rounded phone frame, with short captions in an iOS 6 navigation-bar band.

    marketing/video/make.sh [OUT_DIR]     # default marketing/video/out (gitignored)

Needs node 22+, python3, chromium, ffmpeg and xz, and the network: the captures read real repos (Procursus, Havoc,
Chariz, ElleKit) and the live website. It writes `showcase-4x5.mp4`, `showcase-9x16.mp4`, `stills/` (the key beats,
to check by eye) and `shots/` (the captures). A run takes about 15 minutes.

| File | What it does |
|---|---|
| `make.sh` | the whole run: state, local server, captures, render |
| `make_state.py` | a made-up rootless apt state: four sources, a dpkg status of real packages, a few a version behind so Changes has upgrades |
| `capture.mjs` | web/app in headless Chromium at 402x874 (DPR 2) with a fake native bridge: the jailbreak build (`--native`), the Lite build (`--mode sideload`), or plain (the website) |
| `shots-*.json` | what each capture run visits and shoots; `shots-jailbreak.json` also drives the swipe frame by frame (`touch`) |
| `video.html` | the video as one page on a virtual clock: `render(t)` draws time t; transform and opacity only |
| `render.mjs` | steps `render(t)` 1/60 s at a time, screenshots each frame and pipes them into ffmpeg; `--still` writes PNGs instead |

The story, in seconds: hook (0) · Sources and a source's catalog (3.4) · Search (6.6) · Changes and the tab badge
(9.4) · Installed (12.2) · swipe to queue and Confirm (14.8) · signing on the phone: Install Apps With, Free Apple ID
(19.2) · re-sign before expiry (22.6) · push (25.4) · themes Classic, Gunmetal, OLED (28.0) · Lite vs Jailbreak
(31.4) · end card with the domain and "Free, GPL-3.0" (36.4). Change the beats in `video.html` (`S`, the captions,
the `cols` of the split); preview one moment without rendering with `node render.mjs <shots> --still 12.5 --stills <dir>`.

The name and domain come from `web/app/brand.js` (`video.html` and `capture.mjs` import it; `make.sh` sources
`native/brand.env`). The frame is drawn in CSS: no device artwork, no other product's name or logo.
