# B88: iFizBox's own package goes last in a queue run

## What I did
- `web/app/core/installrun.js` `runRows`: after the dependency-ordered lane is built, `selfLast` moves the row for
  iFizBox's own package (`PACKAGE` from `brand.js`, installs only) to the end, together with whatever needs it
  (transitively, via `neededBy`). Everything else keeps its order. Nothing left before it can need a row moved
  behind it: such a row needs iFizBox, so the row before it would need iFizBox too and would have moved as well.
  Downloads follow lane order, so iFizBox's .deb now downloads last too. That costs nothing, since three run at once.
- A removal of the package is left alone (removals stay first, as before).
- Tests in `installrun.test.js`: the order with a dependency of iFizBox (`lib`, stays before it), packages that need
  it (`plug`, `plugdep`, after it) and unrelated ones (`small`, `late`, moved before it). A removal isn't moved.
  A run with iFizBox + a small package installs the small one first.

## Choices
- I did only the JS half of the brief's fix idea. Holding `Replaced`'s close in `native/Sources/App.swift` while a
  helper run is going is outside the task's files. With the reorder, the only rows that can still be cut off are
  packages that depend on iFizBox, and in practice there are none. So I didn't file a follow-up.

## Not verified
- On the iPhone 7: queue iFizBox + a small package and see both install. Not done. The test needs a .deb of this
  branch installed on the 7 and then iFizBox updating itself through its own queue. Other slots overwrite the
  phone's .deb (memory note), and a self-install started from a build without the B84 helper breaks dpkg. That is
  too much risk for an unattended low-priority run. The unit tests cover the order and the run. The phone part
  (the app closing after dpkg writes the Info.plist) is unchanged and already known from B84.
