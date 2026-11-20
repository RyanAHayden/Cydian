# B131: Installed list, iFizBox's own row has no icon

## Cause
In the sideload app, `core/installed.js` selfRecord gives iFizBox's own record `icon: "icons/icon-lite-glossy-76.png"`,
a file shipped beside the page. `screens/installed.js` decorateApp passes every row's icon through
`depiction.js` mediaUrl, which accepts only `https://`, `http://` (proxied) and `data:image/`, so the relative path
came back null and no image was added to the row's icon cell.

## Fix
`selfIconUrl(r)` in `screens/installed.js`: for a `self` row whose icon is an `icons/<name>.png|svg` path, that
path; null for any other row or path (so a remembered app's record can't point the img at an arbitrary local
URL). decorateApp uses `mediaUrl(r.icon) ?? selfIconUrl(r)`. Unit test: `screens/installed-selficon.test.js`.

## Checked in Chromium (fake native bridge, both builds)
`shot.mjs` here: headless Chromium, 402 px wide, a fake `ifizboxNative` put in place before the modules run,
answering app.info / signing.installed / apt.dpkgStatus / library.list in-page, then `#installed`.
- `sideload.png`: the iFizBox row draws `icons/icon-lite-glossy-76.png` (loaded, the Lite glossy icon).
- `jailbreak.png`: in the jailbreak build iFizBox is a dpkg package row (the remembered-apps list leaves it out),
  and it shows the Packaging section icon, the same way Example Tweak shows the Tweaks section icon. It already had
  an icon, so nothing changed there. Using the app's own icon on that row would mean a package `Icon:` field plus
  `core/sectionicons.js` packageIcon accepting a local path. That's outside this task's file and isn't a bug:
  every dpkg row works the same way.

## Not verified
- On a real iPhone 18 Pro with the sideload build: no device access in this unattended run. The page resolves
  `icons/...` relative to index.html, the same way the shell's WKWebView loads `web/app/`, and the file is in the
  bundle (`web/app/icons/icon-lite-glossy-76.png`). That's why the Chromium check stands in for the device.
