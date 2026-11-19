# R37: Developer Mode step pictures vs the iPhone 15 (blocked)

## What I did
- Read `devModeSteps` in `web/app/screens/free-apple-id.js`. The redrawn pictures that need checking are:
  - restart alert: title "Turn On Developer Mode?", message "Restarting is needed to turn on Developer Mode.",
    buttons Cancel / **Restart**; Developer Mode page footer "Developer Mode lets apps signed for development run
    on this iPhone."
  - confirm alert after the restart: "Turn On Developer Mode?", "This lowers the iPhone's security for apps signed
    for development.", Cancel / **Turn On**
  - Stolen Device Protection delay: header "Security Delay in Progress", row "Try again in 59 min", and its footer
  - VPN & Device Management: "Developer App" header, row "Apple Development: <email>"
- Stopped there. These screens only appear when Developer Mode is actually toggled (restart, passcode, maybe an
  hour's Security Delay) and an app signed by a free Apple ID is on the phone. The iPhone 15 is the user's daily
  phone. Its access is read-only lockdown over Wi-Fi: no screenshots, no taps, and no Settings strings. The rule is
  never to tap or change anything on it without someone there. This run is unattended, so the check can't happen.
- I didn't change any wording from memory: guessing at iOS 27 strings would only swap one unchecked text for another.

## Tried and failed
- nothing tried on the phone (by the rule above).

## Not verified
- All four pictures' wording against iOS 27. Why: this needs a person at the iPhone 15 to toggle Developer Mode
  (restart and passcode) and to open VPN & Device Management with a free-ID app installed. What unblocks it: a
  session with the user there who shoots those screens (or drops their own screenshots under
  `web/app/icons/steps/`, which AGENTS.md allows), then a session that edits `devModeSteps` to match.
