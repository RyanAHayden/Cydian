# B241: iOS 13 style without iOS 6 parts

## What changed

- **Switch** (`web/app/ios13.css`): the geometry hooks block now sets iOS 7's `--sw-w: 51px; --sw-h: 31px;
  --sw-knob-size: 31px; --sw-travel: 20px` (F331's hooks), and the track gets the 15.5px corner. iOS 13's green
  and white knob stay. The knob is drawn 2pt inside its 31pt box (2px transparent border, `background` clipped to
  `padding-box`) so the track shows round it as on iOS 13. Its shadows got a -2px spread, so they follow the 27pt
  knob, not the 31pt box.
- **Signature pills**: `web/app/packages.css` now draws `.sig-pill` from five new tokens on `:root`
  (`--sig-pill`, `-soon`, `-expired`, `-unknown`, `--sig-pill-shadow`), set to the old gradients, so iOS 6 is
  unchanged. Both iOS 13 tones set them to flat systemGreen / systemOrange / systemRed / systemGray
  (`#34c759 #ff9500 #ff3b30 #8e8e93`, dark `#30d158 #ff9f0a #ff453a #8e8e93`) with no shadow. A look-only rule
  makes the text semibold (600) with no tracking. The capsule corner (10px on a 20px pill) is unchanged: iOS 13's
  pills are capsules too. tweaks.css's "2 Tweaks" / "Tweak Update" pills go flat the same way, through their
  existing `--tweak-pill*` tokens.
- **The "Upgrade" pill**: on Installed this is the row's `.cell-count` badge. Under iOS 13 it was already flat
  `--count` grey, so nothing changed.
- **The sweep found two more iOS 6 parts** on all four pages: the notification banner ("iFizBox X is out.", a black
  glossy strip with a clipped Upgrade) and the reload bar ("Building Searcher Cache", the semi-transparent black
  gradient bar). Both get flat iOS 13 tokens, copied from ios7.css's approach: White is `#f9f9f9` with a hairline
  and black text, OLED Black is `#1c1c1e` / `#000` with white text. The same look-only rules as ios7.css fix the
  banner's Upgrade (semibold tint, line-height 28px, so it is no longer clipped), the semibold title and the
  reload text, and use the grey spinner in White.
- `web/app/ios13-flat.test.js` (new): pins iOS 13's switch hooks to ios7.css's values. It checks that the pill
  rules read only tokens (no gradient left), and that both tones set flat pill, tweak-pill, banner and reload-bar
  tokens.

## Check

- `node --test` in web/app: 2700 pass before the new test file; the 3 new tests pass.
- Shots (3x, 402x874, headless Chromium, sideload mode on a fake bridge): `capture.mjs` here is B129's script plus
  a `signing.installed` fake with three apps (363 days, 3 days, expired). `mksteps.py` writes `steps.json`.
  Server: `worker/node.mjs` on 127.0.0.1:8931. Taken in iOS 13 White and OLED Black: `shots/{light,dark}-installed`,
  `-app` (Alpha's page), `-changes` (Needs Re-sign with the Expired pill), `-settings` and `-general` (switches).
  `shots/before-dark-installed.png` is main's glossy pills and banner, for comparison.
- iOS 6 and iOS 7 are unchanged: packages.css's tokens hold the old values, and every other change is scoped to
  `html[data-style="ios13"]`.
- `tools/check.sh`: run by `run done`.

## Slips

- I applied the ios13.css edit with a python heredoc instead of the edit tool (each replacement was an exact
  block from the file). I checked the result with the shots and the tests.

## Not verified

- **The grey "?" pill (Marked as installed) on screen**: the fake bridge has no marked app record, so no shot shows
  it. Its token is set in both tones, and the test checks that it is a flat colour.
- **The amber pill on screen**: the 3-day app still showed green, because the default re-sign window is shorter
  than 3 days. `--sig-pill-soon` is set and tested, but no shot shows it.
- **The tweak pills on screen**: no fake signed app has tweaks.
- **The open package page from Changes in sideload mode**: it did not load on the fake bridge (main shows the same
  blank page), so I used an Installed app's page as the "app page".
- **On a phone (WebKit)**: Chromium only. These are plain colour tokens plus a transparent knob border.
- **A held or dragged switch**: no capture held it. The held knob keeps `padding-box`, so its ring stays clear.
- **Still iOS 6 under iOS 13, left alone because none of it is gloss or emboss**: package rows' bold names
  (type), and Home's tiles (Home is not one of the swept pages; F331 tracks it). Sources' failed-row red badge
  (`.row-failed-badge`, packages.css) is still glossy under iOS 13. It is on Sources, outside this sweep, so I filed
  it as a follow-up.
