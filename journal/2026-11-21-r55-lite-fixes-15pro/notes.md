# R55: tonight's Lite fixes on the iPhone 15 Pro

User 2026-11-21: "test the stuff you did on ip15 pro". Build from main (0da9c77, Lite 0.18.2 (3483), `native/build.sh
ipa` on Linux), installed with `tools/ui-15.sh R55 install` (rig signer: team ad hoc profile, keeps the bundle ID and
Keychain groups), driven with `tools/ui-15.sh` under its lock. Proof from the phone's log (`pymobiledevice3 syslog live
-e "iFizBox install|tsnet|Tailscale"`, the app's os_log `iFizBox install:` lines) and the app's bridge through Web
Inspector (`pymobiledevice3 webinspector cdp`, `ifizboxNative.call(...)`).

Test IPA: `com.ryha.r55test` ("R55 Test", not iFizBox's ID), the Tiny fixture's executable plus 340 MB of random
padding, 356.5 MB, versions 2.0-7.0 (a version other than the installed one each run: mostly updates, run 6 put
4.0 over 7.0, a downgrade iOS accepts for ad hoc apps). Built in the scratchpad, put in the app's
Documents with `afcclient --container com.ryha.ifizbox`, never launched.

## State before

- `tailscale status` on this desktop, before anything: `ifizbox-on-iphone` (offline 1d), `-1` (offline 1d), `-2`
  (offline 9h), `-3` (offline, last seen 1m ago), `-4` 100.81.244.3 (offline 29m). Five nodes.
- The app (`tailscale.status`): signed in, node `ifizbox-on-iphone-4.beetal-ling.ts.net`, connect auto, key expires
  2027-05-20; `tailscale.keptRoute` = `iphone`; `idevice.status`: paired `rp`, iOS "27.0" (the bridge's short form; Settings shows iOS 27.0.1); signing identity: the team's
  Apple Distribution cert + `com.ryha.*` ad hoc profile. iFizBox Account: Off (no account sign-in in play).

## (1) This iPhone route over Tailscale (B246 / B251 / B252)

### Pairing first: Test Connection says Connected while the pairing is dead

After installing main's build, Install Apps With > Tailscale > Test Connection said **"Connected: iFizBox reached this
iPhone through Tailscale in 47 ms. Apps install over Tailscale now."** The first install then failed in 1.5 s:
`connect_failed: Socket(Custom { kind: UnexpectedEof, error: "early eof" }) (1)`, the progress page showing the raw
error and **"1 failed"**. Retry All: the same.

remotepairingd's side (syslog): it accepts the TCP connection, finds its one paired peer (4F457959-…), runs
`verifyManualPairing`, sends Device-0..2, gets Host-3 and invalidates the channel. So the app's pairing record no
longer verifies with the phone (the phone still lists a paired "iFizBox"). `idevice.verify` from the bridge: the same
`early eof`. Settings > Installation & Signing > Check Connection said it right: **"Pair Again: This iPhone answered
through Tailscale, then closed the connection: it no longer accepts iFizBox's pairing. Pair again."** with a Pair
Again button. How the pairing went stale is not known (it was "Paired" before the reinstall too; other slots install
builds on this phone and re-pair; a pairing made by a build signed with other Keychain groups would leave this one's
record behind).

So the wording the task asked about, "Not Paired Yet", never showed: that one is for a phone with no host paired at
all (B246's `not_paired`). A phone that has a host paired but rejects the app's record passes Test Connection
(`Tailscale.test` only probes TCP + reset) and the install reports the raw socket error. Filed as a bug (see
Follow-ups).

Pair Again > Start Pairing showed the code; iOS Settings > Privacy & Security > Developer Mode > Pair with iFizBox >
Pair, code typed with `ui-15.sh type`; back in the app `idevice.verify` = `{ok: true, kind: "rp"}`, Pairing:
Paired.

Small things seen on the way:
- Installation & Signing's row read "his iPhone · Not Paired" (the leading T clipped) right after Pair Again.
- The Pairing page showed "LocalDevVPN: On" while LocalDevVPN isn't installed (`idevice.status`: localDevVPN false,
  otherVPN true: the VPN on is Tailscale's).
- After a run, the Install IPAs list and the app page stay stale: R55 Test 5.0 installed, the page still says "Not
  signed yet" and the list's Installed row says 3.0 with 5.0 under Not Installed.
- The Confirm page says "Reinstall R55 Test" for an update (3.0 over 2.0).

### Runs (each a 340 MB copy, Tailscale direct over the LAN)

Times from the phone's log. Copy speeds are the app's own "AFC: copied … MB/s in front / in the background" line.
The VPN was switched in iOS Settings (Settings root, VPN switch) through `ui-15.sh`, each state checked by the
switch's pixel.

| Run | Version | What I did | What happened | Result |
| --- | --- | --- | --- | --- |
| 0 | 2.0 (new) | nothing (stale pairing, above) | `connect_failed … early eof` 1.5 s after Confirm, twice (Retry All) | **1 failed** (B274) |
| 1 | 2.0 (new) | Home 5 s into the copy | copy 340 MB in 19.9 s: 17.7 MB/s in front, 16.8 in the background; installd 3 s | installed in 24.9 s |
| 2 | 3.0 | locked the phone 5 s into the copy | copy 20.1 s: 18.0 MB/s in front, 16.4 locked; installd 3 s | installed |
| 3 | 5.0 | VPN off 6 s into the copy, on again ~15 s later | drop noticed 12 s after VPN off (`upload_failed: Socket(Kind(TimedOut))` at 138 MB, "try 1 of 4"); try 2 "Tailscale isn't back on yet"; try 3 3 s after the VPN came back: node 1.3 s, tunnel 0.23 s, "carrying on from 138.0 MB"; copy 41.0 s in all | installed (connection 3) |
| 4 | 6.0 | VPN off the moment installd started (~2 s in, no installd progress arrived), on again 22 s later | B251: "installd quiet for 30 s: asking iOS … on a second connection" at +30 s; the second look got a tunnel (remotepairingd let it in beside the first), saw 6.0 in a new bundle folder, ended the wait | installed at +31 s (B246's own run 7, the same case before B251, ended only at the 180 s limit) |
| 5 | 7.0 (row showed SIGN; signed ahead when armed) | iOS Settings in front 1 s after Confirm | the IPA had been signed ahead; the route was chosen 0.2 s before the app went to the background; the whole copy ran in the background at 16.5 MB/s | installed in 25.9 s |
| 6 | 4.0 (row showed SIGN; signed ahead when armed) | Home right after the Confirm tap | B252: the app was in the background 1.2 s **before** "This iPhone: … 4.0" (the route decision and signing.install ran with the app away); copy 16.6 MB/s in the background | installed |

No run after the re-pair ended in "failed"; every progress page closed itself on success (the queue badge cleared).
The drop was noticed in 12 s during the copy and in 30 s during installd. KeepAlive held the app every time (no "the
app was suspended" line); background speed is 92-95 % of front.

## (2) Node reuse without the owner's login (B218 / R50)

The app was already signed in (node `-4`), so no owner login was needed. Each case read back with `tailscale.status`
/ `tailscale.keptRoute` / `idevice.status` through Web Inspector, then the node started (`tailscale.test`, plus
`idevice.verify`), then `tailscale status` on this desktop:

| Case | Came back as | Login page | Route | Pairing | Nodes after |
| --- | --- | --- | --- | --- | --- |
| Over-install of main's Lite IPA (`ui-15.sh install`) | `-4`, signed in | none | This iPhone | kept (but stale, see (1)) | 5, `-4` online |
| Seven installs over Tailscale (part 1) | `-4` each time | none | This iPhone | - | 5 |
| iFizBox's own re-sign over This iPhone (`signing.resign`, see below) | `-4`, signed in | none | This iPhone | kept, verify ok | 5, `-4` online |
| Delete + reinstall (`ios uninstall`, `ui-15.sh install`: fresh container) | `-4`, signed in (from the Keychain) | none | This iPhone | kept, verify ok | 5, `-4` online |

Node list before and after, identical: `ifizbox-on-iphone`, `-1`, `-2`, `-3`, `-4`. Nothing was deleted. **R50
passes** (ticked, with a note). `-3` (seen "1m ago" at the start) is not a new node: `tailscale status --json`
gives it Created 2026-11-20T23:24Z, before `-4` (Created 2026-11-21T03:49Z), and LastSeen 06:50Z, while this
phone's app was running as `-4` (07:20Z). It is another device's iFizBox (likely the user's own phone, B246's
reporter); no node was created during this task (newest Created is `-4`'s).

R50 is ticked on this check, as the brief asked ("close R50 if it passes"); its "sign in twice with a brand-new
login" part needs the owner and is filed separately (see Follow-ups).

The delete + reinstall went beyond "reinstall the Lite IPA" on purpose: an over-install keeps the container, so it
can't show B218's Keychain restore. The cost was the container's test data (restored in part, below).

The re-sign: Installed > iFizBox > Modify > Re-sign failed at once with **"iFizBox: Not an http(s) URL", "1 failed"**.
A bridge trace showed the queue sending `signing.prepare {record: "com.ryha.ifizbox"}` (sign-ahead), which answers
`bad_url` for iFizBox's own record (`url: self:bundle`). Filed B275. To still test the re-sign case I sent
`signing.resign {bundleId: "com.ryha.ifizbox", route: "idevice"}` from the bridge (what queue.js's own-app branch
sends): it signed, copied 38 MB over Tailscale and closed itself for installd; on relaunch the record was re-stamped.

The fresh container lost what lives in it: "Signing Needs Setup" (the identity's lookup key is in UserDefaults and
the profile is a file in Application Support; pushing the profile back alone still gave no identity), the signed
records and My IPAs, and iOS asked again for notifications and local network. Filed B276 for the identity. I had
backed the container up first (afcclient reaches the whole container), and put back the profile and the signed
records (minus R55 Test), then re-imported the team's ad hoc identity with `signing.import` (F329a's way); the app
shows Ready to Install, This iPhone · Paired, Certificate 341 days left. My IPAs' library files were not put back
(2 GB of test IPAs).

## Not verified

- **"Not Paired Yet" wording**: never showed; the phone had a host paired (a stale one), so the case was "Pair
  Again" (Check Connection) / "Connected" (Test Connection, wrong: B274). To see "Not Paired Yet" the phone's paired
  host must be removed on the phone side; not done, as it would also cut other slots' pairing on this shared phone.
- **A brand-new Tailscale login, twice** (R50's "sign in twice"): needs the owner's account; only the saved sign-in
  was reused here. The admin console wasn't read; `tailscale status` on this desktop lists the same tailnet's nodes.
- **Run 0's cause**: why the app's pairing record went stale before this task (it showed Paired at the start) is not
  known. Other slots install builds on this phone and pair; not traced.
- **B252 with the signing itself in the background**: in runs 5 and 6 the IPA was already signed ahead when Confirm
  was tapped, so only the route decision and signing.install ran in the background, not the signing.
- **Leaving the app during installd itself** (as opposed to VPN off): installd took 3 s for this test IPA, too short
  to leave inside it; run 4 covers a drop during installd.
- **DERP-relayed / slower Tailscale paths, iOS 26, another phone**: every run went direct over the LAN on iOS 27.0.1.
- **The progress page's own lines on success**: the page closes itself; success was read from the log and the queue
  badge, not from the page.
- My IPAs' library files and the R55 Test signed record were not restored after the fresh install (test data).

## Follow-ups filed

- B274 (normal): Test Connection says Connected while the phone rejects the pairing; the install shows the raw
  `early eof` and "1 failed" instead of Pair Again.
- B275 (normal): Modify > Re-sign on iFizBox's own row fails "Not an http(s) URL" (sign-ahead can't read `self:bundle`).
- B276 (low): a delete + reinstall forgets the signing identity though the .p12 is in the Keychain.
- R57 (low): R50's brand-new-login-twice check, which needs the owner's Tailscale account.
- B277 (low): small UI slips (clipped "his iPhone · Not Paired", "LocalDevVPN: On" for Tailscale's VPN, stale IPA
  page/list after an install from the IPA's page, "Reinstall" for an update).

## Phone left as

iFizBox 0.18.2 (main 0da9c77, rig-signed), Tailscale signed in as `ifizbox-on-iphone-4`, Install Apps With This
iPhone, paired (RemotePairing, verify ok), the team's ad hoc identity imported, notifications and local network
allowed. R55 Test uninstalled; its IPAs went with the old container. Tailscale's VPN on. Screens in the main
checkout's `ref/15/screens/r55-*.png` (not committed).
