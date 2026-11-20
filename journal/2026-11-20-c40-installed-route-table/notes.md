# C40 Installed tab route table

- `web/app/screens/installed.js`: navInfo() and render() no longer branch on pageKind(route) with if-chains; one
  `ROUTES` list of `{ match, nav, render }` keyed by pageKind's kinds (browse, myipas, app, wishlist, apps, dpkg),
  like Home's (C29). The apps and dpkg bars moved into `appsNav(view)` / `dpkgNav(view)` unchanged. nav() keeps its
  own work (C25's view, the Wish List / Select… button) and still calls navInfo().
- pageKind() is unchanged (exported and used by onPageOpen and the manage code), so every kind it returns has an
  entry; no default entry is needed.
- Search/Changes/Sources left as they are, per the task.
- Checked: `node --test web/app/` 2525 pass; the gate via `run done`.

**Not verified**: no browser or phone run of the Installed tab; the change is a mechanical move of the same calls,
covered by the unit tests that render Installed's pages.
