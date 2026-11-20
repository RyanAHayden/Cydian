# C39: drop the stale .console-scroll selector

- Removed the `.console-scroll` padding rule from wide.css's big-screen media block (and the comment's mention of
  "console scrollers"), `.console-scroll` from ios6.css's `html.has-reload :is(...)::after` list, and from
  nav/statusbar.js `SCROLLERS`. No element carries that class since the console became nav/progress.js's
  `progress-*`, which all three lists still cover via `.progress-scroll`.
- Check: `grep -rn console-scroll web/ native/ tools/ tests/` finds nothing; gate run by `run done`.

Nothing tried that failed.

**Not verified**: no on-device or browser look; the removed selectors matched no element, so there is nothing to see.
