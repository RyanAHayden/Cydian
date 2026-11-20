# F308 Sideload IPA: paid tweaks

## What changed

- `web/app/core/payment.js`: `paidTweakDeb(st, { client, repo, architecture, cached, download })` and `PaidNeeded`
  (`need`: signin / purchase / unavailable, `price`). Order: the shell's kept copy first; else package_info; not for
  sale, signed out, or not bought throw PaidNeeded (the screen offers a step, not an error); bought: authorize_download
  with udid/device/version/repo/architecture, then `download(url)`. A token the vendor rejects with `invalidate` turns
  into PaidNeeded("signin").
- `native/Sources/Paid.swift`: `PaidTweaks` with `paid.download {url, package, version}` (one-time URL fetched once,
  `!<arch>` checked, 64 MB cap, kept as `Application Support/PaidTweaks/<pkg>_<version>.deb`, older versions of the
  package removed, bytes back as base64) and `paid.cached {package, version}`. Both builds. Package/version are checked
  against Debian name/version patterns so a name can't leave the folder; `:` (epoch) is written `%3A`. No extra
  encryption, as the brief says.
- `native/fake/fake-native.mjs`: the same two calls, same file names and errors.
- `web/app/screens/tweaks.js`: the `cydia::commercial` refusal is gone. `tweakDeb` sends a commercial stanza to
  `paid.deb(st)` (`createPaidTweaks`: the same Sileo client wiring as screens/extras.js — net.request, device.info,
  keychain.*, auth.session — and the same credential store keys, so the package page's sign-in is shared). The vendor
  is found from the catalog: the source(s) carrying that package and version whose `payment_endpoint` parses.
  - Add to App (nav button and the group's row), the Add Tweaks sheet's ADD, and From a Source… catch PaidNeeded and
    show an action sheet (`offerPaid`): "Sign In to <seller>" or "Buy for <price>" (Buy for Free on FREE); done ->
    the same add runs again (so Sign In then Buy is two sheets, then the add). Cancel -> nothing, no alert.
  - The package page's "Add to an App" group (worksInGroup) shows Price plus Sign In to <seller> / Buy for <price>
    with a one-sentence footer; after the step it checks again (spinner, then Works In / Add to App…).
  - Tweak Updates on a paid tweak while signed out shows PaidNeeded's message in the existing "Can't Update These
    Tweaks" alert (no sheet there; kept simple).
- `web/app/screens/browse.js` (one line, not in the brief's files): a sideload tweak's page no longer gets the
  jailbreak Purchase group (`paymentGroup`): its Download & Install calls `paid.install`, which the sideload build
  refuses, and Price/Sign In/Buy now live in the Add to an App group. Jailbreak pages are unchanged.
- why.js "Tweaks in Sideloaded Apps": line 1 now ends "no jailbreak", line 2 is "Paid ones too, bought with your
  Chariz or Havoc account." (why.test.js caps a point at 5 lines of ≤ 64 characters, so the old "Havoc, Chariz,
  BigBoss: no jailbreak needed." line made room.) README's paragraph got one sentence.

## Tests

`web/app/screens/tweaks-paid.test.js` (fake shell in sideload mode with PhoneID's UDID + fake vendor serving the real
fixture tweak .deb): signed out -> Sign In; not bought -> Buy with price; bought -> authorize_download body checked,
.deb downloaded and kept per package+version; kept copy read with no vendor call; newer version replaces the file;
FREE+purchased (Chariz betterAlarm's answer) downloads with no Buy step; Add to App goes Sign In sheet -> Buy sheet ->
Tweak Added with the .deb in the app's kept tweaks; cancelled sheet adds nothing and alerts nothing; path traversal
refused by the shell.

## Tried and failed

- First test run: the fake vendor refuses any `version` not equal to its package's; the test vendor now takes
  whichever version is asked.

## Not verified

- **Swift not compiled**: no Swift toolchain on this machine (the gate skips native builds without one). Paid.swift's
  new `PaidTweaks` was written against the existing `Apt.work/reply`, `Paid.session` and `BridgeError` APIs and read
  over, but not built.
- **On the IPA with a real Chariz tweak (betterAlarm, FREE)**: needs an IPA built on the MBA and installed on a
  phone, and a Chariz sign-in; not possible unattended. Filed as a follow-up check (R45). Unknown until then: whether Chariz's
  authorize_download accepts a sideload phone's PhoneID UDID for a FREE package the account never "bought", and
  whether its one-time URL redirects (URLSession follows redirects, so it should be fine).
- worksInGroup's paid rows are not covered by a DOM test (the flow under it is); not looked at on a phone or in a
  browser.
