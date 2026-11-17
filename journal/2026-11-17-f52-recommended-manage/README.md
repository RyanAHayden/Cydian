# F52 Recommended sources and Manage

## What I did
- **Recommended rows** (`screens/manage.js` renderRecommended, logic in `core/sourcelist.js` recommendedRows):
  a plain list drawn like Sources' rows: icon (the source's own, then F44's GitHub avatar, then the letter),
  name, URL (F44 subtitle), app count once known. On the right a round Add (`.rec-get` in `sources.css`): white
  pill, blue rim and bold blue text, filled blue with white text while held (own pointerdown/up `is-pressed`,
  since app.js's PRESSABLE list isn't on this task's files); "Added", greyed and disabled, once the source is
  listed (a trailing-slash twin counts).
- **App counts and icons**: an AltStore source not added yet, or one added but never loaded (a default the Sources
  tab hasn't refreshed), is read once per visit through `backend.text` + `parseSource("altstore")`
  (cached in a module Map). Tweak repos aren't fetched: their Packages is big and the rule says parse in a worker;
  they get CydiaIcon.png and a count only once added and refreshed.
- **Clickable rows**: an added source opens its real page (`#/sources/<key>`); one not added opens a preview,
  `#/sources/manage/recommended/<key>`: the URL, the curated "why", and the apps read from its JSON (icon, name,
  subtitle). Add in the preview's nav bar adds it and opens the real page. A tweak repo's preview says its
  packages show once added and refreshed (no Packages parse on the UI thread).
- **Games dropped**: `RECOMMENDED_GAMES` removed from `core/recommended.js` (git history keeps the list should Home
  want it); the test now asserts every entry is a source.
- **Manage's nav bar**: Add at the top right, the existing Enter APT URL alert (`addSource`).
- **Export > Copy to Clipboard**: `clipboardText(sources)`: the export lines without the header comment, one URL
  (or `deb` line for a dist repo) per line; copied with nav/menu.js copyText, then a "Copied" alert.
- Tests (`core/sourcelist.test.js`): icon fallback (avatar, own icon after a read, none), Added state from the
  listed record (counts, slash twin, Not Jailbroken hides tweak repos), inputs/seeds, clipboard text round trip.

## Checked
- `node --test web/app/core/sourcelist.test.js`: 17 pass.
- Headless Chromium at 390x844@2x driven over CDP (a scratch node script; `--screenshot` alone fires before the
  IndexedDB/proxy work ends): Recommended rows with avatars, counts (3, 6, 23, 4, 1), Added/Add, the held blue
  state; a tap on Add put AltStore in the list and turned its button to Added; the AltStore preview lists its 6
  apps with icons; Manage shows Add; Import & Export's Copy to Clipboard gives "16 sources on the clipboard".

## Tried that failed
- `chromium --headless --virtual-time-budget`: IndexedDB never resolves under virtual time, so async pages came
  out blank; `--timeout` didn't wait either. CDP with real waits worked.

## Not verified
- On the phone (the user tries it, per the brief): touch feel of the held state, and the clipboard on iOS
  Safari/WKWebView (headless clipboard writes may fall back to execCommand silently).
- A jailbroken device type's view (tweak repo rows, CydiaIcon.png icons): the headless profile was Not Jailbroken.
- The native app backend (`backend-native.js` `text`): only the site's backend was exercised.
- The preview's Add then opening the real page: Add from the list was clicked; the preview's nav-bar Add was not.
