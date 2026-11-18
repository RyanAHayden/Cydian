# F122: Links and every kind of preview picture

## What I did
- `web/app/core/previews.js` (new, pure JS): links (`appLinks`, `packageLinks`, `sileoLinks`, `appGithub`,
  `packageGithub`, `githubRepoOf`) and pictures from every source format (`altShots` for AltStore 1.x/2.0 incl. the
  iphone/ipad split, `aptShots` for `Screenshots:`/`Header:`, `sileoShots` for DepictionScreenshotsView,
  `htmlShots` for Zebra/Cydia HTML depictions, `readmeShots` and `releaseShots` for GitHub), `dedupeShots`,
  `isScreenshotUrl` (badges, shields, SVG, icons, logos, avatars, AltDirect buttons, pictures under 120 px skipped)
  and `loadPreviews` (own pictures first, else the HTML depiction's, else GitHub's README + latest release; cached
  per app for a day in localStorage, `cydian.previews.<key>`, plus memory).
- `core/altstore.js` parseScreenshots keeps `device: "iphone" | "ipad"` when the source split them.
- `screens/altstore.js`: `linksGroup`, `galleryImage`, `galleryGroup`, `previewText`, `previewSlot`, `openOut`.
  The app page's Screenshots strip is now `previewSlot`, and its "Source" group became "Links" (source row first,
  then Developer Website, GitHub, Source Code).
- `screens/browse.js` package page: a gallery slot after the description and a Links group (source, Homepage:,
  GitHub, the Sileo depiction's web buttons) after the Depiction row. `loadSileo` now returns the JSON so the
  gallery and Links fill in once it loads; the depiction's own `.dep-shots` strip is removed when the gallery
  shows those pictures (one gallery, no duplicate).
- `altstore.css`: `.alt-shot.wide` (landscape pictures fill the width at their aspect instead of a phone-tall crop).
- Tests: `core/previews.test.js` (AltStore v1/v2, Sileo, APT fields, README with relative/badge/reference/HTML
  images, release, HTML depiction, dedupe, link lists, loader fallbacks and cache), `screens/previews.test.js`
  (gallery image sizing, proxy retry, icon drop; fetch routing).

## Decisions (unattended)
- Homepage:'s "More Information" row moved into Links as "Developer Website" (it would otherwise be listed twice).
- `Icon:` stays the page's icon and is not put in the gallery (the brief also says to skip icons); `Header:` goes in
  as a wide banner.
- Sileo `headerImage` stays in the depiction (it is drawn there already), not the gallery.
- HTML depiction pictures and GitHub are fallbacks only, used when the source lists no screenshots of its own (the
  brief: "when a source gives none"). In an HTML page, pictures marked "screenshot" (class, alt, file name) win;
  otherwise every picture that passes `isScreenshotUrl`.
- GitHub repo for an AltStore app: a code/website field first, then the IPA's release URL. A release in the repo
  the source JSON itself lives in counts only when the repo is named for the app (one-app source like Feather's
  app-repo.json), so a source repo carrying many apps' IPAs doesn't give every app its README.
- On the website GitHub's raw/API hosts are fetched straight from the browser (they send CORS; the visitor's own
  60/h API limit instead of the proxy's shared one); a connect failure falls back to the proxy. Everything else
  goes through `backend.text` (the proxy on the site, native fetch in the app). README: raw `HEAD/README.md`
  (and other usual names) first, which costs no API quota; the API's `/readme` only if those miss.
- Images: http through the proxy as before (`mediaUrl`); an https picture that fails to load on the site is retried
  once through the proxy (hotlink rules), then dropped; the group goes when its last picture does.
- At most 24 pictures per gallery.

## Tried / found
- Live check (node, real network): Feather's README gave landing.png + demo-light.png and two AltDirect "Add to
  AltStore"/"Download" buttons; LiveContainer's README gave only those buttons. Added the AltDirect/download/
  add-to filters, after which both are clean. Feather's own source then got no GitHub link (its IPA is in the
  source's repo): led to the "named for the app" rule above.

## Not verified
- Nothing seen on a phone or in a browser: no iPhone run in this session (the brief leaves "the user checks a few
  apps on the iPhone" to the user). Layout of `.alt-shot.wide`, the Links group look and the proxy retry are only
  checked by node tests over a fake DOM.
- The Worker proxy's handling of api.github.com / raw.githubusercontent.com fallbacks was not exercised (no
  deployed site in this run); the direct browser fetch path is the normal one.
- Native (jailbreak app) fetch of GitHub through `backend.text` not run on a device.
