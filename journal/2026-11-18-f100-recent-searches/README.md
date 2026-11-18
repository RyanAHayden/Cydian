# F100 Recent Searches

What was done:
- `web/app/core/settings.js`: `addRecent(list, query, max = 5)` (pure: trimmed, newest first, a repeat moves to the
  top case-insensitively, capped at `RECENT_MAX` = 5, junk entries dropped) and `settings.recentSearches`
  `{ list, add, clear }`, stored as JSON at `localStorage["cydian.recentSearches"]`; listeners hear
  `("recentSearches", list)` only on a real change.
- `web/app/screens/search.js`: with the field empty, a grouped "Recent" table replaces the hint note; Clear is a
  button in the group header. Saved on Search (form submit) and when a result link inside the results area is
  clicked (package rows and the Other Sources group). A tap on a Recent row puts the query in the field, saves it
  (moves to the top), runs it and blurs the field. `recentRows()` exported for the test.
- `web/app/packages.css` (not in the task's file list, but the Clear button needed a style): 4 lines next to
  `.search-note`, inserted mid-file to keep merges clean.
- Test: `web/app/screens/search.test.js` "F100".

Decisions (unattended): duplicates compare case-insensitively (Zebra-like; "Filza" and "filza" are the same search).
Typing alone never saves (only Search or opening a result), as the brief says.

Checked: headless Chromium at 320x568 @2x with three seeded queries, Not Jailbroken: the Recent table and Clear draw
as expected in the header row.

**Not verified**
- Tapping Clear and a Recent row in a real browser / on the 4S: only covered by unit tests of the data and row
  callbacks (no DOM in `node --test`); the screenshot shows the static drawing only. The 4S was not touched (task
  doesn't say to).
- Dark theme look of the Clear button: not rendered; it uses the header's own `--head`/`--emboss` variables.
