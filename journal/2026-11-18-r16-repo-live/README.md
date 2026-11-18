# R16: B17's cydian.dev/repo/ checked live

B17 (`journal/2026-11-18-b17-repo-without-redirect`) merged at 11:29Z; Workers Builds had it live by 11:31Z. No
release has come out since B17 (latest is still v0.3.8, 09:26Z, Release without `Components:`), so the checks that
need one were split off as **R16a** (filed with `plan add R16`, low).

## Live Worker (curl from the desktop, 11:31Z)
| URL | Answer |
|---|---|
| `/repo/Release` | 200 `text/plain; charset=utf-8`, 464 B, no redirect, `max-age=300`, ETag + Last-Modified from GitHub; body is the v0.3.8 Release (not index.html) |
| `/repo/Packages` | 200 text/plain, 476 B; SHA256 matches Release |
| `/repo/Packages.gz` | 200 `application/gzip`, 346 B, **no Content-Encoding even with `Accept-Encoding: gzip, br`**; SHA256 matches Release; gunzips to Packages |
| `/repo/com.ryha.cydian_0.3.8-731_iphoneos-arm64.deb` | 200 `application/vnd.debian.binary-package`, 3847944 B, `max-age=3600`, 0 redirects; SHA256 `ae9053…0c4f` matches Packages |
| `/repo/InRelease`, `Release.gpg`, `Packages.xz`, `evil.txt`, `nope_1.deb` | 404 |
| `/repo/` | 200 text/plain |
| `/repo` | 301 → `https://cydian.dev/repo/` |

B17's open question about Cloudflare re-compressing: it does, for `Release` (text/plain) when the client offers br
(`content-encoding: br`), which apt/Zebra/Sileo decode; `Packages.gz` is left alone, as wanted.

## iPhone 7
- **apt**, with only `https://cydian.dev/repo/` as a source (own lists/cache dirs under /tmp): plain `apt-get update`
  fails with "is not signed" — so does the GitHub URI it replaces, and BigBoss and palera1n (the phone has
  `Acquire::AllowInsecureRepositories "0"`). Nothing new: the helper and daemon pass
  `Acquire::AllowInsecureRepositories=true` (`native/helper/README.md`, "Unsigned repos (N6)"). With that flag:
  exit 0, Release + Packages fetched, `apt-cache policy` lists 0.3.8-731 from cydian.dev; with `Trusted: yes`
  `apt-get download` fetched the 3.8 MB .deb (apt checks the hash).
- **Zebra 1.1.36** (installed from Procursus for this, then removed): `zbra://sources/add/https://cydian.dev/repo/`
  showed its Enter Source URL box (prefilled without the trailing slash); Add → listed as **Cydian**,
  `https://cydian.dev/repo/`, no error; its page shows All Packages 1 / Packaging 1
  (`ref/7/screens/r16-zebra-4.png`, `r16-zebra-5.png`). The first `zbra://` open only showed the notification
  prompt (first launch; tapped Don't Allow) and had to be opened again.

## Tried and failed
- My first two apt runs read every source on the phone: the remote shell is zsh, which doesn't word-split an
  unquoted `$O`, so the `-o` options arrived as one argument and were ignored. Ran the script under `sh -s` instead.

## Phone left as found
Zebra removed with `/var/mobile/Library/Application Support/xyz.willy.Zebra`; `/tmp/r16apt` removed; sources.list.d
unchanged (cydian.sources still names the GitHub URI, Cydian 0.3.8-791 installed); ui-7 lock released.

## Not verified (→ R16a)
- **Sileo adding cydian.dev/repo/**: the published Release still has no `Components:` line (v0.3.8 predates N11's
  fix), so Sileo 2.5.1 would drop it as B17 saw; not retried. Needs the next `tools/release.sh` release, which a
  task may not publish.
- **Zebra installing Cydian from it**: the repo offers 0.3.8-731 and the phone runs 0.3.8-791, so it would be a
  downgrade of the only test phone's Cydian; waits for a release newer than 791.
- **postinst moving cydian.sources to cydian.dev/repo/ on a real upgrade**: needs a published .deb built after B17
  (installing it from the repo also checks the upgrade path end to end).
