# F296: the exposure alert names only a fix the phone can get

## What changed

- `core/ios-exposure.js`: `LAST_IOS_LINE` / `lastIosLine(machine)`, the newest iOS line (major.minor) per hw.machine
  for the models that stop on a listed line: 6s/6s Plus/SE/7/7 Plus/iPod touch 7 → 15.8, 8/8 Plus/X → 16.7,
  XS/XS Max/XR → 18.7. Others (iPhone 11 and later, iPads, unknown) take any update.
- `exposureOf(ios, list, { machine | lastLine })`: `fixed` is the newest fix among the entries within the model's
  reach. If that version is itself on the list, the newest reachable fix of *its* entries follows, until a clean
  version; none → `fixed: null`, and `stuck: true` when the model is known.
- `exposureAlert`: stuck says "No iOS update for this iPhone fixes it." with only I Understand (no Software Update).
- `screens/safety.js` `installSafety`: new `machine` dep, default asks the shell's `app.info` `machine`
  (Bridge.swift already returns it). The site can't tell the model, so it keeps any-update behaviour.

## A decision taken unattended

Following the chain changes the named fix even with no model known: 16.0-16.7 now says **iOS 17.3**, not 17.0
(17.0 closes landa but Coruna's Gruber runs on 17.0-17.2.1), and 14.x says 15.8.7, not 15.7.7. Naming a version
that is still on our own list as "fixes it" is the same bug class as the task (a fix that doesn't fix), so it went
in here; a test checks every named fix is on no listed version.

## Tried / failed

Nothing failed. (One slip: the core test edits were made with a python heredoc instead of the edit tool.)

## Not verified

- The per-model last iOS lines come from memory of Apple's support lists (8/X on 16, XS/XR not on 26, 6s/7 on 15),
  not re-checked online this session.
- Not run on a phone: the iPhone 7 is a jailbreak build (alert is quiet there) and no iPhone 8/X is available;
  the `app.info` `machine` wiring is covered by a unit test with a fake only.
