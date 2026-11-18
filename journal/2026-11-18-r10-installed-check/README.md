# R10, fifth run (2026-11-18): Cydian installed on the iPhone 7, paid shell checked up to the sign-in page

`sudo -n true` works on the phone now (passwordless rule added), so this run could finally install Cydian.
`docs/iphone7.md` still says sudo asks for a password. I left it alone because it's outside this task's files.

## What I did

- `native/build.sh deb` → `com.ryha.cydian 0.3.8-741`, `scp` to the phone, `sudo apt-get install -y /tmp/Cydian.deb`:
  `dpkg -l` shows `ii`, `Cydian.app` is in `/var/jb/Applications`, `com.ryha.cydian.upgrades` is running. **Cydian
  stays installed** on the phone for later runs. The copied .deb was deleted.
- I drove the screen with `tools/ui-7.sh` (lock R10, released afterwards) through `cydian://package?id=…`.
  The screenshots are in `ref/7/screens/r10-*.png` (gitignored, main checkout only).

## Findings

1. **The purchase group draws in the app, for both vendors.** Havoc's Elysian ($3.49) shows Price + "Sign In" + "Sign in with
   your Havoc account". Chariz's Antoine ($1.49) shows "Log In" + Chariz's banner. That means the vendor `info` and
   `package_info` calls work through `net.request`, and so does `client.signedIn()`, which calls **`keychain.get` inside the app:
   no -34018 and no error footer.** (The phone has no passcode, so no prompt was expected. See the probe run.)
2. **`device.info` works inside the app.** Sign In first builds the authenticate URL from `device.info` (UDID +
   model). A failure would show the "can't read this iPhone's UDID" alert. Instead, the next step came up.
3. **The Sign In sheet opens (ASWebAuthenticationSession).** iOS asks '"Cydian" Wants to Use "havoc.app" to Sign In'
   → Continue → Havoc's "Sign into your Havoc account" page (havoc.app). For Chariz it's my.chariz.com's Log In
   page. Havoc accepted the authenticate URL with Cydian's udid/model (no "Bad Request" page).
4. **Cancel returns to the app**, but shows a "Purchase: Sign-in was cancelled or the vendor sent nothing back." alert
   (both vendors). Filed **B12** (low): a deliberate cancel should be silent.
5. **The nav-bar Install is offered for an unpurchased paid package** (Elysian, signed out): Install / Other Versions /
   Add to Wish List. apt can't fetch Havoc packages (418), so this can only fail. Nothing in the UI checks
   `isCommercial` except the purchase group. Filed **B11** (normal). I tapped Cancel and queued nothing.
6. **A free commercial package shows "Price: Purchased" while signed out.** Chariz answers betterAlarm's
   `package/<id>/info` with `{"price":"FREE","purchased":true,"available":true}` even without a token (checked with
   curl from the phone). drawApp shows Purchased. Filed **B13** (low).
7. A package that's on both Havoc and Chariz (Aemulo) shows Havoc's purchase group, from the copy Cydian picked. Velvet 2
   shows no purchase group, which is right: its latest version (2.1.2-3) dropped `cydia::commercial`.

## Tried and dropped

- I first picked "Chariz commercial" packages by grepping the stanza for `commercial`. That matched old versions, and also
  packages Havoc carries too. I switched to the latest iphoneos-arm64 stanza's `Tag:` and to packages that aren't on Havoc.

## Not verified

- **Finishing sign-in and the `sileo://authentication_success` return**, and **`keychain.set`** of the token (it runs
  only after a sign-in). Why: no Havoc/Chariz account. Signing in needs the user's own login.
- **The passcode/Touch ID prompt.** Why: the phone has no passcode (see `journal/2026-11-18-r10-iphone7-probe`).
- **Buying, and Download & Install through `cydian-helper install-paid`.** Why: needs a signed-in account, and buying
  needs the user's OK. One option that costs nothing: Chariz lists betterAlarm (`com.noisyflake.betteralarm`) as FREE.
  Once signed in to Chariz, its Download & Install would test install-paid end to end without a purchase.
- **That the vendor really ties the UDID to the account.** Why: no account page to look at.
