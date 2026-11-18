# F127: Installed like Cydia's (User | Expert | Recent, kinds, search)

## Cydia's Installed tab (findings)

- Source: Cydia's `MobileCydia.mm` `InstalledController` (cloned over `git://git.saurik.com/cydia.git`; the https
  side answered 503). Checked on the 4S: `ref/4s/screens/cydia-installed-user.png`, `-recent.png`, `-expert.png`.
- A bar-style `UISegmentedControl` **in the nav bar, in place of the title**: `User | Expert | Recent`, User
  selected at launch (not remembered). About 167 x 30 pt on the 4S. No right button unless something is queued
  ("Queue").
- Filters by `Package role_`, which comes from the first `Tag: role::…`: none 0, enduser 1, hacker 2, developer 3,
  any other role 4, cydia 7.
  - User: not uninstalled and role <= 1. Expert: role <= 3. Both sorted by name with A–Z sections and the index.
  - Recent: role < 7, sorted by `upgraded_` (the **birth time** of `/var/lib/dpkg/info/<pkg>.list`), newest first,
    one section per day (`kCFDateFormatterLongStyle`, e.g. "November 16, 2026"). Packages with no date get no section
    and don't show. No index.
- On the 4S's status file (198 packages), the role rule alone puts 89 in User, including bash, gzip, dpkg and cydia.

## What I did

- `core/installed.js`: each installed row has a `tier` (1 User, 3 Expert, 6 Recent only, 7 never), from Cydia's role
  rank plus the brief's rule. User also leaves out Essential packages (`Essential: yes`, `cydia::essential`,
  `Priority: required`) and dependencies (anything another installed package Depends or Pre-Depends on, by name, as
  an alternative, or through Provides). Also added `modeRows`, `typeRows` (Search's All/Tweaks/Themes/Apps through
  `sectionGroup`), `queryRows` (every word in the name, id, description or author, any case) and `dayHeaders`.
  On the 4S's status file: User 34, Expert 106.
- `core/catalog.js installed()` passes `tier` through. That's one field, in a file outside the brief's list, but the
  rows can't carry the tier without it.
- `screens/installed.js`:
  - The dpkg list (jailbreak root, the site's `#installed/dpkg`) puts User | Expert | Recent in the nav bar.
    Recent only shows where install dates can be read (`canReadDates`: the jailbreak app). The site's uploaded status
    file has no dates, so it gets User | Expert.
  - Under the Apps and Wish List rows: a search bar (Search's look) and Search's kind segments. Typing redraws only
    the list, so the field keeps its focus. "No matches." shows when nothing is left.
  - Without a jailbreak (the sideload app and the site's root): User (A–Z) | Recent (newest first, by day) in the nav
    bar, and the search bar under Install IPAs. There are no kind segments, since it's all apps. Edit, swipe Delete,
    the signature pills, My IPAs/Install IPAs and the Wish List row stay where they were.
  - The jailbreak app's Apps page (`#installed/apps`) is unchanged.
- `app.js`: a page's `nav()` can return `titleView`, an element drawn in the title's place (three added lines).
- `packages.css`: `.nav-segments` (167px, Search's `.scope-segment` look) and room for the A–Z index. The search bar,
  kind segments and top rows stop 24px short of the index, as UISearchBar does over an indexed table.

## Decisions (unattended)

- **F104's Name/Recent/Size bar is gone**, replaced by Cydia's control. Recent is now a mode. Size sorting is dropped:
  Cydia doesn't have it, and a third control row was too much. `installDates`, `installedBytes` and the `size` field
  stay. F104's sort tests went with it.
- Expert follows Cydia's code (role <= 3), not the brief's looser "everything dpkg has". Recent shows role < 7.
- Dependencies are a guess, because the status file doesn't say what apt auto-installed. The guess hides tweaks the
  user picked that others also need (Activator, AppList, AppSync on the 4S). Filed **F130**: read
  `extended_states` Auto-Installed in the app.
- The mode isn't remembered between launches, as in Cydia. The kind and the search last for the session.
- Kinds order: All, Tweaks, Themes, Apps, as in Search's scope bar.

## Checks

- `node --test web/app`: 791 pass. New tests are in `screens/installed.test.js` (User leaves out dependencies and
  Essential packages, Expert, Recent by date with day headers and without undated packages, kinds, search, which
  modes show where, the apps list's sections) and in `core/installed.test.js` (dependencies through alternatives
  and Provides, role tiers, modeRows/typeRows/queryRows).
- Headless Chromium (390x844 @3x) with a stubbed jailbreak shell on the 4S's real status file: User, Expert,
  Recent, Recent + Tweaks, and a search with the field still focused. No exceptions. Also a stubbed sideload shell
  with two recorded apps: User, Recent, search.

## Not verified

- On a phone: the jailbreak app on the iPhone 7, and the sideload IPA. The task doesn't ask for it and the phones
  are shared. The stubbed shells in Chromium stand in.
- The side-by-side look against the 4S is for the user, as the brief says. Here I only compared screenshots by eye:
  segment size and colours, Recent's day headers.
- Dark theme render of the nav segments: not looked at. They use Search's dark `.scope-segment` rules.
- The site's dpkg page (an uploaded status file) wasn't rendered in the browser. It runs the same `draw()` with
  User | Expert, which the tests cover (`dpkgModes(false)`).
