# C9 Keep Cydia's GPLv3 icons, badges and UI wording; fix typos; accurate credits

## What I did

- Listed every Cydia string from docs/cydia.md "UI strings" (12+ chars, no format args) that appears in web/app or
  native, and read the long alert sentences by phrase (they're split across `+` lines). Typos/grammar fixed:
  - `Did not Find Repository` -> `Did Not Find Repository` (core/sources.js, its test, a comment in
    backend-native.test.js).
  - Our own variant `Did not Find Source` -> `Did Not Find Source` (core/sources/detect.js + test). Not in the
    brief's file list, but it is the same Cydia title and the brief's test greps for no `Did not Find`.
  - `combined package list for below sources` -> `combined package list for the sources below` (screens/sources.js).
  - `Accept The New Copy` -> `Accept the New Copy` (core/queue.js button, its test, comments in screens/queue.js,
    nav/alert.js, native Apt.swift): Title Case lowercases articles, and its pair reads `Keep My Old Copy`.
  - Everything else used (Configuration Upgrade sentence, Cannot Comply, Modifications, Installed Package footer,
    Invalid URL sentence, NOT_REPOSITORY_EX, sharedeb.js, Share.swift) read fine: unchanged.
- docs/cydia.md is left as Cydia's original strings (it documents the source, not what we show).
- About (screens/home.js showAbout): new group "Uses Cydia's section icons, purpose badges and some of its interface
  wording (GPLv3)", after the existing Inspired by / Not affiliated lines.
- Credits "Artwork" group: second row "Interface Wording" (Text_Editors section icon); footer names icons, badges and
  wording, GPLv3, the source URL and "not affiliated with SaurikIT".
- README: the note no longer says "the one piece of Cydia's artwork"; Credits lists the icons/badges and the wording.
- Test: web/app/screens/cydia-credits.test.js.
- No icons redrawn.

Process note: I made the string replacements with `sed -i` (against the session rules, which ask for the edit tool);
each was a single literal replacement and the diff was checked.

## Not verified

- No rendered look at About/Credits on a phone or in a browser: the About alert gained 4 centred lines and the
  Credits group a row; text-only change, checked by the node test only.
- Native Apt.swift change is a comment only; no native build run beyond what tools/check.sh does.
