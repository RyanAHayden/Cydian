# B240: Lite notices a picked own icon its bundle lost

## What was done

- `web/app/appicon.js` `tellIcon`: when the shell answers `resign_needed` for an own icon (the tone on screen's), it
  hands the name to the offer (`screens/appicon.js offerResign`, lazily imported) instead of dropping it. Not
  retried (as before). `resignNeeded(e)` and `setResignHandler` (for tests) are new.
- `web/app/screens/appicon.js` `offerResign(name, store)`: if a Light/Dark setting still picks the picture, iOS 6
  alert **Use Your Icon Again?** ("This copy of iFizBox was installed without your icon, so the Home Screen shows
  iFizBox's own. Re-sign … or use the theme's icon."), buttons Theme Icon / Re-sign. Re-sign runs the same
  `installOnDevice({params: {selfIcon}, host: true})` as pickOwn's Install and keeps the pick; Theme Icon, or a re-sign
  that fails to start, sets every pick of that picture back to `theme`, and applyTheme's tellIcon switches the Home
  Screen off the placeholder set. Asked once per picture per launch.
- Tests: `appicon.test.js` (resign_needed goes to the offer, not the retry), `screens/appicon.test.js` (offer: Re-sign,
  Theme Icon, failure, asked once, nothing picks it).

## Choices

- The signal is app.icon's own `resign_needed` answer, not a separate `app.icon.ready` call at launch: the shell
  answers it for exactly the same state (`plan(...).write` in the sideload build, `OwnIcons.applyShown`), and
  applyTheme already sends app.icon at every launch, so no extra bundle hashing at start-up. It also catches a tone
  change to a mode whose own icon isn't in the bundle.
- The brief's note (an install iOS later fails or the user cancels after pickOwn returned true): the next launch's
  app.icon answers resign_needed, so the same offer covers it. No offer on a return from the background in the same
  launch: that is also when iOS's install prompt is up or installing, and asking then would race the update.
- No Swift change was needed (`native/Sources/AppIcon.swift` already answers resign_needed for this state).
- Only the tone on screen's pick is checked (Lite's app.icon applies only that one, as before). A lost own icon
  picked for the other tone is offered when the Home Screen's tone changes to it (its app.icon then answers
  resign_needed), not at launch.

## Spec review

- Found: pickOwn sets the pick before its Install, so its own tellIcon got resign_needed and the new offer popped
  "Use Your Icon Again?" over the re-sign that was starting (Theme Icon there would undo the pick mid-install).
  Fixed: pickOwn marks the picture as asked for this launch before it sets the pick; test added.
- Noted as asked-for extras, kept: a re-sign that fails to start puts the theme icon back (the brief's own
  alternative, so Settings matches the Home Screen); asked once per picture per launch.

## Checks

- `node --test appicon.test.js screens/appicon.test.js import-cycles.test.js`: pass. Gate: run by `done`.

## Not verified

- On the iPhone 15 Pro: not run. Reproducing needs an update from the AltStore source (or a fresh IPA install) over a
  Lite that has an own icon picked, and every self re-sign on that phone also drops its signing identity and pairing
  (T66), which then has to be put back by hand. The page path is covered by the unit tests; the shell's resign_needed
  answer for this state is F329a's, unchanged.
