# B51: section index above the reload bar

B40 found that on Installed/Sources the A–Z index (packages.css `.section-index`, `bottom: calc(var(--tab-h) + 6px)`)
runs behind the reload bar while a reload shows, so Y, Z and # are covered.

## Decision: the index shortens above the strip

- The 4S's Cydia (1.1.x) has **no refresh strip** to compare with. A refresh there only spins the Sources tab badge
  (`CydiaTabBarController -beginUpdate` in MobileCydia.mm puts `indicator_` in the badge; `ref/4s/screens/
  cydia-installed-user.png` shows it). Its index is UITableView's, which always spans the table's visible bounds
  between the bars, so it is never covered. The strip is iFizBox's own (F150/F204), so the closest match to "never
  covered" is to end the index above the strip.
  (git.saurik.com returned 503; I read the same file in the sbingner/cydia mirror on GitHub.)
- The brief asked for "no layout jump mid-scroll". `.section-index` is absolute, so changing its `bottom` only moves
  its own letters closer together. The list, its rows and its scroll position stay put. `nav/sectionindex.js`
  measures the index on every touch (`getBoundingClientRect`), so touches follow the new height.
- There's no animation: `bottom` is a layout property, and the 120 Hz rule allows only transform/opacity. The
  letters close up in one step when `html.has-reload` is added (as the strip starts to slide up) and spread out
  again when it's removed (as the strip starts to slide down).
- Over a sheet the strip moves off the tab bar (B26), but the sheet covers the index then anyway, so there's no
  separate rule for that.

## What I did

- `web/app/packages.css`: `html.has-reload .section-index { bottom: calc(var(--tab-h) + 44px + 6px); }`, which is
  6 pt above the strip, the same gap the index keeps above the tab bar.
- `web/app/section-index-css.test.js` (new): the idle bottom stays `--tab-h + 6px`. The has-reload bottom is
  `--tab-h + <the strip's height from ios6.css> + 6px`, and the rule changes nothing but `bottom`.
- Checked on the iPhone 7 (0.9.7-1364, the phone's packages.css matched HEAD's md5). I swapped in only the new
  packages.css (backed up, `sudo -n install -o root -g wheel -m 644`) and closed the app from the switcher so it
  reloaded. Driven under lock B51. Screenshots are in `ref/7/screens/`:
  - `b51-inst-idle`: launch refresh running, Installed at the top. The index runs # to Z, and Z (y≈1115 px) is
    above the strip (top ≈1150 px). Before the fix, in B40's `b40-inst-reload-end-2`, Y and Z were behind it.
  - `b51-inst-after`: the reload has finished. The index is back to full height (Z at y≈1203) and the rows sit at
    the same y as in the previous shot, so nothing jumped.
  - `b51-inst-reload-tapz`: a second reload (Home > Reload), then Installed, then a tap on Z at its new spot. The
    list jumped to its end (vi, the last section), so the hit-test follows the shorter index. The last row clears
    the strip.
  - Afterwards I put the original packages.css back (md5 469e4f79… again), removed the temp files, closed the app
    from the switcher, pressed Home and unlocked.

## Tried and failed

- Cloning git.saurik.com/cydia.git returned 503. github.com/ajb/cydia doesn't exist. sbingner/cydia worked.

## Not verified

- Sources list: it shows the index only with enough sources. I checked Installed only. It is the same
  `.section-index` element and rule, so the geometry is the same.
- Dark theme and a home-indicator phone (safe-area inset > 0): the 7 has neither set up. The rule uses the same
  `--tab-h` variable as the strip, so the gap holds by formula. That isn't checked on a render.
- Holding the index (the grey `.held` backing) during a reload: I tapped it but didn't screenshot a hold.
- That the letters close up in the same frame the strip starts sliding: ui-7.sh shots are too slow to catch it.
