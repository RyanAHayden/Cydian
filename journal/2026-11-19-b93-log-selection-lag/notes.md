# B93: selecting text in the install log lagged while an install ran

## What was wrong
Every install log line goes through `nav/progress.js` `page.line` (queue console, queue run, app run, IPA installs,
progressHUD). It already batched one append a frame, but each frame:
- trimmed the oldest lines once the log held 1500 (`firstElementChild.remove()`), and removing the node a selection
  starts in resets the selection. In headless Chromium a Select All over the log was gone (0 characters) by the next
  frame on the old code. On the phone that is the selection and its Copy callout being rebuilt every frame.
- read `scrollHeight` right after appending (a forced layout every frame);
- appended every install-server byte line ("Sent bytes …; iOS has N of M bytes") as a new line, many a second.

## What changed
- `web/app/screens/progress.js` (new; the brief named this file): `createLogBuffer` queues the lines, at most one
  rAF, one `container.append` of a fragment, at most `PER_FRAME` (400) lines a frame, so a long held queue drains over
  a few frames. A raw line that only differs from the one before it in its numbers (`lineShape`) replaces it, in
  the queue or on screen (one node's text). While `selectionIn(out)` is true nothing gets appended, changed or trimmed;
  the page's `selectionchange` listener calls `release()` once the selection leaves the log. `selectionIn` also counts
  a range that covers the log from outside it (Select All over the page).
- `web/app/nav/progress.js` uses it (not on the brief's file list, but it's where the log lives): the scroll to the
  bottom writes `scrollTop = 1e9` and doesn't read `scrollHeight`. Explicit `flush()` (finish, filter, show) still
  sends everything at once, unless a selection holds it.
- `web/app/progress.css`: `.progress-out { contain: layout style }`.
- `queue.js` / `queue.css` left alone: the queue's console is this same page (`openProgress`). Its `.console-out`
  rule is CSS that nothing uses any more.

## Checks
- `web/app/screens/progress.test.js`: 200 lines in one frame make one rAF and one append; lines held while a selection
  is in the log (also when the selection starts after the frame was asked for), one append once it ends; byte lines
  merged in the queue and on screen; the max-lines limit while held; PER_FRAME chunking; `selectionIn`.
- Chromium profile (`harness.html` + `profile.mjs` here, served with `python3 -m http.server` from a folder holding
  `old/` = HEAD's web/app and `new/` = this branch's): a fake install feeding about 1500 lines a second (step, dpkg and
  byte lines, status and bar every line), Select All on the log after 1.5 s, a trace for the next 4 s, then the
  selection cleared:
  - new, 3 runs: 0 renderer tasks over 16 ms (worst 9–10 ms, the release frame), selection kept (98,510 chars),
    lines flow again after it ends.
  - old: the selection was gone at once (0 chars); one run had a 33 ms task.
- `tools/check.sh` (via agent-runner done).

## Not verified
- On the phone (Lite on iOS, the user's case): this task doesn't say to touch a phone, and the iPhone 7 runs the
  jailbreak build. Desktop Chromium is far faster than an iPhone, so the profile shows the shape of the change (no
  per-frame work under a selection, no lost selection), not real timings on iOS. How fast iOS's Copy callout shows up
  after Select All, and whether WebKit fires `selectionchange` for its own selection handles the way Chromium does,
  still needs checking on a device.
- The `contain: layout style` rule isn't measured on its own.
