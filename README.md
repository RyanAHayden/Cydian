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
  | `CYDIAN_PORT` | `8080` | Host port compose publishes the app on (deploy.sh health-checks it) |
  | `CYDIAN_PROXY_HOPS` | `0` | Number of proxies in front of the app. Set it to `1` behind Nginx Proxy Manager, or every visitor shares one rate-limit bucket (the server would see the proxy's address) |
  | `CYDIAN_FETCH_RATE` | `60` | Repo fetches per visitor per minute |
  | `CYDIAN_PUSH_HOUR` | `16` | Hour (UTC) of the daily upgrade check and push (`cydian-push` service, `web/push.py`) |
  | `CYDIAN_VAPID_SUBJECT` | the site's origin | The `sub` push services see in the VAPID token (`https://…` or `mailto:…`) |
  | `CYDIAN_PUSH_MAX` | `10000` | Most opted-in subscribers the server keeps |
  | `CYDIAN_PUSH_EXPIRE_DAYS` | `180` | A subscriber whose Cydian hasn't been opened this long is deleted |

  Upgrade alerts (F10) keep their SQLite file and VAPID key in the `cydian-data` volume. The key is made on first
  use; losing it means every subscriber has to turn alerts off and on again. Run a check by hand with
  `docker compose -p cydian exec cydian-push python push.py run`.

## Deploy (TrueNAS + Nginx Proxy Manager, https://cydian.dev)

`deploy.sh` runs from a cron job on the server, in a clone used only for deploying. Each run fetches `main`. If
`main` moved, it checks out the new commit, runs `docker compose build` and `up -d`, and waits for `/healthz`. If
the new build doesn't come up healthy, it rolls back to the commit that was running, prints the logs and exits 1.
It won't retry that commit until `main` moves again or you run `--force`. When nothing changed it prints nothing,
so cron only emails you when something happened. `./deploy.sh --status` shows what's running and what's waiting.
`./deploy.sh --force` rebuilds anyway.

One-time setup on the NAS (TrueNAS SCALE, Docker and git are built in):

1. Clone into a folder used only for deploying: `git clone https://github.com/RyanAHayden/Cydian.git /mnt/SSD/cydian`.
2. Create `/mnt/SSD/cydian/.env`:
   ```
   CYDIAN_PORT=8095
   CYDIAN_PROXY_HOPS=2
   ```
   `CYDIAN_PORT` is the host port (TrueNAS's own nginx holds 8080). Two proxies sit in front (Cloudflare's orange
   cloud, then Nginx Proxy Manager), so the app trusts only the visitor address Cloudflare added to
   `X-Forwarded-For`. Use `1` without Cloudflare.
3. First deploy, as root: `/mnt/SSD/cydian/deploy.sh`. It should end with `healthy at <commit>`
   (`curl http://127.0.0.1:8095/healthz` answers `ok`).
4. Cron: **System → Advanced Settings → Cron Jobs → Add**. Command `/mnt/SSD/cydian/deploy.sh`, user `root`,
   every 5 minutes (`*/5 * * * *`). Leave "Hide Standard Output/Error" unticked so deploys and failures get
   emailed. Quiet runs print nothing.
5. DNS (Cloudflare, nameservers set at Namecheap): A records `@` and `www` → the home IP, grey cloud at first;
   the router already forwards 80/443 to the NAS.
6. Nginx Proxy Manager (`http://<NAS>:81`): **Proxy Host** `cydian.dev`, `www.cydian.dev` → `http` `<NAS LAN
   IP>` `8095`, Websockets off; **SSL**: request a Let's Encrypt certificate, Force SSL, HTTP/2. `.dev` is
   HSTS-preloaded, so the site only works over HTTPS. Then turn both records to Proxied (orange cloud),
   SSL/TLS mode **Full (strict)**; this hides the home IP.
7. Check from outside: `https://cydian.dev/healthz` answers `ok`. `./deploy.sh --status` warns if
   `CYDIAN_PROXY_HOPS` is missing from `.env`.

## License

GPL-3.0-or-later (see `LICENSE`). Anyone who distributes Cydian or a modified version has to release the
source under the same license.
