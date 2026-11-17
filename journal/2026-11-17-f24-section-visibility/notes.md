# F24 Section Visibility

Cydia's Sections edit mode (docs/cydia.md "Sections and section icons", Edit mode): Edit on a Sections page
turns every row into a switch, and a hidden section drops out of every list, Search and Changes.

## What I did

- `core/catalog.js`: `setHidden(names)` (also a worker op). The new `visibleOf(key)` is `rowsOf` without the
  hidden sections, cached per key and cleared on load, remove or setHidden. `list`, `search` and `author` read
  from it, and so does Changes (catalog.js `changes()` builds on `list("*", "*")`).
  - `sections(key)` leaves hidden sections out, and `total` (the All Packages count) counts visible packages only.
  - `sections(key, { hidden: true })` lists every section, each with `hidden`. Edit mode uses it.
  - `package()` and `has()` still see hidden packages. That way a deep link and Depends links keep working.
  - `versions()` still files hidden packages as seen. Unhiding a section later then shows its packages under
    their real first-seen date instead of as new.
- `core/settings.js`: `hiddenSections` (`list`, `has`, `set(name, hide)`, `replace`), stored on the device as a
  sorted JSON list at `localStorage["cydian.hiddenSections"]`. It is device-only in every mode, as Cydia keeps it
  in its own prefs. Listeners hear `("hiddenSections", list)`, and only when the list actually changes.
  - I chose localStorage over IndexedDB because it is a short list of names, read synchronously at startup.
- `web/app/catalog.js` (not on the task's file list, but this is where the screens talk to the worker):
  `catalog.setHidden(names)` stores the set and sends it to the worker before the next question. The worker
  handles messages in order, so no answer can come from the old set. It also tells the Changes listeners, so an
  open Changes tab redraws.
- `screens/browse.js`:
  - At module load it hands `settings.hiddenSections` to the catalog and follows its changes. Every catalog user
    (Sources, Search, Changes) imports browse.js.
  - The Sections page's nav bar has Edit. Edit turns the title into "Section Visibility" and the button into a
    blue Done.
  - In edit mode every section is a row with its folder count and a switch (on = shown). As in Cydia's
    `SectionsController` while editing, there is no All Packages row.
  - Done redraws the normal list.
- `screens/settings.js`: added `createSwitch({ label, checked, onToggle })`, the same iOS 6 switch with a
  callback. I left `makeSwitch` untouched to keep the merge clean. The duplicated drag code is filed as **C1**.
- `packages.css`: not changed. The existing `.sections` and `.has-switch` rules lay the rows out correctly (see
  the screenshots).

## Checks

- `node --test web/app`: 89 pass. New tests:
  - catalog: hidden sections leave `sections`, `list`, `search` and `author`, and `total` drops. Edit mode lists
    hidden sections with their flag. `package`, `has` and `versions` still see the hidden packages. The hidden
    set survives a reload of a source. Clearing it restores everything. The worker accepts the `setHidden` op.
  - settings: sorted, persisted, deduplicated, notifies only on a change, and a corrupt stored value reads as
    empty.
  - browse: the Sections page's nav has Edit, and a package list's nav doesn't.
- Live in headless Chromium 155 against `web/app.py` with real network (5 default sources, 696 rootless
  packages), using `tools/visibility-shots.js` with F5's `drive.mjs`:
  - Edit shows "Section Visibility", Done, and 10 switch rows.
  - Switching off Addons (ControlCenter) and Applications stored both names.
  - After Done, both sections were gone and All Packages read 680 (696 − 3 − 13).
  - A search for CCVibration (in a hidden section) found nothing.
  - The hidden set survived a page reload. Switching both back on restored the original list, and the stored
    list was empty again.
  - No console errors.
  - Screenshots: `edit-mode-two-off.png`, `sections-after.png`, `edit-mode-dark.png`.

## Tried and dropped

- My first catalog test expected `author("jane dev")` to return nothing with Tweaks hidden. That expectation was
  wrong, because the same author also has a theme, which stays visible. I fixed the test, not the code.

## Not verified

- Not on a phone (4S or a modern iPhone) and not inside the native app. The task didn't call for the device. The
  switch is the existing settings switch, already checked there by F13 and its follow-ups.
- I didn't watch the Changes tab live with hidden sections. The fresh profile had no change history (the first
  load files nothing as new). The filter is the same `list("*", "*")` path the unit tests cover, and
  `setHidden` triggers Changes' reload listener.
- Other pages already open (a package list or a search result list deeper in another tab) keep their old rows
  until they are opened again. Cydia reloads its lists on every change. I judged that not worth live updates
  here.
- No drag gesture on the switch in this run. I only tested taps (click). The drag code is a copy of the settings
  switch's.
