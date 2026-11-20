# R40: does an Ad Hoc app need Developer Mode on iOS 27? (blocked: needs the user)

## What is known
- Apple's documented rule (iOS 16+): Developer Mode is needed only for apps signed with a development profile
  (`get-task-allow` true). Ad Hoc, Enterprise, TestFlight and App Store apps should open without it.
- Against that: on 2026-11-19 the user's iPhone 18 Pro (iOS 27) said "Developer Mode required" when opening
  SideDrop's iFizBox. That build is Ad Hoc (SideDrop's adhoc profile) with `get-task-allow` false in the app and
  both extensions (checked in SideDrop's F23 notes).
- SideDrop F23 is on hold for this result. iFizBox's own docs (`docs/sideload.md` ~176) still say development *and*
  ad hoc need Developer Mode, which matches what the 18 Pro did, so nothing in iFizBox has been changed on the
  "Ad Hoc needs no Developer Mode" assumption yet.

## What I did
- Read the brief, the R37/F254i Developer Mode notes, SideDrop's README/docs and its F23 task.
- Looked for SideDrop's served profile (`data/adhoc.mobileprovision`) to check question (3): it is not on this
  machine (`~/repos/sidedrop/data` doesn't exist; the server keeps it in its own `DATA_DIR`).
- Changed no product code or docs.

## Tried and failed
- Nothing could be tried: the only devices reachable here are the 4S (iOS 6, reference only), the iPhone 7
  (iOS 15, jailbroken: AppSync-free but not a clean Developer Mode test, and touching it isn't in this task) and the
  iPhone 15 (read-only lockdown, daily phone). None is the 18 Pro on iOS 27.

## Not verified (all three questions; each needs the user at the iPhone 18 Pro)
1. The exact iOS version on the 18 Pro (Settings > General > About; a beta build number matters, since Developer
   Mode rules could differ in a beta).
2. Whether an Ad Hoc app from another route (one signed in iFizBox with the RSideload profile) also asks for
   Developer Mode with it OFF. If both ask, it's iOS 27 behaviour, not SideDrop's signing.
3. Whether the 18 Pro's UDID is in SideDrop's served profile's `ProvisionedDevices`. Run on the SideDrop host:
   `openssl smime -inform der -verify -noverify -in $DATA_DIR/adhoc.mobileprovision | grep -A200 ProvisionedDevices`
   and compare with the phone's UDID (Finder/iFizBox Find UDID). A missing UDID gives a different error
   ("unable to install" / "integrity could not be verified"), so it's unlikely to be the cause, but it rules it out.
   Also worth checking in the same session: `codesign -d --entitlements - ` on every binary of the installed IPA, in
   case a framework or a nested bundle still carries `get-task-allow`.

## Decision rule for the follow-ups
- If Ad Hoc asks on iOS 27: SideDrop F23 and iFizBox F283 keep the Developer Mode step (skip it only on iOS < 27 if
  older versions are checked and don't ask), and the docs say iOS 27 asks for it for Ad Hoc too.
- If only SideDrop's build asks: look for a development-signed piece in that IPA before changing any wording.
