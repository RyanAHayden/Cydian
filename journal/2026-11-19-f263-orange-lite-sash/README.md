# F263 Sideload IPA icon: orange LITE sash

The user found the red LITE sash read as LIVE. Changed the sashed LITE colours in `tools/icons.sh` to
`#ffa53b` → `#e8660a` (as in the preview) and updated the header comment, then ran `tools/icons.sh`.

- `git status` after the run: only `native/icon/AppIconLite60x60{@2x,@3x}.png` and
  `web/app/icons/icon-lite-glossy-{76,152,228}.png` changed; the plain and WEB icons came out byte-identical, so
  there was nothing to restore.
- Looked at the 3x app icon and the 228 glossy icon: the sash is orange, the white LITE text is still readable.
- `tools/check.sh` passed through `agent-runner done`.

Nothing failed along the way.

**Not verified**: how the icon looks on a phone's home screen. The task asked for no phone test, and the
sideload build has to be re-signed and installed before the icon shows up.
