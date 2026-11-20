# C48 Era readiness: the small stylesheets

Goal (docs/eras.md, after C44): altstore, progress, reviews, guides, freeid, myipas, signing, signsheet, extras,
queue, tweaks, notiphone, account and manage .css get their look in look-only stretches, mixed rules split with the
layout kept in each file, and iOS 6 decorations behind tokens. No visible change in iOS 6.

## What changed

Every one of the 14 files, same shape as each other:

- **Split rules.** Each mixed rule became two rules with the same selector: the layout half (box, position,
  flex/grid, overflow, wrapping, cursor/touch, transitions and animations, `clip-path`, `object-fit`,
  `image-rendering`, `text-wrap`, `-webkit-tap-highlight-color`, `vertical-align`) stays where it was, in its
  section; the look half (ios6-css.test.js's `LOOK`) goes into a `/* ==== look-only { ==== … */` stretch right after
  the section's layout rules. Sections and their comments are kept; comments that describe the look moved with the
  look rules where that read better. Rules that were all look or all layout moved whole. No selector changed.
- **Decoration tokens.** Each file's first stretch opens with a `:root` of the iOS 6 decorations its rules paint:
  gradients and glosses (button, badge, bar, progress bar), gloss edge colours, box and text shadows, embosses and
  drop-shadow filters. 89 token definitions in all (80 names: tweaks.css repeats 9 of myipas.css's, below), named after the part (`--alt-*`, `--alert-btn-blue*`, `--progress-*`,
  `--qr-bar`, `--qr-fill`, `--review-*`, `--guide-*`, `--free-*`, `--price-btn*`, `--walk-*`, `--ss-*`,
  `--featured-title-*`, `--console-*`, `--tweak-pill*`, `--notiphone-icon-shadow`, `--manage-*`). None of these names
  is used anywhere else on main (checked with git grep). Plain colours stay literal: an era restyles them with a look
  rule, and the dark rules already read `--dk-*` tokens.
- **Shared price button.** tweaks.css's ADD button draws iOS 6's App Store price button with myipas.css's values,
  so both read the same `--price-btn*` tokens, and both files define them (same values): either sheet can load
  without the other (both are lazy, nav/motion.js loadStyle), and an era sets the tokens once for both.
- **Left as they are, on purpose:** glyph and badge pictures drawn as SVG data URIs (the toggles' checkmark/plus/X,
  the error and warning badges, the stop disc, the warning triangle, the done/failed ticks): they are icons, and a
  look rule in an era can swap `background-image`; a per-style icon map is C51's. The `.dm-*` pictures of today's iOS
  (freeid.css) keep their own `--dm-*` colours: they draw modern iOS on purpose in every style. Dark rules keep their
  `--dk-*` tokens and selectors.

## How "no change" was checked

1. **Cascade proof, every page and state** (`cascade.mjs`, this folder). For each file it takes main's version and
   the working copy, drops comments, substitutes the new `:root` tokens back into the values, and compares two
   ordered lists: every look declaration and every layout declaration, each as (at-rule, selector, property, value,
   !important), plus `@keyframes` steps on their own. Look and layout properties never share a shorthand, and the
   files keep their place in the load order, so equal lists mean every element gets the same winner for every
   property: same specificity, same file, same relative order. Result on all 14 files: **same cascade** (look/layout
   declarations: altstore 52/92, progress 76/139, reviews 97/89, guides 58/56, freeid 82/78, myipas 52/59, signing
   51/50, signsheet 34/43, extras 11/33, queue 33/38, tweaks 37/36, notiphone 13/30, account 2/11, manage 16/38; see
   `cascade.log`). Checked that it does fail on a real change: against `b0561e35~1` it reports signsheet.css's
   removed `width` transition. This covers the pages the screenshots can't open (sheets, the install progress and
   queue run, reviews, AltStore pages, pressed states).
