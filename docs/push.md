# Push notifications

The sideload app's update alerts come from two places:

- **the background check** (`native/Sources/BackgroundCheck.swift`): iOS runs it when it likes, often hours apart;
- **push** (optional, Settings > Updates > Push Notifications): the signing server checks the same list every 30
  minutes and sends the alert through Apple's push service (APNs) at once.

Both stay on together; push only makes the alert come sooner. The jailbreak build has neither: its daemon checks apt.

## What travels

Turning Push on asks iOS for notification permission (once) and a device token, then sends to the signing server
(Settings > Installation & Signing > Signing Server, `https://sign.ifizbox.com` unless changed):

- the token, the APNs environment (`production` or `development`, from the app's embedded profile's
  `aps-environment`), the bundle ID (the APNs topic), the signing team, the app version and iOS version;
- what the background check follows: each app's ID, name, installed version and AltStore source URL, iFizBox
  itself through its own source, and the updates already counted on screen (so they don't push);
- when iFizBox's own signature ends (from its embedded profile), for one "Signature Expiring" push two days before.

It is sent again whenever that list changes (`web/app/app-updates.js`), only while Push is on. Turning Push off
deletes everything kept for the device on the server; so does APNs saying the token is dead. Tokens and lists are
never logged.

## What gets pushed

| Push | When |
|---|---|
| **iFizBox X.Y** | iFizBox's own source has a newer iFizBox |
| **n Updates** (names in the body) | a followed app's source has a newer version that runs on this iOS (minOSVersion / maxOSVersion), not already counted on screen |
| **Signature Expiring** | iFizBox's signature ends within two days |
| **Test Push** | Settings' Test Push |

Each version is pushed once. A tap opens Changes.

## When push can't work

Settings shows only the Push switch and says why:

- **The copy was renamed by its signer.** APNs delivers by topic = the app's **Info.plist bundle ID**, whichever team
  signed the copy. The key on ifizbox.com reaches `com.ryha.ifizbox` (an explicit App ID with Push Notifications on
  team S8NFX3A2LT), so every copy that keeps that ID gets pushes: Arctic Sign, RSideload, SideDrop, iFizBox's own
  signing, any team. iFizBox and the website now keep iFizBox's own ID when they sign it (Keep Bundle IDs, on by
  default). A copy installed earlier under the profile's ID gets the update **beside** it: the app says so once
  before signing, and the old copy is deleted by hand.
- **The profile has no Push** (no `aps-environment`): iOS gives no token. Wildcard profiles never have it; an explicit
  App ID with Push Notifications does (RSideload's and SideDrop's profiles do). `development` profiles push through
  APNs's sandbox host, `production` (Ad Hoc, distribution) through the production one.
- **Notifications are off** for iFizBox in iOS Settings.
- **The server has no APNs key** (or no push database). A self-hosted Worker needs its own key from the team that
  owns its iFizBox's App ID: worker/README.md.

The app's own entitlements (`native/entitlements-sideload.plist`) carry no `aps-environment`: signers use the
profile's, and one that kept a binary's `aps-environment` under a profile without Push would make iOS refuse the
install.

## The server

`worker/src/push.js`: `POST /api/push/register`, `/unregister`, `/status`, `/test`, `GET /api/push`; devices in the
`PUSH` D1 database; the Cron Trigger (`[triggers]` in `wrangler.toml`) runs the check. It signs the APNs provider
token (ES256) with the key in the `APNS_KEY` secret, renewed every 40 minutes. `worker/test-push.mjs` runs it all
against SQLite and a fake APNs.
