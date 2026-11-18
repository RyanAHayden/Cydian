# Settings

Settings is at the bottom of Home (F123). F128 audited it on 2026-11-18. The user asked to "clean it up and get rid
of unused / unnecessary ones. make it more akin to the ios 6 settings app and make it cleaner".

The settings and their pages are defined in `web/app/core/settings.js` (`SETTINGS`, `SECTIONS`, `PAGES`).
`web/app/screens/settings.js` draws them.

## Layout (after F128)

Like iOS 6's Settings app, the root is one list of short rows with no footers. Each row opens its own page.

| Root row | Builds | Page |
|---|---|---|
| iFizBox Account | all | sign in, create an account (screens/account.js) |
| General | all | Device and iOS Version (website only); Works on My Phone and Compatibility Marks; Refresh Sources on Launch; Sideloading > Open Other Apps' Links (sideload only); Website > Lock Home and Other Apps > Install on the Website (website only, F145) |
| Theme | all | Appearance (Automatic / Light / Dark as checkmarks) |
| Updates | all | Ignored Upgrades; Upgrade Notifications (jailbreak only); Automatic Installs (jailbreak only: Install Updates Automatically, When Charging and Locked, After a Respring Update, Keep Previous Versions); Update Alerts (sideload only) |
| Signing | website, sideload | see "Settings > Signing" below |
| Open in iFizBox App | website, not jailbroken | an action, not a setting (screens/importlink.js) |
| Install from URL | where Install IPA works | an action (screens/ipa-install.js) |
| Console Logs | jailbreak, or wherever there are logs | screens/queue.js |
| (version line) | all | Home's footer line (device, iOS, version, language) and the build's commit, at the bottom of the root (F183: no About page) |

- Switches sit in their rows (`createSwitch`). Choices are checkmark lists on their own page (Device, iOS Version, Install Updates Automatically, After a Respring Update, Keep Previous Versions,
  Re-sign Reminder). Appearance's three options are checked inline, like iOS 6's.
- Each group's footer says what its rows do in one line. A test keeps each footer to 120 characters or fewer.
- Routes below Settings (`#/home/settings/…`): `general`, `display`, `updates`, `<page>/<key>` (a list page),
  `<page>/holds`, `signing[/<key>]`, `signing/help` (How Signing Works, F134), `account`, `about`, `logs[/<id>]`. The older one-segment routes (`device`,
  `iosVersion`, `holds`) still open their page. Home's device hint and a package's "Set iOS Version" use them.

## Settings > Signing (F134)

The user asked on 2026-11-18 to "reorganize the signing page in settings to be better". It is now laid out like an
iOS 6 settings page, with one-line footers. `SIGNING_GROUPS` (core/settings.js) sets the order and
`signingLayout()` (screens/settings.js) picks the groups a build shows:

| Group | Builds | Rows |
|---|---|---|
| Certificate | website, sideload | Name, Team, Expires (or Certificate: None / Incomplete), then **Import Certificate** or **Replace Certificate**, which opens the file picker (the .p12, .mobileprovision and password file, or their .zip). The footer shows any problem in red |
| Files | while a file or the password is missing | .p12, .mobileprovision, Password, each with Browse |
| Provisioning Profile | once there is one | Name, (website: Type), Expires, Devices, App ID |
| (options) | sideload | **Show Expiry Dates** (switch, on), Re-sign Reminder (list) |
| Signing Server | sideload | the server, Check Server, Run Your Own |
| Certificate Status, Signed Apps | sideload | Check Certificate; the signed apps (days left, or Expired), Re-sign All |
| Install iFizBox App, Bring My Certificate | website, certificate working | as before |
| Remove Certificate | when there is a certificate or a picked file | |
| How Signing Works | website, sideload | a link to `signing/help`: the two-step walkthrough (Select All Files, the Files picker's picture, the server), which used to fill the page |

Show Expiry Dates is in the sideload build only. The brief asked for the website too, but the website keeps no record
of the apps it signs, so it shows no dates and the switch would do nothing there.

## What went

| Setting | Was | Why it went | Now |
|---|---|---|---|
| `sideloader` (Sideloader) | Hidden since 2026-11-17 (`modes: []`) | Nothing read it after app pages stopped handing apps to other sideloaders | iFizBox always signs and installs itself |
| `checkUpdates` (Check for Updates: Off / On Launch / Every 6 Hours / Daily) | Never shown (its feature, `update-check`, never shipped) | The app checks for its own updates on every launch and Reload (F183, silent: a row in Changes), and N5's daemon checks daily | The daemon's default (Daily). A full `daemonPrefs()` sends `ifizbox.checkUpdates: null` so the shell removes any old value |
| `cellular` (Use Cellular Data) | Never shown (feature `cellular` never shipped) | No row, and nobody could set it | The daemon's default (cellular data on). Sent as null like `checkUpdates` |
| `notifications` (Off / Summary / One per Package) | Never shown (feature `notifications` never shipped) | Nothing read it. Upgrade Notifications (jailbreak) and Update Alerts (sideload) are the real controls | none |
| `badge` (App Icon Badge) | Never shown (feature `badge` never shipped) | Nothing read it. The icon always shows the upgrade count (Update Alerts > Icon Badge is iOS's own switch in the sideload build) | none |
| `allowZoom` (Display > Zoom) | F134, user 2026-11-18: "remove zoom setting" | Zoom was off by default and the user wants it gone | Zoom is always off: `applyZoom` keeps the no-zoom viewport, `html.no-zoom` and the cancelled pinch. Not in `TRAVELS` any more; an account or link that still carries it is skipped (`isShown` is false) |

**Migration:** `createSettings()` runs `dropRetired()`, which removes `ifizbox.<key>` from storage for each key in
`RETIRED`. It runs on every launch and costs one lookup per key when nothing is left to remove.

## What moved or was renamed

| Setting | Before | After |
|---|---|---|
| Appearance | Root, first group | Display (Theme since F205) |
| Allow Zoom | Root, under Appearance | Display, renamed **Zoom**; retired by F134 (see What went) |
| Show Compatibility Marks | Root, Works on My Phone group | Display, renamed **Compatibility Marks** |
| Display page | Root row **Display** (route `display`) | F205: renamed **Theme** (route `theme`), holds Appearance only |
| Compatibility Marks | Display | F205: General, beside Works on My Phone |
| Device, iOS Version (website) | Root, two separate groups | General, one group |
| Works on My Phone, Refresh Sources on Launch | Root | General |
| Open Other Apps' Links (sideload) | Root, Sideloading group | General, Sideloading group (shorter footer) |
| Ignored Upgrades, Upgrade Notifications, Automatic Installs | Root | Updates |
| Only When Charging and Locked | Root | Updates, renamed **When Charging and Locked** (the old label was cut off), now with a footer |
| Update Alerts (sideload) | Root | Updates |
| Lock Home Until iFizBox Is Installed, Install on the Website (website) | Settings > Signing | General > Website (F145), with Lock Home's F134 short name; Install on the Website is padlocked while Home is locked |
| Re-sign Reminder (sideload) | Root, Signing group | Settings > Signing, in the options group with Show Expiry Dates (F134) |
| Certificate row (website, sideload) | Root, Signing group with a footer | Root row **Signing**, with the certificate's name as its detail |
| About (app builds) | Root group with the version | Gone (F183): Home's version line at the bottom of the root; updates are checked on every launch and Reload |

## What stays and why

| Key | Builds | Default | Read by |
|---|---|---|---|
| `appearance` | all | light | theme (screens/settings.js applyTheme, theme-boot.js) |
| `device` | website | none (Not Jailbroken) | device.js, home.js, sources.js, search.js |
| `arch` | none (stored only) | iphoneos-arm64 | backend.js getArch(). Device and the bridge set it |
| `worksOnMyPhone` | all | on | device.js, search.js |
| `compatMarks` | all | on | browse.js |
| `iosVersion` | website | auto | device.js |
| `refreshOnLaunch` | all | off on the website, on in the apps | app.js |
| `holds` | all | none | upgrades, Changes, dpkg holds (jailbreak) |
| `upgradeNotifications` | jailbreak | on | ifizbox-helper notifications (N5's daemon) |
| `autoInstall`, `autoInstallIdle`, `respring`, `keepVersions` | jailbreak | off, on, notify, 1 | N7's daemon (daemonPrefs) |
| `showExpiry` | sideload | on | Installed's signature pills (installed.js withSignatures), an app page's Signature row (altstore.js signatureRow), Signed Apps' days (signed-apps.js). Off hides the days; Expired still shows |
| `resignReminder` | sideload | 2 days | signing.remind, Changes |

Nothing kept is only for debugging. Console Logs is an action that shows what installs did, not a setting.