2. **3x screenshots + computed styles** (`shots.mjs`, `diff.py`, copies of C44's). shots.mjs keeps C44's 44 shots
   and adds the small sheets' pages: in the app shell for all six themes User Guides (index, OpenSSH, Copying Files,
   FAQ, Password), Settings > Account, Settings > Signing and How Signing Works, Sources > Manage, Installed > My IPAs
   and Browse; on the website (Classic and OLED Black) OpenSSH, Account, Signing, How Signing Works, My IPAs, Manage
   and the Not-an-iPhone page (an Android user agent). Each shot also writes `<name>.cover.json`, the visible
   elements each small sheet's classes match. Base: a detached worktree of this branch's merge base (0439559b).
   Results under "Result" below.

`node --test web/app`: 2575 pass (ios6-css.test.js's "every look-only stretch in web/app/*.css paints only" now
reads 33 stretches in these 14 files). `tools/check.sh` runs in `run done`.

## Result

- cascade.mjs: **same cascade** on all 14 files (`cascade.log`).
- shots.mjs base (0439559b) vs this branch: **same**, all 124 shots, 0 px and 0 computed-style differences.
- What the shots showed of the small sheets (`cover.txt`): guides (22 shots), progress's `.pl` lines (14, in the
  guides' terminal panels), signing (How Signing Works on the website) and notiphone. Account, Manage, My IPAs and
  Browse open, but empty: the fake bridge has no account, sources, IPAs or featured banners, so their own rules
  draw nothing there. Those rules, and the other sheets, rest on the cascade proof.
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

## Eras and lazily loaded sheets

Several of these sheets load late (nav/motion.js loadStyle: signing, signsheet, myipas, freeid, tweaks), after any
era sheet linked in index.html, and their `:root` token blocks then come later in the cascade. An era therefore
sets these tokens the way docs/eras.md already says to set colours, on `html[data-style="…"][data-theme="…"]`,
which outranks `:root`. A bare `:root` token in an era would lose to a sheet that loads later. tweaks.css repeating
myipas.css's `--price-btn*` values changes nothing here: both are `:root`, and the era's selector outranks both.

## Spec review (fresh subagent, diff + brief only)

- Nothing lost or wrong: every token matched the literal it replaced and no stretch holds layout.
- Missing: the shot results and cover.txt (the runs had not ended when the review started): filled in above.
- Routes were added to a C48 copy of C44's shots.mjs rather than to C44's own: kept on purpose, so C44's journal
  stays a record of what C44 ran; the copy runs C44's 44 shots too.
- Pages without screenshot routes (AltStore, reviews, sign sheet, Free Apple ID, progress/queue run, Confirm, Add
  Tweaks): the fake bridge can't open them with data; covered by cascade.mjs, listed under Not verified.
- Not asked: cascade.mjs (kept: it is the check for those pages) and a two-line note in each file's header saying
  where layout, look and tokens are (kept: it points the next reader at the stretches).
- Risk named: tweaks.css's repeated `--price-btn*` at `:root`. Answered under "Eras and lazily loaded sheets".

## Tried and failed

- First run of cascade.mjs flagged progress.css: its `@keyframes progress-blink` step (`opacity`) counted as a look
  declaration, and it now sits before the look stretch. Keyframe steps aren't in the cascade with the rules, so the
  checker compares them as a list of their own.

## Not verified

- **Safari / iPhone WebKit**: everything ran in Chromium. The change only splits rules and puts values behind
  custom properties that resolve to the same text; the one construct worth a look on a phone is a token holding a
  multi-value `border-color` (`--ss-cancel-edge: #2c1c1c #6b1516 #721819`, signsheet.css's red Cancel). The task did
  not ask for a phone, and the phones are driven only when a task says so.
- **Pixels of pages the fake bridge can't open, or opens empty** (AltStore source and app pages, reviews and the
  Write a Review sheet, the sign sheet, Signed Apps, Free Apple ID, the install progress page and queue run, Confirm,
  Add Tweaks, the QR sheet, an account's key, Manage's rows, My IPAs' rows, featured banners, wide screens): covered
  by the cascade proof only, not by screenshots; seeding the fake bridge with data for each was more than the proof
  needed. See `cover.txt` for what the shots did show of each sheet.
- **docs/eras.md** still lists "the small ones" under "Not yet clean": it is not in this task's files, and C45-C47
  edit the same list; filed as a follow-up to update it once they land.
