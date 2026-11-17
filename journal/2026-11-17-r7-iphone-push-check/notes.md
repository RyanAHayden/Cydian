# R7 Hand-check F10 upgrade alerts on a real iPhone — blocked

## What I did
- Read the F10 hand-check steps (`journal/2026-11-17-f10-web-push/notes.md`, "Hand check on an iPhone").
- Looked for a deployed site to at least probe the non-device parts (`/manifest.json`, `/api/push/key`,
  `/healthz`): the repo only names `https://cydian.example.com` (README placeholder), and T2's notes say no tunnel
  or public URL was opened from a session. So there is no known deployed origin to check against.

## Why blocked
Every step needs a person holding an iPhone on iOS 16.4+ with the PWA added to the Home Screen of the deployed
site (permission prompt, banners, badge, tapping a notification, itms-services:// from standalone, days-later
re-subscribe). An unattended agent has no such device: the only test device (`ssh 4s`) is an iPhone 4S on iOS 6,
which has no Web Push or Home Screen web app push at all. Nothing here can stand in for it.

What would unblock it: the deployed site's public URL, and the user (or someone with an iPhone 16.4+) running
steps 1-10 of the F10 notes and writing the results back into this file.

## Tried and failed
- nothing beyond the search above; no product change was made.

## Not verified
- All of steps 1-10 of the F10 hand check: no iPhone 16.4+ available to an agent, the 4S is iOS 6.
- That the deployed site is up and serves the manifest, service worker and VAPID key: no deployed URL is
  recorded in the repo (only the README placeholder).
