# F244: certificate-expiry tile on Home (sideload build)

## What was built
- `core/signing.js` `expiryWarning(identity, { now, warn, resign, show })`: the earlier of `identity.expires` and
  `identity.profile.expires` (Profile wins only when strictly earlier; a tie says Certificate). Stages: `soon` (amber,
  inside Expiry Warning's days), `close` (red tint, inside Re-sign Reminder's days), `gone` (expired, solid red).
  Words: "Certificate Expires Soon" / "Expires in N days · Renew in Signing"; close: "… Expires Tomorrow / Today /
  in N Days"; gone: "Certificate Expired" / "Apps won't open · Renew in Signing". Days are whole days left (floor),
  like `signatureState`.
- `core/settings.js`: a new section `expiry` on Settings > Signing with `showExpiryWarning` (switch, on) and
  `expiryWarning` (list: 3 Days, 1 Week (default), 2 Weeks, 1 Month, 2 Months), sideload build only (feature
  `expiry-warning`). The list def has `needs: "showExpiryWarning"`. `screens/settings.js` settingsGroups hides a
  `needs` row while its switch is off and follows the switch live (switch changes don't redraw the page).
- `screens/home.js` `certRow()`: the stack tile right after the welcome header, hidden unless `showsCertTile`
  (sideload mode and the setting shown, so never in the jailbreak build or on the site). It re-reads signing.status
  when Home shows again, when the app comes back (visibilitychange), when the three settings change, and on
  `ifizbox:signing-status`, which Settings > Signing dispatches with the identity each time it reads the status.
- `home.css`: the concept's CSS; dark mixes each stage's ink into the theme's tile/edge tokens (no fixed colours
  in dark rules, as theme-palette.test.js requires), so every dark palette gets a tint without new palette tokens.
- Row icons for the two settings (rowicons.js; its test wants every shown setting to have one).

## Decisions (unattended)
- Re-sign Reminder set to Off (0): the red stage still uses the default 2 days, so the tile turns red near the end
  rather than going straight from amber to expired.
- Expiry Warning shorter than Re-sign Reminder (e.g. 3 days vs 7): the warning window is the outer limit; the tile
  appears at 3 days already red.
- Switch off hides the Expiry Warning row (the brief allowed hidden or greyed); hiding needs no disabled-row style.

## Checks
- `node --test web/app`: 1616 pass, with the new `screens/home-certwarning.test.js` (stages, days, Profile vs
  Certificate, switch off still showing Expired, the settings' defs/defaults/modes, the hidden row, markup and CSS).
- 3x Chromium render (`certshots.mjs` here: fake `ifizboxNative` in mode "sideload" answering signing.status) of
  every stage in light and dark, the profile case, switch off (amber/red hidden, Expired shown), far from expiry
  (hidden), and Settings > Signing with the switch on and off: `mont-light.png`, `mont-dark.png`,
  `mont-settings.png`. Light matches concept.png (colours, glyph, position, words). The one difference is the concept's
  Signing tile, which Home shows only while signing isn't set up; the fake identity is set up, so it's hidden.

## Not verified
- On a real phone (iPhone 7 / a sideload install): the task didn't ask for a device test, and the sideload IPA can't
  be built and installed from this slot. The render used a fake bridge.
- Dark palettes other than OLED Black (Gunmetal and palettes.css's): the tint comes from each palette's own tokens,
  but only OLED Black was rendered.
