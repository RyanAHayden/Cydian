# C2: remove unused .alt-history* styles

- Removed `.alt-history-item`, `.alt-history-top`, `.alt-history-notes` from `web/app/altstore.css`. F29 moved
  the app page's Version History to its own page (browse.js renderVersions), which doesn't use these classes.
- Checked: `grep -rn alt-history` over the repo (JS, HTML, CSS) finds no other use, and no class name is built
  from an `alt-history` prefix at runtime. Header comment updated to drop "the version history".

**Not verified**: no screenshot of the AltStore source/app pages after the change; with no element using the
classes, removing them cannot change rendering.
