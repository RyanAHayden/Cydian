# B249 Clear's glass colours match the redrawn clear.svg

`native/icon/glass.py`'s `CLEAR` drew white lines on a faint white sphere (opacity .2) in a half-clear white rim:
the old Clear look that read as iOS's blank placeholder at 20 pt. It now takes `icon/clear/clear.svg`'s colours:

- fill: the frosted glass ramp, unchanged (`f6f7f9` to `c8cdd5`)
- rim: `e7eaee`, the middle of clear.svg's frosted ring gradient (`fbfcfd` to `d3d8df`), opaque
- sphere: `5f6c7e`, the middle of the smoked slate sphere gradient, opaque
- grid: white, and `CLEAR_STROKE = 34` (clear.svg's bold lines) in place of the shared 22

Checked: `native/test_icons.py` passes (colours stay unique per icon). Flattened the three layers over the fill into
one SVG (scratch script, not committed) and rendered it at 60 px beside clear.svg: a slate globe with white lines,
clearly not a blank tile.

Left as it was: the globe's size. clear.svg draws the globe 1.2x; the .icon shares one geometry for every icon, and a
light x Clear set would need per-appearance `position.scale` specializations. Clear is not in `CAR_SETS` yet, so
nothing ships from this; worth doing when Clear joins.

**Not verified**
- How iOS 26+ draws the Clear .icon (its Liquid Glass light, translucency on the globe group): needs actool on the MBA
  and a phone, and Clear is not in `CAR_SETS`, so no .car carries it.
- The flat preview has no frosted grey edge on the rim (clear.svg strokes it `#9aa3b0`); the rim is close to the fill
  in the flat render. The system's specular edge may supply it; not seen.
