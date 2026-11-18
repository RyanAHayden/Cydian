# D4: stale cydian:// comment in web/app/app.js

- The comment above `startIncoming()` said the website sends F89's "Open in Cydian on an app page". F92/F95
  dropped that hand-off (incoming.js header already says so). Checked what the website still sends: only
  `cydian://import` (Home's Send Settings / Open in Cydian App, screens/home.js). Rewrote the comment to say that,
  and that `cydian://install` stays only for links already out there.
- Comment-only change; no code touched.

**Not verified**: none (comment only; the gate runs in `done`).
