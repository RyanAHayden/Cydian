# B193: no regex lookbehind in the app (iOS 15 hang on Loading)

`core/tweaks.js`'s `LIBRARY_DESC` (from B185) used `(?<!…)`. Safari before 16.4 does not know lookbehind, so the
module throws a SyntaxError on parse, and everything that imports `core/tweaks.js` fails: the app hangs on Loading
on the iPhone 7 (iOS 15).

## Done

- Replaced the regex with `libraryDesc()`: skip leading whitespace, then walk up to 5 words (6 when the first is
  a/an/the, as the old optional article allowed), and at each word boundary test for `library`/`framework`, then
  test the text before it against `NOT_LIBRARY_BEFORE` (`…\s$`, the old lookbehind as an anchored-at-end regex).
- Checked it gives the same answer as the old regex: a scratch fuzz of 300,000 random descriptions (articles, bad
  words, `web-app`/`webapp`, `x+y`, double spaces and tabs, trailing text) in node: 0 differences.
- `web/app/no-lookbehind.test.js`: walks every shipped `.js`/`.mjs`/`.html` under `web/app` (not `*.test.js`,
  which run in node) and fails on `(?<=` or `(?<!`. Two tests (`core/appsync.test.js`, `screens/hintstyle-f314.test.js`)
  use lookbehind; they run only in node, so they're left alone.
- `core/tweaks.test.js`: a test of edge cases of the word-before check.

## Not verified

- Not run on the iPhone 7: this session had no phone test in the brief, and C21 already confirmed that removing the
  lookbehind makes the app load. The new code uses only syntax iOS 15 has (plain regexes, `let`, `for`).
