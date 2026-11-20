# B129: the swipe-to-install hint in the sideload build

User (iPhone 18 Pro, sideload IPA): the first-run hint (a list row eases left to show the green +) never shows; it
does in the jailbreak build.

## What I found

There is no mode or platform check that turns the hint off in the sideload build. `browse.js attachQueueSwipe`
sends the sideload build (`queueKind() === "apps"`) to `attachAppSwipe`, which calls `maybeHint` for app rows. In
headless Chromium with the native fake bridge in sideload mode (`capture.mjs --mode sideload`, T12's shell plus an
animation recorder), on a fresh profile the hint played on every package list I opened: a source's All Apps
(iFizBox's own source and Quantum Source, added through Sources > Add), Browse > Top 25, and Changes.

So whatever stops it on the phone comes from the phone's state or settings. `maybeHint` has four gates: the seen
flag (`ifizbox.swipeHint`), something already in the queue, a kept console log, and **Reduce Motion**. The last is
the one that differs between the two phones in a way the code cares about: the jailbreak build was seen on the
iPhone 7 test phone (default settings), the sideload build on the user's daily phone. With Reduce Motion on, F193
skipped the hint outright. The seen flag also sticks once anything is queued from an app page (`appQueue` add marks
it), which is by design (a hint for people who have never queued anything).

The second thing seen in Chromium: in the sideload build the first app row on screen is often iFizBox's own row
(it is first in Top 25 and Changes, and the only app on its own source). The hint always picked the top row and
always showed the green +, whatever that row's swipe would do.

## What changed

- `nav/rowswipe.js playHint`: a `fade` option. Nothing moves: the row's content dims to 25% so the control behind it
  shows, holds, and comes back (1.6 times the duration). Used when Reduce Motion is on, so the hint still shows
  without motion, instead of being skipped. `swipeHintDue` still takes `reduce` (its tests are unchanged); `maybeHint`
  no longer passes it.
- `screens/browse.js maybeHint`: takes an optional `actionOf(row)`. The sideload build's app swipe passes one
  (`appRowState` + `rowSwipeAction`, what the swipe's own `prepare` asks), so the hint goes on the top row on screen
  (of the first six) whose swipe actually does something, and shows that swipe's control (add / remove / cancel). A
  list where nothing swipes no longer uses up the session's hint. The jailbreak build's path is unchanged.

Checked in Chromium, sideload mode, Quantum Source > All Apps: the hint plays on the first row with motion
(`hint-motion.png`, a frame near its start) and as a fade with `prefers-reduced-motion: reduce` emulated
(`hint-reduce.png`: the row dimmed, the green + showing). With iFizBox reported installed (`INSTALLED=com.ryha.ifizbox`),
Top 25 still picks iFizBox's row: its swipe does have an action there.

Retake (worker on a local port, then):

```sh
APP_VERSION=99.0 node capture.mjs http://127.0.0.1:8829/ RAW p-v.json --mode sideload
REDUCE=1 APP_VERSION=99.0 node capture.mjs http://127.0.0.1:8829/ RAW p-v.json --mode sideload
```

`probe4.json` adds Quantum Source through Sources > Add; `p-all.json`, `p-b2.json` (Top 25, Play, New), `p-top.json`
and `p-v.json` build on it.

## Not verified

- The iPhone 18 Pro itself: it is the user's phone, not reachable from here, so I could not read its
  `ifizbox.swipeHint` flag or its Reduce Motion setting. The cause there is inferred: if Reduce Motion is off and the
  hint still never shows, the seen flag was set (something was queued from an app page, which by design ends the hint);
  clearing it needs a fresh install of the app's data. A person should open a package list on the 18 Pro with this build.
- The fade on a real WKWebView (only Chromium was checked).
- What iFizBox's own row's swipe does on a real sideload install (the fake answers `signing.installed` with nothing).
