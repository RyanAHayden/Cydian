# B256: iOS 27 reads alternateIconName as nil after a switch

## What was wrong

`AppIcon.apply` skipped a switch when `UIApplication.alternateIconName == name`. On iOS 27 that reading is nil right
after a successful switch to a set, so a switch back to the primary (name nil) looked unchanged and iOS was never
asked: the Home Screen kept the old icon, with no alert. `OwnIcons.pick(current:)` read the same value, so with nil it
always picked (and rewrote) own set a, even while a was on screen.

## What changed

- `AppIcon.onScreen` (native/Sources/AppIcon.swift): the set on screen = iOS's reading, or, when iOS reads nil, the
  last set the shell switched to, kept in UserDefaults `ifizbox.appIcon.shown` ("" for the primary).
- `apply` checks `onScreen` instead of `alternateIconName`, and its completion keeps the name once iOS switched
  without an error (the quiet jailbreak call and the public call alike).
- Every other reading goes through it: `app.icon.ready`, `applyShown` (own icons) and the Lite self re-sign
  (Sideload.swift `selfIcon`), so the a/b own-set pick sees the set on screen.
- native/test_icons.py `test_set_on_screen_read_through_on_screen`: no Swift file reads alternateIconName except
  through `onScreen`; apply's check and keep are in place.

## Choices

- Kept the remembered name rather than "always call setAlternateIconName(nil) for the primary": the page sends
  app.icon on every launch (tellIcon's first send), so always calling iOS would show Lite's "You have changed the
  icon" alert at every launch on a primary-icon phone, new installs included.
- iOS's non-nil reading wins over the kept one: only nil is ambiguous.
- Known gap: a phone that switched to a set with a build before this one, and still shows it, has nothing kept;
  there iOS's nil still reads as the primary, so the first switch back to the primary is still skipped. Any switch
  to another set records it and fixes it from then on. Treating "nothing kept" as unknown would call iOS for the
  primary on every new install's first launch (an alert on a fresh Lite install), which is worse.
- If iOS ever puts the primary back on its own (not seen), the kept set would make a switch to that same set look
  unchanged; switching to any other icon and back recovers.

## Phone check (iPhone 15 Pro, iOS 27)

This branch's Lite IPA (0.18.2 build 3440) installed with `tools/ui-15.sh install`; `app.icon` sent straight to the
bridge from the web inspector (pymobiledevice3 webinspector cdp, `ifizboxNative.call`), the same message Theme sends
when Match Theme goes off (a theme icon) and back on (the primary):

1. `{light: midnight, dark: midnight, onScreen: midnight}` -> iOS's alert with Midnight's icon,
   `{name: Icon-midnight, changed: true}` (ref/15/screens/b256-02).
2. `{light: classic, dark: gunmetal, onScreen: gunmetal}` (the primary) -> iOS's alert with Gunmetal's icon,
   `{name: AppIcon, changed: true}` (b256-03). Before the fix this answered changed false with no alert.
3. The same again -> `{name: AppIcon, changed: false}`, no alert (b256-04): the kept name answers unchanged, so
   launches don't bring the alert back.
4. Home Screen: the primary icon (Classic), not Midnight (b256-05).

## Not verified

- Through Theme's own Match Theme switch on screen: the check sent the bridge messages that switch sends, not taps.
  After the spec review I went back for the tapped version, but R54 held the iPhone 15's lock for the next 15
  minutes, so it wasn't run.
- Spec review: the own icon's switch after the self re-sign goes through `apply` too (app.icon -> applyShown ->
  switchTo -> apply), so it is kept like any other switch; seen in the code, not on the phone.
- The own-icon case from F329a (Icon-owna on screen, then the primary) and the a/b own-set pick with a kept name:
  it needs a picture added and the self re-sign + install round, which the Midnight -> primary pair covers for apply's
  check; `pick` gets the same `onScreen` reading.
- The jailbreak build (iPhone 7, iOS 15): its alternateIconName reads right, so `onScreen` returns iOS's reading
  there; not run on the 7.
- The known gap above (a set switched to by an older build): not reproduced.
