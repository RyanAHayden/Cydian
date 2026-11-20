# F326 Per-theme glossy Home-header icons

- Brought back what F322 built and its review dropped (commit 7dec0be4, reverted except its journal note):
  `tools/icons.sh` wraps each theme's plain and LITE master in iOS 6's rounded square (`ios6()`, rx 180/1024, as
  `icon-lite-glossy`) and renders `web/app/icons/themes/<theme>/icon{,-lite}-glossy-{76,152,228}.png`.
- `docs/concepts/icon/README.md` lists the glossy sizes again (one line, describes what is built).
- Test: `ThemeIcons` checks every theme's glossy sizes; `test_classic_is_the_real_icon` now checks the flat 180/192/512
  and the glossy 152 / LITE glossy 228 against the root icons.
- Ran `tools/icons.sh`: the restored PNGs came out byte-identical, so the committed files are current. It also
  rewrote the launch images (`web/app/icons/launch/`), not this task's; restored those.

**Not verified**
- The Home header does not use these yet (the task is only the files); nothing on a phone to check.
