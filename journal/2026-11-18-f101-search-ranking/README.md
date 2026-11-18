# F101: search ranking polish

## What I did
- `core/catalog.js`:
  - `searchable(q)` (exported): a single Latin character (code point below U+0100) is not searched; one CJK (or
    other non-Latin) character is (Zebra's rule). It counts code points, so one emoji is one character.
  - `wordStart(s, q)` (exported): `q` appears after a character that is not a letter or digit. This is a new
    tier between prefix and substring, so "board" finds "Snow Board" before "Keyboard Plus".
  - Tiers are now: exact, prefix, word start, inside the name or id, author or maintainer, the rest. Within a tier
    the order is: name length closest to the query (`|name − query|`, Sileo), then how many counted sources list it
    (rankPopular's measure, from a cached id → count map rebuilt whenever the merge is), then name.
  - The sort uses one numeric key per hit (tier, length gap, sources). Rows arrive in name order (`rowsOf`) and
    Array sort is stable, so name breaks the last tie without calling the collator.
- `screens/search.js`: a single Latin character shows the empty-field hint and is not sent to the catalog or Canister
  (the same `searchable()`).
- Tests: two new ones (searchable/CJK; the tier order with every tie-break). Existing tests that searched one letter
  now use two. Flex/Flexer/FlexAll with Show Incompatible now orders Flexer before FlexAll (closer length).

## Timing (desktop node, `bench.mjs`)
R12's downloaded default sources were gone (an earlier session's scratchpad), so I timed a synthetic catalog
instead: 12,919 rows in four overlapping sources (all, 1/3, 1/5 and 1/7 of them), median of 21 runs, old (HEAD)
against new in the same process:

| Query | Hits | Old | New |
| --- | --- | --- | --- |
| one letter (s, t, y, a, e) | 2000 | 4.1–5.5 ms | 0 (skipped) |
| sn / th / er | 2000 | 1.9–2.4 ms | 1.3–1.7 ms |
| snowb… | 106–178 | 0.64 ms | 0.61 ms |

A first version with a comparator (tier, gap, Map lookup, then `compareNames`) doubled the cost of a 2000-hit sort
(sn: 2.0 → 4.8 ms). The numeric key fixed that. Hit counts are high because the synthetic names reuse 40 syllables.

## Decisions
- Canister keeps its own 2-character minimum (`core/canister.js searchUrl`, `screens/extras.js discoveryGroup`). Both
  files are outside this task's files, and Sileo also sends Canister only queries of 2+ characters. So one CJK
  character searches locally but not on Canister. Filed as a low follow-up.
- `docs/sileo-zebra.md` "Cydian today" still describes the old tiers. Not in this task's files; it's in the follow-up.

## Not verified
- **Real default sources:** the timings use synthetic data, not R12's 12,919 real rows (the files are gone, and I
  chose not to download 16 MB of third-party data again only to time a sort). The relative change (old vs new in the
  same run) is what matters, and the numeric-key sort is cheaper than the old collator sort for any hit set.
- **The Search screen in a browser:** not driven. The change there is one condition (`searchable(q)` instead of
  `!q` / `length >= 2`); covered only by reading the code and the core tests.
- **A phone:** not timed (AGENTS.md: no Cydian on the 4S; the iPhone 7 isn't named by this task).
