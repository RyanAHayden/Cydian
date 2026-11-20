# F15d: phone check of the idevice route

The plan asked for a phone check of the F15b idevice route on the iPhone 15 (iOS 27), done with the user in the
coordinator session using the test build on the tailnet page. That check took place in the coordinator
session. Afterwards the user answered the task's stuck note with "F15 finished entirely" (plan commit 63749731).

## What this session did
- Read the brief and the user's answer. Since the user had already confirmed F15 as finished, there was nothing
  left to build or check, so `native/sideload/idevice/**` is unchanged.
- Wrote this journal and closed the task.

## Not verified
- This unattended session ran none of the phone steps itself: pairing via Developer Mode > Pair with iFizBox,
  installing an IPA with LocalDevVPN on, the LocalDevVPN-off and other-VPN alerts, self-update. They need the
  user's phone and the user, and they were done in the coordinator session. This session only has the user's
  "F15 finished entirely" as the result.
- This session found no record of answers to the open questions from the brief: mdns pairable-host
  advertisement without the multicast entitlement, the `localdevvpn://` scheme, VPNCheck with Tailscale on,
  port 49152 on other phones, and the iOS 15 lockdown path. The user's confirmation covers F15 as a whole, so
  none of them was filed as a follow-up.
