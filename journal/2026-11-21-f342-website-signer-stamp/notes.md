# F342: website install records keep the signature's end and a signer stamp

## What was done

- `web/app/core/websign.js`: `WEB_SIGNER_VERSION` (1, the same changes the app's SignerStamp 1 stands for),
  `webSignerStamp(groupFix)`, `groupFixHash(bytes)` (first 16 hex digits of SHA-256, as SignerStamp.hash) and
  `signatureEnd(profile)` (the profile's expiry, or the latest end among its DeveloperCertificates when that is
  earlier: the .p12's own certificate isn't readable in JS, and it is one of those).
- `web/app/websign-job.js`: the result carries `signer` (hash only when the group fix was injected) and `expires`.
- `web/app/core/installed.js`: `appRecord` keeps valid `expires` / `signer` (no new keys when absent, so older
  record shapes and tests stay the same). The callers of `signInBrowser` write their records in `onInstalled` with
  their own fields (altstore, myipas, browse, share, home …) and ignore its argument, so rather than touching every
  caller, `signInBrowser` notes the signature for the app's IDs (`noteSiteSignature`) just before `onInstalled`, and
  `recordInstall` takes that note once (30 min wait, for Ready to Install's tap). `siteSignedApps(records, current)`
  gives signing.installed's shape from records with a signature; `siteSignerNow()` fetches the hosted group fix
  dylib once and hashes it for the current stamp (version only when it can't be had).
- `web/app/screens/changes.js`: `resignNow` on the website reads the records (Needs Re-sign, olderSigner included).
- `web/app/screens/installed.js` (outside the brief's file list, needed for "Installed shows '?'"): on the website
  `appView.signed` comes from the records, so signed apps show their days left; the "?" (Marked as installed)
  pill stays sideload-only, since website records from before this change carry no signature and weren't marked.
  The app page reads the same.
- `web/app/signing/browser.js` (also outside the list): one `noteSiteSignature` call before `onInstalled`.
- Tests: `web/app/core/f342-site-signature.test.js` (stamp, end, the job's result incl. a real-zsign group fix
  run, record hand-off, Needs Re-sign and Installed on the website, current stamp caching).

## Decisions

- Records written before this change have no stamp and stay out of Needs Re-sign on the website (unlike the app,
  where a signed record with no stamp counts as older): on the website nothing tells a signed install from a Mark as
  Installed, so listing them would ask to re-sign apps the website never signed.

## Not verified

- A real website install in Safari on a phone (record gets `expires`/`signer`, Installed pill, Changes row): no
  browser session on a phone in this run; covered by unit tests of each step only.
- Account sync (`core/account.js`) carrying `expires`/`signer` between devices: not checked; records synced from
  another device may arrive without them, which only leaves those apps out of the website's Needs Re-sign.
