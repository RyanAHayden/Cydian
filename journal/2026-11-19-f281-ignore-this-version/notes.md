# F281 Ignore This Version

## What it does

Beside Ignore Upgrades (holds), an item can hide only the version on offer now. Kept per item as `{ id: version }`
(`ifizbox.ignoredVersions`, core/settings.js `ignoredVersions`: all/get/set/replace/lines).

- core/appupdates.js (pure):
  - `splitIgnoredVersions(upgrades, versions)` moves an available row whose version equals the stored one
    (dpkg compare, so `1.1` = `1.1-0`) under ignored with `ignoredVersion: true`.
  - `settleIgnoredVersions(versions, { upgrades, installedOf })` drops an entry once a newer version is on offer or
    the installed version reaches it. An item with no row and no known installed version keeps its entry.
  - `ignoreVersionLabel`, `withVersionButton`, `versionToStore`: the sheet button
    (Ignore This Version / Stop Ignoring This Version).
  - `versionLines`, `applyVersionLines`: the "id version" form account sync carries.
- catalog.js keeps the map in the page (not the worker): `setIgnoredVersions(map, { onSettle })`, and `upgrades()`
  splits dpkg's rows. `setIgnoredVersions` fires catalog.onChange, so Changes reloads and the tab badge recounts.
- app-updates.js `withAppUpgrades` splits the remembered apps' rows too, then settles. It reads installed versions
  from the records (the real ones in the jailbreak app) and from `catalog.installed()`. Pruning goes through
  catalog's `onSettle`, which browse.js wires to `settings.ignoredVersions.replace`. Sideload background watch: a
  version-ignored app is still followed, with its version added to `known`, so the next version notifies.
- Badge and Upgrade All: both go through catalog.upgrades + withAppUpgrades (screens/changes.js), so they skip the
  rows without any change to changes.js.
- UI:
  - App page sheets: jailbreak Modify, sideload Modify and website Modify (altstore.js `versionButtonOf`), with the
    button after Upgrade. It is red like Ignore Upgrades and not offered while the app is ignored whole.
  - Package page (jailbreak queue sheet, browse.js `ignoreVersionAction`) beside Ignore Upgrades.
  - Row hold menu in all builds (browse.js `versionRowItems`, put before Share): on an Available Upgrades row in
    Changes it offers Ignore This Version, and on a row it filed it offers Stop Ignoring This Version.
  - Settings > Ignored Upgrades (`holdsLayout`): a "This Version Only" group ("1.1, this version only"), where a tap
    undoes the entry. The root row's count includes these entries.
- Sync:
  - Account: an optional `ignoredVersions` line set, merged three ways with `mergeSet`, plus `addVersions` /
    `removeVersions` in `changesFor`. All are left out while empty, so older payloads and summaries compare equal.
  - Open in App link: an optional `versions` object, and `reviewLink` returns only the new ones.

## Decisions

- **Swipe**: a row's swipe has one action (queue). I didn't add a second swipe action. The hold menu is the row
  action for this.
- **Account format**: entries are "id version" strings, so the existing three-way set merge works unchanged. Two
  devices that ignore different versions of one item both land, the newer one stands on apply, and settle tidies
  up afterwards.
- Existing sheet tests that pick buttons by index now pass `iv: null` (appqueue, markedresign, resignqueue). The
  jailbreakmodify test now expects the new button.
- I edited files outside the brief's list because the brief asks for sync: core/account.js, core/transfer.js,
  screens/account.js and screens/importlink.js, plus a few tests. Every change there is an addition.

## Follow-up

- F282: the jailbreak daemon (N5 count/icon badge, N7 automatic installs) doesn't know ignoredVersions yet.

## Not verified

- No phone or browser run (the iPhone 7 isn't part of this task). Not checked by eye: the sheets, the hold menu,
  the Settings page, and the "This Version Only" rows' subtitle layout. Only the node tests ran.
- The jailbreak daemon's own icon badge still counts a version-ignored package (F282) until the page clears it.
- An app build from before F281 that syncs the account writes a payload without `ignoredVersions`. A newer device
  then reads that as "removed elsewhere" and drops its entries, the same way the wish list behaved when it was
  added. Not tested against a real old build.
