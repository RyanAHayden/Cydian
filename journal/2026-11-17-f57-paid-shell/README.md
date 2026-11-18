# F57: shell side of paid packages

F20 wrote the page side (web/app/screens/extras.js, core/payment.js) and asks the shell for five calls. This task
adds them in `native/Sources/Paid.swift` (registered from Bridge.swift with one line) and the root helper verb that
installs the vendor's .deb.

## What I did

- **net.request** `{method, url, headers, body}` -> `{status, headers, body base64}`. https only, GET or POST (the
  spec's vendors use only those), body in is the JSON string the page built. Host/Content-Length/Connection/
  Transfer-Encoding headers from the page are dropped. Uses Apt.session (same timeouts and User-Agent as net.fetch).
- **device.info** -> `{udid, model}`: MobileGestalt `MGCopyAnswer("UniqueDeviceID")` via dlopen (what Sileo sends as
  udid) and hw.machine (`iPhone14,2`, Sileo's model/device). Needs
  `com.apple.private.MobileGestalt.AllowedProtectedKeys = [UniqueDeviceID]`, added to native/entitlements.plist (the
  jailbreak build only; the sideload IPA's entitlements are untouched and mkipa's check still passes).
- **keychain.get/set/remove** `{key[, value]}`: generic passwords, service `com.ryha.cydian.payment`, account = the
  page's key. `set` uses `SecAccessControl(.userPresence, WhenPasscodeSetThisDeviceOnly)`; `get` passes an LAContext
  with a reason, so reading the payment secret asks for Face ID / passcode. Decision: when the phone has **no
  passcode**, .userPresence items can't be added at all, so `set` falls back to `WhenUnlockedThisDeviceOnly` without
  access control rather than making buying impossible. Added `keychain-access-groups = [com.ryha.cydian]` to the
  jailbreak entitlements (a no-team-ID ad hoc app otherwise gets errSecMissingEntitlement, -34018) and
  `NSFaceIDUsageDescription` to Info.plist (Face ID without it kills the app).
- **auth.session** `{url, callbackScheme}` -> callback URL string, or **null when the user closes the sheet**
  (extras.js then says "Sign-in was cancelled…" from finishSignIn(null); for a purchase it just redraws). https URL
  only; the scheme must be a plain scheme and not http/https/file/cydian. One sheet at a time; the window comes from
  the web view; `prefersEphemeralWebBrowserSession = false` so a Safari login to the vendor carries over (Sileo's
  behaviour).
- **paid.install** `{url, package, version[, stream]}` -> `{code, stdout, stderr}` (Helper.run's reply). Jailbreak
  build only. Downloads the one-time https URL at once into `/var/mobile/Library/Caches/com.ryha.cydian/paid/<UUID>.deb`
  (refuses a body that doesn't start with `!<arch>\n`), runs `cydian-helper install-paid <path> <pkg> <version>`, and
  removes the download. With `stream: true` it emits a `dlstatus:<pkg>:0:Downloading` line and the helper's lines,
  like ipa.install (extras.js doesn't stream yet: F74).
- **cydian-helper install-paid** (native/helper/paid.c, plan in policy.c): path only from HELPER_PAID_DIR
  (`[A-Za-z0-9][A-Za-z0-9._-]*.deb`), name and version by the usual rules; opens the file O_NOFOLLOW through the real
  directory (one link, owned by the directory owner, not root, ≤ 1 GiB) and copies it into a root-owned
  `/var/tmp/cydian-paid.XXXXXX/paid.deb` (install-ipa's approach, so the app can't swap it afterwards); `dpkg-deb -f`
  reads the copy's control and Package/Version must be what was asked (rollback's helper_rollback_verify); then
  `apt-get -y (conffile options) [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install <copy>` as a child (with
  `CYDIA=3 1`), and the work directory goes. I chose apt-get over `dpkg -i` (selfupdate's way) so a paid tweak's
  dependencies come from the sources.
- Fakes: `native/fake/fake-vendor.mjs` (a Sileo Payment Provider: info, authenticate, user_info, sign_out,
  package info/purchase/authorize_download with one-time .deb URLs, optional status-1 purchases);
  `fake-native.mjs` got the five methods; `fake/cydian-helper` got install-paid.
- Tests: `native/helper/test_helper.py` InstallPaid (paths, plan, the whole chain on Linux, refusals: wrong control,
  junk, link, hard link, empty, outside the dir, not Cydian); `web/app/backend-native-paid.test.js` (sign in through
  auth.session, secret only in the Keychain map, purchase, status-1 purchase via payment_completed, cancelled sheet,
  authorize_download + paid.install into dpkg status, the URL being one-time, wrong-package .deb refused, apt failure,
  sideload/https refusals); `native/test_native.py` test_paid_entitlements. The test file sits in web/app/ (outside
  native/**) because the gate runs node tests only there; it is a new file, so it can't conflict.
- `native/build.sh` builds the helper with paid.c; the whole native build (deb + ipa) passed locally, and the
  Swift links AuthenticationServices and LocalAuthentication.

## Tried and dropped

- Nothing failed outright. I considered exec'ing apt-get directly (like rollback), but then nothing removes the
  root-owned copy, so the helper forks and waits instead.

- Filing the on-device follow-up, an unquoted `--files journal/**` was glob-expanded by the shell into the task
  text (R9). Dropped R9 and refiled it as R10 with the pattern quoted.

## Not verified

- **Anything on a phone.** The only test device is the iPhone 4S on iOS 6, which can't run this iOS 15+ app, and no
  Havoc/Chariz account is available to an unattended run. Unchecked: the ASWebAuthenticationSession sheet and its
  return from `sileo://…`; Face ID/passcode prompts; whether `keychain-access-groups` without a team ID is accepted by
  securityd on Dopamine/palera1n (the -34018 worry); whether MobileGestalt hands out UniqueDeviceID with that
  entitlement on iOS 15–17+; the real helper's install-paid as root (copy in /var/tmp, apt-get on a local .deb, _apt
  reading it); a real vendor's download URL and .deb. Filed as **R10** (needs a person with a phone and an account).
- The page doesn't refresh dpkg status or stream progress after paid.install: page-side work, filed as **F74**.
