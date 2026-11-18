# F165: descriptions in their own group with More/Less

## What I did
- New `web/app/screens/description.js`: `descriptionGroup(text)` gives a grouped section with a "Description"
  header, one cell holding the text (pre-wrap, so line breaks stay; http(s) URLs become `target=_blank` links, with
  trailing punctuation left out), and for a long text a "More" row (Permissions' `.perm-more` look) that opens it in
  place and becomes "Less" (with the up chevron). On Less the page scrolls so the row stays under the finger, as Show Fewer does.
- Collapsed = `.desc-text.collapsed` in `packages.css`: max-height 140px (6 × 20px lines + 10px padding), the 6th
  line faded with a mask-image gradient. Opening and closing switch at once, with no height animation (AGENTS: animate only
  transform/opacity).
- Whether to fold: first a length guess (`estimateLines`: 40 chars/line, each paragraph a new line; fold when more
  than 7 lines, because a toggle that hides one line costs more than the line). In a browser, once the page is laid out
  (rAF, up to 30 frames until it's attached) the real height decides: a text that fits loses the toggle, and one that
  overflows but the guess let through gets it.
- Used on: the IPA app page (`app.localizedDescription`), the AltStore source page (`meta.description`), and the
  jailbreak package page (screens/browse.js: the apt description card and the dead-Sileo-depiction fallback, which
  used the same card). The task's mention of screens/depiction.js was a guess. The package page's card lives in browse.js.
- Tests: `screens/description.test.js` (fake DOM): long → collapsed with More; More → Less → More; short ones have no
  toggle; links; the line estimate.
- Looked at a headless Chromium render (320px wide, 2x) of collapsed, short and opened groups: the fold, fade and
  rows look right.

## Not verified
- On a real phone or in the app's WKWebView: not run. The task touches no phone. The layout check (`requestAnimationFrame`
  plus scrollHeight) runs only in a browser, so node tests cover only the length guess.
- Against YouMod's real source text: no network fetch of the AppTesters source, so I tested with a YouMod-like long text.
