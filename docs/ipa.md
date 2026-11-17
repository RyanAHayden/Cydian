# IPA: does Cydian need one?

> **Overruled by the user, 2026-11-17: build it.** Not as a separate app: the `native/` shell also builds as a
> sideload IPA (plan I2-I4). It remembers the version you downloaded, checks sources in the background and posts
> local notifications. When the root helper is present (jailbreak mode) it reads real installed versions instead.
> The research below still holds for what an IPA can and can't see.

R4, 2026-11-17. **Verdict: drop it.** Don't build a non-jailbroken IPA now. F10 (PWA + Web Push) and F11 (the
Shortcuts recipe) cover the job. The IPA's only real extras (a Home Screen widget, a check that never leaves the
phone) aren't worth what it costs to sign and ship it. I1 is dropped. A widget-only IPA is parked as a `later`
task, to come back to only if Web Push proves unreliable on real phones.

This is desk research from what Apple documents and from sidedrop's code. Nothing was built or run on a phone.
See "Not verified" at the end.

## What the IPA would be for

On a phone without a jailbreak there's no dpkg, so APT upgrades mean nothing there. Jailbroken phones get the
native app, which checks for upgrades with its own launchd daemon (N5). That leaves **the IPAs from AltStore
sources (F9)** as the only things a non-jailbroken Cydian could tell you to update. The "installed" list for
those is whatever Cydian saw you install (taps on GET/UPDATE, the way sidedrop's `installed.json` works), kept on
the device. **An IPA can't get a better list than the PWA can.** iOS has no public API to list installed apps or
read their versions. `canOpenURL` only says whether a URL scheme you declared ahead of time has a handler, and
`LSApplicationWorkspace` is private and blocked for third-party apps.

So the question is narrow: which one gets "n upgrades" in front of the user most reliably, for the most people,
for the least upkeep?

## Side by side

| | PWA + Web Push (F10) | Shortcuts recipe (F11) | Non-jailbroken IPA |
|---|---|---|---|
| Who can use it | Anyone on iOS 16.4+ who adds it to the Home Screen | Anyone who builds the shortcut by hand (or imports the iCloud link) | Only phones that can install the IPA: sidedrop-enrolled UDIDs (ad hoc), or AltStore/SideStore users with a free Apple ID |
| What triggers the check | The server's daily job. Delivery is up to APNs, but it doesn't depend on how often the app gets opened | Time-of-day Personal Automation, runs without a prompt ("Run Immediately", iOS 17) | `BGAppRefreshTask`: iOS picks the time, if it runs at all (see below) |
| Where the diff runs | On the server, from sources + installed list the user sends on opt-in (or in the service worker, see the note to F10) | On the server via `/api/upgrades`, called by the shortcut. Nothing is stored | On the phone (the same `core/` in a WKWebView or JSContext) |
| Notification | Yes, Web Push. Must be visible (no silent pushes) | Yes, "Show Notification" (it comes from Shortcuts, not Cydian) | Yes, local `UNUserNotificationCenter` |
| Icon badge | Yes, Badging API (`navigator.setAppBadge`, iOS 16.4+ Home Screen apps) | No | Yes |
| Home Screen widget | No | No (only the shortcut's own tile) | Yes, WidgetKit, with limits (see below) |
| Install an IPA | Opens the `itms-services://` link; iOS does the install | Opens the `itms-services://` link | Opens the same `itms-services://` link. **No more than that** |
| Upkeep | None per user | None per user; the recipe doc | Re-signing, UDID enrolment, yearly cert, Developer Mode, 7-day re-sign on free Apple IDs |

## What only an IPA can do, and how much it's worth

1. **Background checks with `BGAppRefreshTask`.** Real, but weak. iOS decides when the task runs, from how
   often the user opens the app. `earliestBeginDate` is only a floor. The task gets about 30 seconds. It doesn't
   run when Background App Refresh is off, in Low Power Mode, or after the user swipes the app out of the app
   switcher (until they open it again). An app you only open when it nags you is exactly the kind iOS rarely
   wakes up. A server-side daily push arrives more reliably than an on-device refresh for an app nobody opens.
   **Worth: low.**
2. **Local notifications and badge.** Yes, but Web Push plus the Badging API already gives both on iOS 16.4+.
   **Worth: none over F10.**
3. **The check stays on the phone.** Here the IPA really does better: the installed list never goes to the
   server. F10 can get most of this back without an IPA. The daily push can be a bare "check now" that the
   service worker answers by fetching sources through the proxy, diffing against IndexedDB and showing the count
   (iOS needs every push to show a notification, and this does). Noted on F10. **Worth: low once F10 does that.**
4. **A Home Screen widget ("3 upgrades").** The one thing neither the PWA nor Shortcuts can do. Its limits: a
   widget's timeline reloads are rationed by iOS (a few dozen a day at best). Sharing the app's sources and
   installed list with the widget extension needs an **App Group**, which sidedrop's wildcard profile can't grant
   (see signing). So the widget would have to fetch on its own from settings the user types into the widget's
   configuration. **Worth: nice to have, not enough on its own.**
5. **Installing IPAs.** **Not possible.** A third-party app has no public API to install apps. It can only open
   an `itms-services://` (or AltStore/SideStore/Feather `…://`) URL, which Safari and a PWA can open too. The
   ways around that (TrollStore-style CoreTrust bugs, private `LSApplicationWorkspace` calls) only work on
   certain iOS versions or need a jailbreak. That's the native app's job, not this one. **Worth: none.**

## Signing limits (the cost side)

How sidedrop signs (`~/repos/sidedrop/README.md`, `app.py`): one **ad hoc** profile for a **wildcard App ID**
(`com.you.*`). Apps are re-IDed under it and re-signed whenever a device is added.

- **No push entitlement.** Wildcard App IDs can't have Push Notifications, so `aps-environment` is never in
  sidedrop's profile. (Ad hoc itself allows push, on production APNs, but only for an explicit App ID with the
  capability, which would mean a second profile and a sidedrop change just for Cydian.) Even with that done,
  APNs push from an IPA wouldn't beat Web Push, so it isn't worth doing.
- **No App Groups** (same wildcard reason), so the app and a widget extension can't share storage.
- **Only enrolled phones.** Ad hoc runs only on UDIDs in the profile: 100 per device family per membership year,
  and each enrolment re-signs every app. Strangers on the public site can't get it.
- **Developer Mode** must be turned on once per phone (iOS 16+).
- **Expiry.** The ad hoc build stops launching when the distribution cert expires (1 year).
- **Free Apple ID via AltStore/SideStore**, the only route for the public: re-sign every 7 days, 3 active
  sideloaded apps, no push or App Group capabilities. An update checker that dies after a week unless the user
  refreshes it doesn't fit the job.

## Recommendation

**Drop.** The audience is non-jailbroken phones whose only updates are AltStore-source IPAs. For them:

- F10's Web Push reaches everyone on iOS 16.4+ with no signing and fires on a server schedule. It also does the
  badge.
- F11's Shortcuts recipe covers people who won't add a PWA, and phones below 16.4 that run Shortcuts.
- The IPA would add an unreliable background check, a rationed widget, and no install ability. It would reach
  only sidedrop's enrolled friends or 7-day sideloaders, and cost yearly re-signing upkeep.

Plan changes made by R4:

- **I1 dropped** (an IPA shell with BGAppRefreshTask + local notifications), for the reasons above.
- **Parked (`later`): a widget-only IPA**, to revisit only if F10's Web Push turns out unreliable on real phones
  (the hand check in F10's journal). It would need an explicit App ID (push and App Groups) and its own ad hoc
  profile in sidedrop.
- **Note on F10:** do the badge with `navigator.setAppBadge`. Consider a "check now" push that the service worker
  answers on the device, so the installed list can stay off the server. Check that `itms-services://` links open
  from the standalone PWA.
- AGENTS.md still describes `ipa/` as a possible third front door. A low docs follow-up corrects it (it wasn't
  in R4's files).

## Not verified

All of this is from Apple's documentation and sidedrop's code as I know them. Nothing was tried on a phone, and
no phone was in scope for R4.

- How often `BGAppRefreshTask` actually fires for a rarely opened app. Apple doesn't publish numbers; this is
  the usual developer experience, not a measurement.
- Widget reload budget figures (Apple says "a few dozen a day" for frequently viewed widgets, no exact number).
- Whether `itms-services://` opens from a standalone (Home Screen) PWA as it does from Safari. Handed to F10's
  hand check.
- Whether a service worker's `push` handler on iOS gets enough time to fetch sources and diff before it has to
  show the notification. Handed to F10.
- "Run Immediately" for time-of-day automations is from iOS 17. Older versions' prompt behaviour wasn't checked.
