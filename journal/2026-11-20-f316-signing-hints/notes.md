# F316 Hint style on the signing pages

Applies the AGENTS.md Hints rule (F311; concept https://claude.ai/artifact/JMn57UQTZkom6h1Uttz261) to the signing
pages. Each footer is a small exported constant or pure builder, tested in `web/app/screens/hintstyle-f316.test.js`
(every new footer 1–2 sentences, ≤140 characters).

- **Provisioning Profile** (settings.js `profileLayout`): three groups, never one joined footer. The profile's status
  rows (Name, Expires, Devices, App ID) get no footer. This iPhone / UDID / Copy UDID get a short state hint
  (signing.js `deviceHint`, `DEVICE_HINTS`): in the profile; not in it with a UDID ("Add this UDID to your developer
  account, then make the profile again.", red); not in it without one; unknown (the app: where a Mac shows the UDID;
  the website with its Find row: "Not checked: this iPhone's UDID isn't known yet."). core/signing.js deviceCheckText's
  long sentences are still what installs show; only the page's footer changed.
- **Find This iPhone's UDID** (website): its own group under This iPhone's, no footer; "Waiting" and
  `UDID_WAITING` while a visit is pending. The row now opens a new page, `#settings/signing/udid` (title "Find UDID",
  settings.js `drawUdidPage`, signing.js `udidPageSections`): Download Profile (starts the visit, as the row did before)
  and one footer group per step; once the UDID is stored, the page shows it. `udidFindText` is gone.
- **Certificate** (`certificateFooter`): only the first problem (the signer, then the identity problem, then expiry
  and password), else "Kept in this iPhone's Keychain." The website's "Kept in this browser only. Apps are signed
  here, not on a server." stays as it was (already two short sentences).
- **Certificate Status** (signed-apps.js `statusLayout`): footer is the first warning (revoked comes first in
  certificateWarnings), else "Last checked {day}.", else "Asks Apple whether the certificate is still good."
  (never checked). "Signatures Until {day}" is a status row.
- **Apple Developer Account** (devaccount.js `accountFooter`): key rows: "iFizBox makes a profile with Push for each
  app you sign. The key stays in this iPhone's Keychain." (website: "…in this browser."). No key: "With an App Store
  Connect API key, iFizBox makes a profile with Push for each app you sign." plus the guide link (the link only while
  there is no key). The role ("Use a key with the Admin or App Manager role.") is added only to Key Not Accepted and
  to Check Account's failure line (`withRoleHint`).
- **Certificate files block** (`certFilesFooter`) and **Share Your Certificate** (`SHARE_FOOTER`): two short sentences.
- **Website > Other Apps** (website-settings.js `websiteInstallsFooter`): unlocked "Slower than the app, and big apps
  can fail."; locked "Locked until you tap Browse Anyway on Home."

## Decisions

- "Step-by-step moved to the page it opens": Find UDID used to go straight to the profile download, which has no page
  of ours, so the row now opens a Settings page with the steps, and its Download Profile row starts the download.
- Expiring-soon warnings also count as "something off" on Certificate Status, so the footer shows the first warning,
  not only the revoked one.
- The role hint is added on every failure of Check Account or Add API Key; the error doesn't reliably say whether the
  role was the reason.
- `--mode sideload` capture fakes added to capture.mjs: `signing.status` (SIGN_STATUS env), `signing.installed`,
  `asc.key.info` (ASC_KEY env), `asc.profiles`.

## Spec review

- Fixed: the role hint was added to every failure; now only to a refusal about the key's rights
  (`roleRefusal`: status 403, code key-role, or 403/forbidden/permission/role in the message).
- Fixed: Find UDID's footer-only step groups are numbered "1. … 3.", as Pairing's (F317, installroute.js).
- Kept, with reasons: the expiring-soon warning still takes Certificate Status' footer (it's "something off" and its fix);
  the never-checked footer, the no-key account footer and the page's "UDID is here" state are needed states, not extras;
  Other Apps' texts are the concept's own; This iPhone's and Find's footers sit under separate groups, one each.

## Checks

- `node --test web/app`: 2555 pass, 0 fail.
- 3x Chromium renders (capture.mjs, 402x874@3, web/app served on 127.0.0.1:8764):
  `website-locked.png`, `website-unlocked.png`, `find-udid.png` (site.json); `certificate-top.png`, `profile.png`
  (status rows / This iPhone not in profile in red / account), `account.png`, `certificate-status.png` (revoked)
  (sideload.json, `--mode sideload`, fake identity in SIGN_STATUS).

## Not verified

- The website's Provisioning Profile with the Find This iPhone's UDID group: not rendered. It needs a stored .p12 and
  a profile listing devices in IndexedDB. Covered by unit tests (`profileLayout` with `udidFindRows`) only.
- Download Profile on a real iPhone (Safari's profile prompt, the poll filling in This iPhone): not run on a device.
  The start/poll code itself is unchanged, only where its row lives.
- Check Account / Add API Key failure alerts with the role hint: unit test of the text only (needs Apple to refuse a key).
