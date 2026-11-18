# Settings

Settings is at the bottom of Home (F123). F128 audited it on 2026-11-18. The user asked to "clean it up and get rid
of unused / unnecessary ones. make it more akin to the ios 6 settings app and make it cleaner".

The settings and their pages are defined in `web/app/core/settings.js` (`SETTINGS`, `SECTIONS`, `PAGES`).
`web/app/screens/settings.js` draws them.

## Layout (after F128)

Like iOS 6's Settings app, the root is one list of short rows with no footers. Each row opens its own page.

| Root row | Builds | Page |
|---|---|---|
| Cydian Account | all | sign in, create an account (screens/account.js) |
| General | all | Device and iOS Version (website only); Works on My Phone; Refresh Sources on Launch; Sideloading > Open Other Apps' Links (sideload only); Website > Lock Home Until Cydian Is Installed and Other Apps > Install on the Website (website only, F145) |
| Display | all | Appearance (Automatic / Light / Dark as checkmarks); Compatibility Marks; Zoom |
| Updates | all | Ignored Upgrades; Upgrade Notifications (jailbreak only); Automatic Installs (jailbreak only: Install Updates Automatically, When Charging and Locked, After a Respring Update, Keep Previous Versions); Update Alerts (sideload only) |
| Signing | website, sideload | the certificate walkthrough; Re-sign Reminder (sideload only) |
| Open in Cydian App | website, not jailbroken | an action, not a setting (screens/importlink.js) |
| Install from URL | where Install IPA works | an action (screens/ipa-install.js) |
| Console Logs | jailbreak, or wherever there are logs | screens/queue.js |
| About | jailbreak, sideload | Version, Check for Updates, Skip This Version |

- Switches sit in their rows (`createSwitch`). Choices are checkmark lists on their own page (Device, iOS Version, Install Updates Automatically, After a Respring Update, Keep Previous Versions,
  Re-sign Reminder). Appearance's three options are checked inline, like iOS 6's.
- Each group's footer says what its rows do in one line. A test keeps each footer to 120 characters or fewer.
- Routes below Settings (`#/home/settings/…`): `general`, `display`, `updates`, `<page>/<key>` (a list page),
  `<page>/holds`, `signing[/<key>]`, `account`, `about`, `logs[/<id>]`. The older one-segment routes (`device`,
  `iosVersion`, `holds`) still open their page. Home's device hint and a package's "Set iOS Version" use them.

## What went

| Setting | Was | Why it went | Now |
|---|---|---|---|
| `sideloader` (Sideloader) | Hidden since 2026-11-17 (`modes: []`) | Nothing read it after app pages stopped handing apps to other sideloaders | Cydian always signs and installs itself |
| `checkUpdates` (Check for Updates: Off / On Launch / Every 6 Hours / Daily) | Never shown (its feature, `update-check`, never shipped) | The app has its own check (About > Check for Updates, once a day), and N5's daemon checks daily | The daemon's default (Daily). A full `daemonPrefs()` sends `cydian.checkUpdates: null` so the shell removes any old value |
| `cellular` (Use Cellular Data) | Never shown (feature `cellular` never shipped) | No row, and nobody could set it | The daemon's default (cellular data on). Sent as null like `checkUpdates` |
| `notifications` (Off / Summary / One per Package) | Never shown (feature `notifications` never shipped) | Nothing read it. Upgrade Notifications (jailbreak) and Update Alerts (sideload) are the real controls | none |
| `badge` (App Icon Badge) | Never shown (feature `badge` never shipped) | Nothing read it. The icon always shows the upgrade count (Update Alerts > Icon Badge is iOS's own switch in the sideload build) | none |

**Migration:** `createSettings()` runs `dropRetired()`, which removes `cydian.<key>` from storage for each key in
`RETIRED`. It runs on every launch and costs one lookup per key when nothing is left to remove.

## What moved or was renamed

| Setting | Before | After |
|---|---|---|
| Appearance | Root, first group | Display |
| Allow Zoom | Root, under Appearance | Display, renamed **Zoom** (iOS 6's Accessibility wording), its own group |
| Show Compatibility Marks | Root, Works on My Phone group | Display, renamed **Compatibility Marks** |
| Device, iOS Version (website) | Root, two separate groups | General, one group |
| Works on My Phone, Refresh Sources on Launch | Root | General |
| Open Other Apps' Links (sideload) | Root, Sideloading group | General, Sideloading group (shorter footer) |
| Ignored Upgrades, Upgrade Notifications, Automatic Installs | Root | Updates |
| Only When Charging and Locked | Root | Updates, renamed **When Charging and Locked** (the old label was cut off), now with a footer |
| Update Alerts (sideload) | Root | Updates |
| Lock Home Until Cydian Is Installed, Install on the Website (website) | Settings > Signing | General > Website (F145); Install on the Website is padlocked while Home is locked |
| Re-sign Reminder (sideload) | Root, Signing group | Settings > Signing, under the walkthrough's steps |
| Certificate row (website, sideload) | Root, Signing group with a footer | Root row **Signing**, with the certificate's name as its detail |
| About (app builds) | Root group with the version | Root row **About**, which opens the version, Check for Updates and Skip This Version |

## What stays and why

| Key | Builds | Default | Read by |
|---|---|---|---|
| `appearance` | all | light | theme (screens/settings.js applyTheme, theme-boot.js) |
| `allowZoom` | all | off | applyZoom. The user asked for it (zoom off by default) |
| `device` | website | none (Not Jailbroken) | device.js, home.js, sources.js, search.js |
| `arch` | none (stored only) | iphoneos-arm64 | backend.js getArch(). Device and the bridge set it |
| `worksOnMyPhone` | all | on | device.js, search.js |
| `compatMarks` | all | on | browse.js |
| `iosVersion` | website | auto | device.js |
| `refreshOnLaunch` | all | off on the website, on in the apps | app.js |
| `holds` | all | none | upgrades, Changes, dpkg holds (jailbreak) |
| `upgradeNotifications` | jailbreak | on | cydian-helper notifications (N5's daemon) |
| `autoInstall`, `autoInstallIdle`, `respring`, `keepVersions` | jailbreak | off, on, notify, 1 | N7's daemon (daemonPrefs) |
| `resignReminder` | sideload | 2 days | signing.remind, Changes |

Nothing kept is only for debugging. Console Logs is an action that shows what installs did, not a setting.
