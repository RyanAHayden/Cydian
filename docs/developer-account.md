# Setting up your Apple Developer account

How to get a certificate and profile of your own that sign apps the way paid signing services do: each app keeps its
own bundle ID (so it replaces the original, not a copy beside it) and gets its own notifications. Checked on a stock
iPhone 15 Pro (journal/2026-11-19-f237-keep-bundle-id). Why it works is in [signing.md](signing.md#keep-bundle-ids):
iOS checks the entitlements' `application-identifier` against the profile, but never the app's Info.plist bundle ID,
and registers the app for push under the Info.plist one.

You end up with three things: a `.p12` (certificate and private key), its password and a `.mobileprovision`.

## 1. Join the Apple Developer Program

[developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll), $99 a year. A free Apple ID
can't do this: it has no Ad Hoc profiles and no Push.

## 2. Make an Apple Distribution certificate

First a certificate signing request (CSR), which makes the private key on your computer.

**On a Mac:** Keychain Access > Keychain Access menu > Certificate Assistant > Request a Certificate From a Certificate
Authority. Your email and name, **Saved to disk**, Continue.

**Anywhere else (Linux, Windows with OpenSSL):**

```sh
openssl genrsa -out key.pem 2048
openssl req -new -key key.pem -out request.csr -subj "/emailAddress=you@example.com/CN=Your Name/C=US"
```

Then on [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list):
**+** > **Apple Distribution** > upload the CSR > Download (`distribution.cer`).

Turn it into a `.p12`:

- **Mac:** double-click `distribution.cer`, then in Keychain Access > My Certificates, right-click
  "Apple Distribution: Your Name" > Export > `.p12`, with a password.
- **OpenSSL:**

  ```sh
  openssl x509 -inform der -in distribution.cer -out cert.pem
  openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -out cert.p12
  ```

  `-legacy` uses the older encryption that every iOS version and zsign open (OpenSSL 1.1 has no `-legacy`
  flag and needs none).

Keep the `.p12` and its password safe: anyone with both can sign as you. The certificate lasts a year.

## 3. Make an App ID with Push and groups

[Identifiers](https://developer.apple.com/account/resources/identifiers/list) > **+** > App IDs > App:

- **Explicit**, an ID of your own such as `com.yourname.apps`. Not a wildcard (`com.yourname.*`): Apple gives
  wildcards no Push.
- On the Capabilities tab tick **Push Notifications**, **App Groups**, **Communication Notifications** and **Time
  Sensitive Notifications**. Associated Domains is worth ticking too. For the same coverage as a paid signing
  service's profile, also tick App Attest, Fonts, Extended Virtual Addressing, Increased Memory Limit, Increased
  Debugging Memory Limit and, on the App Services tab, WeatherKit. Skip the ones the Account Holder has to request
  from Apple (Multitasking Camera Access, HealthKit's recalibrate estimates): notifications don't need them.
- Continue, Register.

Then give it App Groups. Ticking the capability isn't enough: without groups assigned, the profile's
`com.apple.security.application-groups` is an empty list.

1. Identifiers > **+** > **App Groups**: a description and an ID such as `group.com.yourname.apps.1`. Make five
   (`.1` to `.5`).
2. Open the App ID > App Groups > **Configure**, select them all, Save.

Push alone isn't enough for every app. Apps that hand notifications to an extension (a modded Discord, for one) use
whatever groups the profile gives them: with Push but an empty group list, and without Communication and Time
Sensitive Notifications, such an app gets no notifications at all. With the groups and both notification capabilities
it gets them. Set up all three together.

One App ID set up like this covers every app's notifications: iOS registers each app for push under its own
Info.plist ID, not the App ID. It doesn't mix apps' data either: iFizBox gives each app a keychain group named after
its own bundle ID (the profile's `TEAM.*` keychain entry allows it) and keeps the App Group data the app asks for in a
folder of its own. Only the profile's own `group.` folders are shared, by the apps that use those IDs directly.

Any change to an App ID's capabilities or groups makes every profile made from it invalid. Make the profile again
(step 5), import the new one into iFizBox (step 6: iFizBox keeps using the identity it holds until you do) and re-sign
the apps with it. That keeps every app's data (see "Keep your apps' data" below).

## 4. Register your iPhones

[Devices](https://developer.apple.com/account/resources/devices/list) > **+**: a name and the iPhone's UDID. A Mac's
Finder shows it (click the line under the iPhone's name until it says UDID), and so does `idevice_id -l`. Settings >
Signing in iFizBox says whether this iPhone is in the profile and has Copy UDID.

Apple allows 100 iPhones per account per membership year; removing one frees its slot only at renewal.

## 5. Make an Ad Hoc profile

[Profiles](https://developer.apple.com/account/resources/profiles/list) > **+** > **Ad Hoc** (under Distribution).
Pick the App ID, your Apple Distribution certificate and your iPhones, name it, Download the `.mobileprovision`.

Ad Hoc, not Development: a development profile gets only Apple's sandbox push, which apps' own servers don't send to.
Make the profile again whenever you add an iPhone.

Check what it holds:

```sh
security cms -D -i profile.mobileprovision > profile.plist                                  # Mac
openssl smime -inform der -verify -noverify -in profile.mobileprovision > profile.plist     # elsewhere
grep -A3 -E 'aps-environment|application-groups|usernotifications' profile.plist
```

It should show `aps-environment` = `production`, `com.apple.security.application-groups` with your `group.` IDs in
it (not an empty `<array/>`), and `com.apple.developer.usernotifications.communication` and
`com.apple.developer.usernotifications.time-sensitive`.

## 6. Use it in iFizBox

Import the `.p12`, the `.mobileprovision` and the password in **Settings > Signing** (the website) or **Settings >
Installation & Signing** (the sideload app), and leave **Keep Bundle IDs** on. With an App Store Connect API key
added under **Apple Developer Account** on the same page, iFizBox makes each app's App ID and profile itself and adds
this iPhone to the account ([signing.md](signing.md#own-provisioning-profiles-app-store-connect-api-key)). Apple's
API can switch App Groups on but can't make or assign groups, and can't turn on Communication or Time Sensitive
Notifications, so those App IDs get an empty group list. For an app that needs them (often one with a notification
extension), assign groups and tick those two on its App ID on the website, or leave the API key out and sign with the
one App ID from step 3.
Delete the App Store copy of the app first (iOS won't sign over it), install, and allow notifications.

<p align="center"><img src="img/crop-web-certificate.png" alt="Settings > Signing: Import Certificate" width="320"></p>

## Keep your apps' data

An app's sign-ins and settings live in its data folder, its keychain and its App Groups. Re-signing keeps all three
when it stays on the same team and App ID:

- **Fine**: a new certificate from the same account, a profile made again (new iPhones, capabilities or groups added),
  re-signing as often as you like, with **Keep Bundle IDs** on.
- **Loses the app's data**: a profile from **another team** (another account or signing service), or one for
  **another App ID**. iOS refuses it as an update, and the only way on is deleting the app, which deletes its data
  (the keychain is tied to the team too). The sideload app stops before signing and says so. Before you switch
  accounts, back up what the app can export, or sign it from the new account as a fresh install.
- **Keep Bundle IDs off** makes a copy beside the app, with empty data of its own.
- Keep the App ID's keychain entry as Apple makes it (`TEAM.*` in the profile): that's what lets each app have its
  own keychain group.

## When it doesn't work

- **"Unable to install … integrity could not be verified"**: this iPhone isn't in the profile. Add its UDID (step 4),
  make the profile again (step 5) and import the new one.
- **The app installs but won't open**: Developer Mode is off (Settings > Privacy & Security > Developer Mode, iOS 16
  and later), or the certificate or profile expired.
- **No notifications**: the profile has no `aps-environment` (Push wasn't on when it was made, or it's a development
  profile), its group list is empty or it lacks Communication and Time Sensitive Notifications (step 3), it was made
  before the App ID last changed (invalid: make it again and re-sign), Keep Bundle IDs was off when the app was
  signed, or the app was never allowed to send notifications. Some services push only while you're away elsewhere:
  Discord sends to the phone only while its desktop and web clients are inactive, so quit those when testing.
- **An app forgot its sign-in or settings**: it was signed from another team or App ID and deleted to get it on
  (above), signed with Keep Bundle IDs off (a copy), or signed by a tool that puts every app in one shared keychain
  and doesn't map the app's own App Groups. Re-signing with iFizBox keeps its data from then on; what was lost
  before stays lost.
- **Every app stops opening at once**: the certificate expired or was revoked. Make a new one (step 2) and a new
  profile (step 5), then re-sign. In the sideload app, Home shows a tile when the certificate or profile is about to
  expire (Settings > Installation & Signing > Show Expiry Warning sets how early).
