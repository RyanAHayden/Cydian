# B268: Add Tweaks says paid tweaks have no seller

## What was wrong

A tester saw "The .deb couldn't be downloaded. This paid tweak's source names no seller to buy it from." on most
tweaks in Add Tweaks (sideload build).

Checked each suspect from the task against the live Packages files (Chariz, Havoc, BigBoss, 2026-11-21) and on the
iPhone 15 Pro through Web Inspector (eval of the installed app's own modules):

- **Tag misread**: no. Free tweaks carry no `cydia::commercial` on any of the three repos (Chariz: 0 of its 526
  `chariz.com/get/` packages; Havoc's tagged packages answer real prices from its vendor). On the phone the catalog
  stanzas match the files.
- **Missing Filename**: no. Every stanza in all three repos has one.
- **Free download reported as paid**: no. `tweakInfo` on free Havoc, Chariz and BigBoss tweaks downloaded each .deb
  and gave a real answer (most are SpringBoard tweaks, refused for that reason, not as paid).
- **The real bug**: for the tagged ones, `catalogVendorFor` asked `catalog.package(id, "*")`. In the sideload build
  All Sources leaves the Tweak Sources out, so it answered `null` on the phone, no source key was found, and Havoc's
  and Chariz's paid tweaks fell through to "names no seller" although both publish a `payment_endpoint`
  (`https://havoc.app/api/sileo/`, `https://chariz.com/api/sileo/`). The repos' tweak lists are 14-45% tagged
  (BigBoss 626/4356 injectable, Havoc 93/207, Chariz 19/48), so a tester trying popular tweaks hits it a lot.
- Also: a failed `payment_endpoint` fetch was cached as `null` for the whole session.

## Fix

`screens/tweaks.js` `findSeller(st, { catalog, sources, text })`: All Sources first, and when it doesn't list the
package, each APT source the app has whose own catalog carries that version; then that source's payment_endpoint.
A failed endpoint fetch is dropped from the cache so it's asked again. BigBoss has no payment_endpoint (404) and
answers 403 for its old Cydia Store .debs, so only those keep the "no seller" message.

## Tests

`web/app/screens/tweaks-seller.test.js` with real stanzas cut from the live files (`core/fixtures/paid/`), in a
catalog shaped like the phone's (All Sources answers null): free ones download from their Filename without a
seller call; Havoc/Chariz paid ones find their seller and Add Tweaks gets Sign In; BigBoss's unsold ones say no
seller; a failed endpoint fetch is retried.

## On the iPhone 15 Pro (Lite, by injection into the running app)

- The new lookup, inlined in the installed app (its bundle predates the fix), against the phone's own catalog and
  the real vendors: Havoc Aerial -> Sign In ($5.99), seller "Havoc"; Chariz Aemulo -> seller "Chariz", which answers
  "This item is currently not available for purchase." (the vendor's own words); BigBoss 2x2 Folder Icons -> no
  seller.
- Three free tweaks (BigBoss: AskActionTube, BlueBear for Youtube, Cone Gestures for YouTube) through the ADD
  button's steps (`tweakInfo` ok -> `tweakDeb` -> `addDebTo`) into the test app `com.ryha.b264test`: all three saved;
  `preparedItems` turned them into three dylibs plus ElleKit for injection. The app's saved list was put back to
  empty afterwards.

## Not verified

- The fix in a built IPA on the phone: the phone runs the installed build, so the new code was checked inlined in
  its web view, not from a rebuilt IPA (building, signing and installing an IPA for a JS-only change was not worth
  the rig time; the gate builds both native targets).
- Tapping ADD in the Add Tweaks screen by hand: the same steps were run by eval, not by WDA taps.
- Signing an app with the three tweaks injected and launching it: they are YouTube tweaks and YouTube isn't on the
  phone; only the injection prep (`preparedItems`) was checked.
- Buying or signing in to Havoc/Chariz: needs the owner's accounts.
