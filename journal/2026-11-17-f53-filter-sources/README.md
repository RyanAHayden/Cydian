# F53: Search's Filter panel, Source list

## What
- `web/app/screens/search.js`: new `sourceChoices(list, type, order)`, which builds the Source rows from
  `sourcesFor` (so Not Jailbroken shows AltStore sources only, like the Sources tab), in Manage > Sources' order
  (`orderSources(loadOrder())`) and by `displayName`. The panel uses it.
- Why the names were different: both screens read the same `backend.sources()` and use `displayName`. But an
  AltStore source seeded by URL (F28) has no `name` until it has loaded. Then `displayName` falls back to its host
  or GitHub user ('alt.crystall1ne.dev', 'chachillie'). The Sources tab loads those on its first visit
  (`loadNeverLoaded`, F43); the Search panel didn't. Now the panel calls `loadNeverLoaded` quietly (no HUD, with its
  own `tried` set, so each source is asked once per session) and redraws once they have loaded.
- A picked source that the current device type hides goes back to All Sources when the panel opens.
- Test: `search.test.js` "F53", with the list under Not Jailbroken, both jailbroken types, a set order, and the
  fallback name for a source that hasn't loaded.

## Not verified
- On a phone or in a browser: I didn't open the panel in a real UI. That needs a browser session; the pure list
  logic is covered by the node test. I also didn't see the quiet first load redraw the names live.
- If the Sources tab and the panel both start a first load at the same moment, the source is fetched twice
  (harmless: the same record is written twice). I didn't add a shared lock.
