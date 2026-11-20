# F279: own App IDs get every capability a signing service's profile has

## What the reference profile has

The user's Arctic Sign profile (`~/Downloads/211483.mobileprovision`, team STW4VDB85Z, not committed) carries these
entitlements, mapped to App Store Connect `capabilityType`:

| entitlement | capabilityType |
|---|---|
| aps-environment | PUSH_NOTIFICATIONS |
| com.apple.security.application-groups (5 groups) | APP_GROUPS |
| associated-domains `*` | ASSOCIATED_DOMAINS |
| icloud-services, ubiquity-*, icloud-container-* | ICLOUD (settings ICLOUD_VERSION XCODE_6) |
| game-center | GAME_CENTER |
| healthkit (+ access health-records, background-delivery, recalibrate-estimates) | HEALTHKIT |
| homekit | HOMEKIT |
| siri | SIRIKIT |
| networking.networkextension (8 kinds) | NETWORK_EXTENSIONS |
| networking.vpn.api allow-vpn | PERSONAL_VPN |
| networking.multipath | MULTIPATH |
| networking.HotspotConfiguration | HOT_SPOT |
| nfc.readersession.formats | NFC_TAG_READING |
| ClassKit-environment | CLASSKIT |
| authentication-services.autofill-credential-provider | AUTOFILL_CREDENTIAL_PROVIDER |
| networking.wifi-info | ACCESS_WIFI_INFORMATION |
| coremedia.hls.low-latency | COREMEDIA_HLS_LOW_LATENCY |
| applesignin Default | APPLE_ID_AUTH (settings APPLE_ID_AUTH_APP_CONSENT PRIMARY_APP_CONSENT) |
| pass-type-identifiers | WALLET |
| in-app-payments (empty) | APPLE_PAY |
| inter-app-audio | INTER_APP_AUDIO |
| external-accessory.wireless-configuration | WIRELESS_ACCESSORY_CONFIGURATION |
| (none: on by default for explicit IDs) | IN_APP_PURCHASE |
| (not in Arctic's profile; asked for by the task) | DATA_PROTECTION (DATA_PROTECTION_PERMISSION_LEVEL COMPLETE_PROTECTION) |
| usernotifications.communication, usernotifications.time-sensitive, weatherkit, devicecheck.appattest-environment, user-fonts, kernel.extended-virtual-addressing, kernel.increased-memory-limit, kernel.increased-debugging-memory-limit, avfoundation.multitasking-camera-access | **not in the API** |

## Real calls (key PFAXKX35NV, team S8NFX3A2LT, 2026-11-19)

Scratch script (not committed) made a throwaway App ID `com.ryha.f279probe46507`, asked for each capability, made an
Ad Hoc profile for it, then deleted the profile and the App ID (both deletes went through). A second probe
(another throwaway, also deleted) tried the settings-less variants and the macOS/tvOS ones.

**Accepted by the RSideload team (all 24 in APP_ID_CAPS, plus MAPS and NETWORK_CUSTOM_PROTOCOL):** PUSH_NOTIFICATIONS,
APP_GROUPS, ASSOCIATED_DOMAINS, ICLOUD, GAME_CENTER, HEALTHKIT, HOMEKIT, SIRIKIT, NETWORK_EXTENSIONS, PERSONAL_VPN,
MULTIPATH, HOT_SPOT, NFC_TAG_READING, CLASSKIT, AUTOFILL_CREDENTIAL_PROVIDER, ACCESS_WIFI_INFORMATION,
COREMEDIA_HLS_LOW_LATENCY, APPLE_ID_AUTH, WALLET, APPLE_PAY, IN_APP_PURCHASE, INTER_APP_AUDIO,
WIRELESS_ACCESSORY_CONFIGURATION, DATA_PROTECTION. SYSTEM_EXTENSION_INSTALL and USER_MANAGEMENT are accepted on an iOS
App ID too but put nothing in an iOS profile, so they're left out (as are MAPS and NETWORK_CUSTOM_PROTOCOL).

**Refused for being managed / needing Ian's request: none.** Nothing in the API's enum was refused for this team.

**Not possible through the API at all** (409 ENTITY_ERROR.ATTRIBUTE.TYPE "is not a valid value"; Apple's message
lists the enum: ICLOUD, IN_APP_PURCHASE, GAME_CENTER, PUSH_NOTIFICATIONS, WALLET, INTER_APP_AUDIO, MAPS,
ASSOCIATED_DOMAINS, PERSONAL_VPN, APP_GROUPS, HEALTHKIT, HOMEKIT, WIRELESS_ACCESSORY_CONFIGURATION, APPLE_PAY,
DATA_PROTECTION, SIRIKIT, NETWORK_EXTENSIONS, MULTIPATH, HOT_SPOT, NFC_TAG_READING, CLASSKIT,
AUTOFILL_CREDENTIAL_PROVIDER, ACCESS_WIFI_INFORMATION, NETWORK_CUSTOM_PROTOCOL, COREMEDIA_HLS_LOW_LATENCY,
SYSTEM_EXTENSION_INSTALL, USER_MANAGEMENT, APPLE_ID_AUTH): USERNOTIFICATIONS_COMMUNICATION,
USERNOTIFICATIONS_TIMESENSITIVE, WEATHERKIT, APP_ATTEST, FONT_INSTALLATION, EXTENDED_VIRTUAL_ADDRESSING,
INCREASED_MEMORY_LIMIT, INCREASED_DEBUGGING_MEMORY_LIMIT, MULTITASKING_CAMERA_ACCESS (also GROUP_ACTIVITIES,
FAMILY_CONTROLS, SHAZAMKIT, SENSITIVE_CONTENT_ANALYSIS, MEDIA_DEVICE_DISCOVERY, HLS_INTERSTITIAL_PREVIEW). These are
ticked per App ID on developer.apple.com (Account Holder or Admin); Multitasking Camera Access and Family Controls are
managed and need a request to Apple by the Account Holder (Ian). Doing that per App ID by hand doesn't scale, so
iFizBox doesn't ask anyone to; the guide says they can't be had this way.

**Settings matter:** ICLOUD without settings: 409 "cannot have the CloudkitVersion 'null'"; APPLE_ID_AUTH without:
409 "Please select at least one configuration for Sign In with Apple"; DATA_PROTECTION without: **201 but not turned
on** (it isn't in the App ID's capability list afterwards). Hence APP_ID_CAP_SETTINGS, and addCaps remembering one
that's accepted but not listed.

**What Apple put in the profile** (App ID with all 26): wifi-info, application-groups **`<array></array>` (empty)**,
in-app-payments (empty), associated-domains `*`, autofill-credential-provider, ClassKit-environment production,
default-data-protection NSFileProtectionComplete, keychain-access-groups `S8NFX3A2LT.*` + com.apple.token, healthkit
(+ access health-records, background-delivery), homekit, HotspotConfiguration, ubiquity-kvstore-identifier
`S8NFX3A2LT.*`, icloud-services `*`, icloud/ubiquity container lists (empty), inter-app-audio, game-center, multipath,
networkextension (all 8 kinds), nfc formats NDEF/TAG/PACE, aps-environment production, siri, vpn.api allow-vpn,
wireless-configuration, pass-type-identifiers `S8NFX3A2LT.*`, hls.low-latency, applesignin Default. So it matches
Arctic's profile except the nine not in the API (and healthkit.recalibrate-estimates).

**App Groups:** the API has no app group endpoint, so the App ID's group list stays empty and so does the profile's
`com.apple.security.application-groups` (Arctic's has five `group.<hex>.N` it made through the developer website's
private API). An app that reads a shared container through its group gets nothing until a group is made and assigned
on developer.apple.com. Said in the guide.

## What changed

- `web/app/core/asc.js`: APP_ID_CAPS is the 24 above (Push first), APP_ID_CAP_SETTINGS, capBody. addCaps asks for
  them, skipping what's remembered as refused for the team; a 4xx refusal (not 401/429) is logged once and kept in
  the profile cache under `#refused` = {team: {cap: {at, why}}}; asked again after REFUSED_RETRY (30 days) in case a
  managed one was granted. Push is never remembered: a new App ID throws when Apple refuses it; an existing one logs
  and asks again next sign. 429/5xx/network errors are logged and retried next sign. ensureProfile tops up an App ID
  that lacks some (made before this), reading its team (seedId) once with GET /bundleIds/{id} when the cache entry
  doesn't have it, and the remake rule then makes a new profile. Entries carry `team`; results carry `capsAdded`,
  `capsRefused`; ensureProfile takes `log`.
- `native/Sources/ASC.swift`: the same list and settings, the same top-up, refused memory in
  `Signing/auto/refused.caps` (not .json, so `asc.profiles` doesn't list it; removing the key clears it), keyed by the
  base profile's team (a new App ID: its seedId).
- `web/app/screens/guides.js` (+ its test): the API key guide gets a "What Each App Gets" step with the list, what
  the API can't do and the App Groups note. Outside the task's file list, but the task asks for it in the guide.
- Tests (fake ASC now refuses, accepts quietly, fails 503, checks settings, answers GET /bundleIds/{id} with
  seedId): the list against Apple's enum and against ASC.swift's, skip-and-remember (once, per team, a month on),
  Push must / passing errors / 401, existing App IDs topped up (cached and found in the account).

## Not done / follow-up

- `screens/devaccount.js` autoProfileSite doesn't pass `log` to ensureProfile yet, so on the website a refusal is
  remembered but not shown in the sign log. Filed as a follow-up (not in this task's files).

## Not verified

- The Swift change wasn't run on a phone: it compiles (`make -C native package` built the .deb and the .ipa), but no sign with a key
  happened on the iPhone 7 or a sideload phone, so the top-up path and refused.caps are checked by reading only.
  The JS twin is tested against the fake ASC and its requests were checked against Apple by the probe.
- No team where Apple actually refuses an API capability was available, so the refusal message format comes from
  the 409s seen for unknown types and missing settings, not from a managed-capability refusal.
