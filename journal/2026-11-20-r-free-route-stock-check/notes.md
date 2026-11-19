# R32 Stock-phone check for the free Apple ID route

Background and the iPhone 7 results: `journal/2026-11-19-r30-free-apple-id/notes.md`. On the 7 (AppSync), iOS
refused to install a website-signed free-account development build over an installed copy of itself ("Already
Installed, delete … and try again"), for the same IPA and for build 2. Question (b) below decides go or no-go for
the free route: if a stock phone does the same, every 7-day refresh deletes the app and its data.

## Status: blocked on the user

This task is a hand test on a **stock** iPhone. The only phones an agent can drive are the 4S (reference only) and
the iPhone 7 (jailbroken, AppSync, the source of the doubt). The user's stock iPhone 15 Pro isn't reachable over
ssh or tools/ui-*.sh, and the steps need someone to plug it into the MBA, trust a developer and tap prompts. So
this session wrote the steps out and blocked the task; nothing was tested.

## Steps for the user

Prepare (on the MBA, Xcode signed in to the free Personal Team):

1. Plug the stock iPhone into the MBA and open the R30 probe project (`com.<user>.r30probe`, or any throwaway
   SwiftUI app with an explicit App ID) in Xcode. Build and run once to the phone with the Personal Team: this
   registers the phone's UDID and makes a 7-day profile that lists it. On iOS 16+, turn on Settings > Privacy &
   Security > Developer Mode when asked (restart). Then **delete the app** from the phone, so the next install
   comes from the website and not Xcode.
2. Export the "Apple Development" identity as .p12 and re-pack it for the website signer (Keychain exports use
   RC2-40 and include every identity): `openssl pkcs12 -legacy -in export.p12 -nodes -out all.pem`, then
   `openssl pkcs12 -export -legacy -inkey <the matching key> -in <the Apple Development cert> -out dev.p12`.
   Download the profile from `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (the one whose
   ProvisionedDevices holds the phone's UDID: `security cms -D -i <file>`).
3. Build two IPAs of the app: build 1 (CFBundleVersion 1) and build 2 (CFBundleVersion 2, a visible text change).

Test:

- **(a) Install and launch.** On the stock iPhone, open ifizbox.com in Safari, sign build 1 with `dev.p12` and the
  profile, tap Install. Then Settings > General > VPN & Device Management > the developer > Trust (needs network).
  Does it install? Does it launch? Write down the iOS version and whether Developer Mode was needed.
- **(b) Update in place (decides the route).** With build 1 installed (put something in the app's data first if
  it has any), sign and install **the same IPA again** through the /sign/up itms link, then **build 2**. For each:
  does iOS update in place (the app keeps its data and shows build 2) or say "Already Installed … delete and try
  again"? A screenshot of the alert is enough.
- **(c) iOS 26 web app.** On an iOS 26 phone, add ifizbox.com (or `tools/itms-webapp-test.html` from the R30 journal
  tools) to the Home Screen with Share > Add to Home Screen, open it from the icon and tap an Install link (a
  plain itms-services link and the website's own Install button). Does the install prompt open, and does the web
  app stay in front?

Record the answers here (or in a new journal entry) and tick R32. If (b) updates in place, the spike F251 can go
ahead; if it says "Already Installed", the free route is a no-go as designed (F254 stays parked).

## What I did

- Read the R30 notes and AGENTS.md, checked which devices an agent can reach, and wrote the steps above.

## What failed

- Nothing was tried: no stock phone is reachable from an agent session.

## Not verified

- (a), (b) and (c): all three need a person with a stock iPhone (and an iOS 26 one for (c)). Not done.
- Whether the R30 probe's 7-day profile (made 2026-11-19, lists one device of the user's that isn't the 7) already
  lists the stock iPhone 15 Pro: not checked, the phone's UDID isn't recorded anywhere an agent can read. Step 1
  makes a fresh profile either way.
