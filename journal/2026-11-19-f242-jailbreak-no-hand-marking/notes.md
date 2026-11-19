# F242: no hand marking in the jailbreak app

## What changed
- `web/app/screens/altstore.js`: new `handMarking(mode = detectMode())`, false in the jailbreak build.
  `markToggleApplies(app, { mode })` is false there, so the jailbreak app page gets no F210 toggle in the nav bar.
  `trackingSection` leaves out Mark as Installed, Mark as Not Installed and Change Installed Version in the
  jailbreak build. An installed app still shows its Installed Version (and the "follows this app" footer). An app
  that isn't installed gets no Installed section at all. The nav-label relabel still runs.
- The jailbreak Modify sheet already used Remove, not Mark as Not Installed (core/appqueue.js modifyActions), and
  settings.js has no Mark setting or row, so neither file needed a change.
- `altstore-marktoggle.test.js`: covers all three builds, both by passing the mode in and through detectMode
  with a fake `ifizboxNative`.

## Split: the + / x button became F242a (after B71a)
The brief asks for a + button that adds the app to the install queue, "the same job the row swipe would queue".
The jailbreak build has no queue that can hold an app yet. installQueue (core/queue.js) only takes apt
`install`/`remove` ops. The app queue signs, which the jailbreak build refuses. B71 found that app rows don't
swipe in the jailbreak build, and B71a (still open) is the task that builds the jailbreak app queue and its run.
If this task built the button, it would have to invent that queue in B71a's files. So I filed it as **F242a
--after B71a**: it reopens once B71a lands. This commit does the half that stands on its own: the hand marking
goes away.

## Not verified
- 3x zoomed render and the iPhone 7 check (tools/ui-7.sh): the only visible change is that the jailbreak page
  loses the toggle and the Mark rows. No new control was drawn, so there was nothing new to compare against the
  iOS 6 look. Both checks move to F242a together with the + button. I didn't put a .deb on the 7 for a change
  that only removes things.
- ios6.css/settings.js: not changed (see above).
