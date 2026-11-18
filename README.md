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

## Run it

- Locally: `cd worker && npx wrangler dev` → http://127.0.0.1:8787 (the website, its fetch proxy and the install
  server, as on cydian.dev). Or any static server on `web/app/` for the pages alone.
- Tests: `tools/check.sh` (`node --test web/app`, `node worker/test.mjs`, the native Python tests, and the native
  builds where their toolchain is set up).

## cydian.dev: one Cloudflare Worker (`worker/`)

cydian.dev is a single Cloudflare Worker, with no server of our own:

- the website: `web/app/` as static assets, revalidated on every load (a phone never keeps an old file);
- `/api/fetch`: the website's fetch proxy (APT and AltStore sources don't let a page read them);
- `/sign/manifest`, `/sign/host`: what iOS needs when the app signs on the phone (also at sign.cydian.dev).

Deploys: Cloudflare builds every push to `main` itself (Workers Builds, connected to this repo; deploy command
`tools/buildinfo.sh && cd worker && npx wrangler deploy -c wrangler.cydian.toml`). By hand, from a clean checkout:
the same command (needs `npx wrangler login` on the cydian.dev Cloudflare account once). Anyone can run their own copy for free and point Cydian at it:
`worker/README.md` (a Deploy to Cloudflare button).

Signing happens only in the app, on the iPhone. The website signs nothing: it browses, and hands apps to Cydian or
another sideloader.

## License

GPL-3.0-or-later (see `LICENSE`). Anyone who distributes Cydian or a modified version has to release the
source under the same license.
