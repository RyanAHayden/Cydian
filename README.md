# Cydian

A package manager with the iOS 6 Cydia look, for modern iPhones.

- **Web**: browse APT repos and AltStore sources, add sources, check for upgrades. Public, no login.
- **Jailbreak app**: installs `.deb`s through a root helper, with background upgrade checks.
  The same app also builds as a sideload IPA for AltStore-style sources; why there is no separate
  non-jailbroken app: `docs/ipa.md`.
- **Shortcuts**: daily upgrade checks and auto-updating.

Work is planned in `plan/TODO.md` and run with [agent-runner](https://github.com/FIZL0/agent-runner):
`tmux new -s cydian agent-runner run 3`.

Not affiliated with Cydia or SaurikIT. No Apple or Cydia artwork is included; the look is redrawn in CSS.

## License

GPL-3.0-or-later (see `LICENSE`). Anyone who distributes Cydian or a modified version has to release the
source under the same license.
