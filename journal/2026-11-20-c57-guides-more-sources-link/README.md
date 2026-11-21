# C57 User Guides' More Sources link

- `screens/guides.js` LINKS.more: label "Recommended Sources" -> "More Sources", href
  `#/sources/manage/recommended` -> `#/sources/more` (built with `format` directly, not moresources.js's
  `moreHref`, so guides.js does not pull that screen into its imports).
- The two FAQ answers that name the page ("Adding a source", "Where do I find more sources?") now say More
  Sources too, since they sit right above the link row and would otherwise name a page that no longer exists.
  The file's header comment about Cydia's own Home ("below Recommended Sources") is history and stays.
- `screens/guides.test.js`: the href assertion is `#/sources/more`, plus a label check.
- `node --test web/app/screens/guides.test.js`: 15/15 pass. Full gate run by `run done`.

Nothing tried that failed.

**Not verified**: the page on a phone or in a browser (a label and href change, covered by the unit test).
