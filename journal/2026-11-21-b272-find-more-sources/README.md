# B272 Find More Sources pages

## What was wrong, and the fix

1. **Find Tweak Sources' Add buttons** were still Recommended's old blue pill (`.rec-get`), drawn the same in every
   style. They are now More Sources' ADD / ADDED (`price-btn rec-add find-add`): iOS 6's App Store price button, with
   its pressed gradient and inset shadow, ADDED greyed. `ios7.css` and `ios13.css` gain flat versions of `.rec-add`
   (so More Sources and Find App Sources get them too): iOS 7 is a 1pt tinted outline with tinted text, filled with the
   tint while held; iOS 13 is a grey capsule with bold tinted text, darker grey while held. While a repo is added the
   button holds only the small spinner.
2. **Add All** in Find More's nav bar (`findmore.js addAllListed`): the repos the page lists now (Popular on Canister
   or the search's results) that aren't added yet and aren't piracy-listed. One action sheet ("Add the N repos listed
   here that aren't in your sources yet?"), then each in turn under a HUD that counts ("Adding 2 of 9"), as Import adds
   its picks; failures are named in one alert at the end; the list redraws with ADDED. No Unknown Source question per
   repo: the sheet is the one confirm, and an Unknown repo comes in as Unknown, as an imported one does.
3. **Find App Sources was empty.** Cause: it listed only Recommended's app sources *not added yet*
   (`moresources.js drawApps` filtered `!r.added`), so after Recommended's Add All (or adding them one by one) it
   showed nothing but a footer. Checked on the iPhone 15 over Web Inspector: the installed build's `recRows()` gave
   17 rows and `renderApps` drew them all into a detached box, so it wasn't a failed fetch or a sideload-only filter;
   the phone had none of them added at that moment (other agents reset its sources since the report). Now it is a
   directory (`core/appsources.js`): Recommended's AltStore sources, then five more checked ones, added ones kept with
   ADDED, so the page is never empty. Each source not added yet is read for its icon; only when none answers does a
   note under the footer say so ("None of these sources answered: … Check the connection and open this page again.").
   Previews of directory entries open like Recommended's (`manage.js previewRow` looks in both lists).
4. **The stray arrow next to Limneos Repo** was our markup, not the repo's: the "opens outside" mark of the
   ios-repo-updates.com row (`.find-external`, the ↗ character) is `position: absolute`, but its row wasn't a
   positioned box, so it was placed against the whole list and sat halfway down, on Limneos' row (the first Chromium
   render showed it there, above Limneos' ADD; that shot was replaced by the fixed one). iOS draws ↗ as a colour emoji. Fixed both ways: the row is `position: relative`,
   and the mark is a drawn arrow-out-of-a-box (CSS mask), not a character. Separately, repo names and descriptions
   from Canister now drop emoji and arrows (`core/plaintext.js` in `canister.js repoFrom`), so NSCake 🧁 reads
   "NSCake" like the other rows. (Limneos' own icon is a yellow down arrow on dark grey, its real CydiaIcon.png; that
   stays, as every repo's icon does.)

## The directory's extra sources

F344's research on trusted sources isn't done yet (open task), so I used Recommended's bar: run by the app's own
developer or the mod's own maintainer, free, no cracked/decrypted paid apps, no re-hosted mods, no "premium unlocked"
builds, nothing on the piracy list (the test checks `sourceWarning` for each). Read live with
`tools/recommended_check.py` on 2026-11-21:

| Source | URL | Carries |
|---|---|---|
| iSH | https://ish.app/altstore.json | iSH (Theodore Dubois and contributors) |
| iTorrent | https://xitrix.github.io/iTorrent/AltStore.json | iTorrent (XITRIX) |
| Geode | https://ios-repo.geode-sdk.org/altsource/main.json | Geode (Geode SDK Team), "Official AltSource" |
| uYouEnhanced | raw.githubusercontent.com/arichornlover/…/apps.json | uYouEnhanced (arichornlover), "official Altstore source" |
| YTLitePlus | raw.githubusercontent.com/Balackburn/YTLitePlusAltstore/…/apps.json | YTLitePlus, "official Altstore source" |

Left out: randomblock1.com (re-hosts Instagram++ and YouTube Reborn, others' mods); Taurine and Odyssey (iOS 13-14
jailbreaks, no use on iOS 15+); Winston (Reddit client, dead since Reddit's API change); EeveeSpotify (premium
unlock); AppTesters, CyPwn, WuXu, Nabzclan (IPA libraries of decrypted/tweaked apps). Not reachable or no source:
alt.thatstel.la (invalid JSON), alt.ignited.app (TLS error), purei.org, ppsspp.org, melonx, qnblackcat, NeoFreeBird,
Enmity guesses (404).

## Checks

- `node --test web/app`: 2779 pass, with new `screens/findmore-addall.test.js` (Add All, the drawn mark, plain text)
  and `screens/findappsources.test.js` (directory, never empty, the failure note), and updated findmore/moresources
  tests.
- Headless Chromium as the sideload app (`capture.mjs --mode sideload`, `find-<style>.json`), real Canister and
  AltStore data: `shots-ios6/`, `shots-ios7/`, `shots-ios13/` (`find.png` top of Find More with Add All and ADD /
  ADDED, `find-bottom.png` the directory row with its mark in place, `apps.png` Find App Sources).

## Not verified

- **iPhone 15 Pro shots**: see the end of this file (filled in once the phone's lock was free, or why not).
- **Pressed state rendered**: the :active rules are in place for all three styles (iOS 6 the price button's pressed
  gradient and inset shadow, iOS 7 tint fill, iOS 13 darker capsule), but no shot holds a finger down: the capture
  script has no pressed-state step.
- **The jailbreak build on the iPhone 7**: not run; the pages are the same web/app code with `deviceType` set (the
  tests and the Chromium run cover the sideload mode; Find App Sources' rows don't depend on the build).
- **Dark themes**: the iOS 7 / 13 tokens have dark values, not shot.
