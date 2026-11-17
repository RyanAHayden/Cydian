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

- Locally: `tools/check.sh` once (it builds `.venv`), then `.venv/bin/python web/app.py` → http://127.0.0.1:8080.
- In Docker: `docker compose up --build` → http://127.0.0.1:8080. Settings go in `.env` beside `compose.yaml`:

  | Variable | Default | What it does |
  | --- | --- | --- |
  | `CYDIAN_PROXY_HOPS` | `0` | Number of proxies in front of the app. Set it to `1` behind Cloudflare Tunnel, or every visitor shares one rate-limit bucket (the server would see the tunnel's address) |
  | `CYDIAN_FETCH_RATE` | `60` | Repo fetches per visitor per minute |
  | `CYDIAN_PUSH_HOUR` | `16` | Hour (UTC) of the daily upgrade check and push (`cydian-push` service, `web/push.py`) |
  | `CYDIAN_VAPID_SUBJECT` | the site's origin | The `sub` push services see in the VAPID token (`https://…` or `mailto:…`) |
  | `CYDIAN_PUSH_MAX` | `10000` | Most opted-in subscribers the server keeps |
  | `CYDIAN_PUSH_EXPIRE_DAYS` | `180` | A subscriber whose Cydian hasn't been opened this long is deleted |

  Upgrade alerts (F10) keep their SQLite file and VAPID key in the `cydian-data` volume. The key is made on first
  use; losing it means every subscriber has to turn alerts off and on again. Run a check by hand with
  `docker compose -p cydian exec cydian-push python push.py run`.

## Deploy (TrueNAS + Cloudflare Tunnel)

`deploy.sh` runs from a cron job on the server, in a clone used only for deploying. Each run fetches `main`. If
`main` moved, it checks out the new commit, runs `docker compose build` and `up -d`, and waits for `/healthz`. If
the new build doesn't come up healthy, it rolls back to the commit that was running, prints the logs and exits 1.
It won't retry that commit until `main` moves again or you run `--force`. When nothing changed it prints nothing,
so cron only emails you when something happened. `./deploy.sh --status` shows what's running and what's waiting.
`./deploy.sh --force` rebuilds anyway.

One-time setup on the NAS (TrueNAS SCALE, Docker and git are built in):

1. Make a dataset for the clone (e.g. `tank/apps/cydian`) and clone into it:
   `git clone https://github.com/RyanAHayden/Cydian.git /mnt/tank/apps/cydian`.
   If the repo is private, add a read-only deploy key and clone over ssh.
2. Create `/mnt/tank/apps/cydian/.env` with `CYDIAN_PROXY_HOPS=1`. Cloudflare's edge puts the visitor's
   address last in `X-Forwarded-For`, and cloudflared passes it through unchanged. With one hop the app trusts
   only that last entry, so a visitor can't spoof it. Add one more for every reverse proxy you put between
   cloudflared and the app.
3. First deploy, as root (or a user in the `docker` group): `/mnt/tank/apps/cydian/deploy.sh`. It should end with
   `healthy at <commit>`. Check with `curl http://127.0.0.1:8080/healthz` (it answers `ok`).
4. Cron: **System → Advanced Settings → Cron Jobs → Add**. Command `/mnt/tank/apps/cydian/deploy.sh`, user
   `root`, schedule every 5 minutes (`*/5 * * * *`). Leave both "Hide Standard Output" and "Hide Standard Error"
   unticked so deploys and failures get emailed. Quiet runs print nothing.
5. Cloudflare Tunnel: in the Cloudflare dashboard go to **Zero Trust → Networks → Tunnels → Create a tunnel**
   (Cloudflared) and copy the tunnel token. On TrueNAS, install the **Cloudflared** app from Apps with that
   token. Back in the tunnel, add a **Public Hostname** (e.g. `cydian.example.com`) with service
   `HTTP` → `http://<NAS LAN IP>:8080`.
6. Check from outside: `https://cydian.example.com/healthz` answers `ok`. Then add a repo in the web UI.
   `./deploy.sh --status` warns if `CYDIAN_PROXY_HOPS` is missing from `.env`.

## License

GPL-3.0-or-later (see `LICENSE`). Anyone who distributes Cydian or a modified version has to release the
source under the same license.
