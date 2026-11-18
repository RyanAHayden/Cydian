# F158: drop Home's "inspired by saurik's Cydia" line

- Removed the `.home-nod` paragraph from `renderRoot` in `web/app/screens/home.js` and its rule in
  `web/app/home.css`. Home's welcome is now two lines, "Welcome to Cydian" / "by Ryan Hayden (Fizlo)", still
  centred by F152's `.home-head > .home-words` rules (unchanged; `centre-text.test.js` still passes).
- About (`showAbout`) is unchanged: "Inspired by Cydia / by Jay Freeman (saurik) / Not affiliated with SaurikIT".
- No existing test expected the nod line, so none needed removing.
- New test `web/app/screens/home-welcome.test.js`: reads home.js/home.css source and checks there is no `home-nod`
  or "inspired by" on Home, the two welcome lines are still built, and About still credits Cydia and saurik.

Nothing tried that failed.

**Not verified**
- A rendered look at Home (browser or phone): with one line fewer the block is shorter, and F152's centring is by
  flex/auto margins, so it should stay centred down beside the icon, but no screenshot was taken in this unattended
  run. The test is source-level, not a DOM render, because Home's tests here don't run a DOM.
