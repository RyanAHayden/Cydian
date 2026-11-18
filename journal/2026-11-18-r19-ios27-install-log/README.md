# R19: read the B29 install log from the user's iOS 27 phone

## What the task needs

Install opentennis-beta-p146.ipa from My IPAs on the user's iPhone 18 Pro (iOS 27) with the B29 build, then read
the progress page's console: the `Bundle ID:` line and the install server's lines (method, Range, status,
"iOS has n of size bytes", any "404 after it stopped being served" / "connection ended after"). If every byte was
served and the install still fails, compare against a Feather-signed copy on that phone (signature/profile on iOS 27).
Background and the fix: `journal/2026-11-18-b29-big-ipa-install/README.md`.

## What I did

Nothing on a device. This run is unattended, and no agent can reach the user's iPhone 18 Pro: there is no ssh or
UI access to it (only the 4S and the iPhone 7 are scriptable), and the install needs the user's own signing
certificate. The iPhone 7 can't stand in for it, because it runs iOS 15 and can't run the sideload build
(see the B29 journal). I found no install log from the user's phone in the repo or the journal.

Blocked the task. It needs the user to run the install and paste the console output (or a screenshot of it).

## Not verified

- **Everything this task asks for.** It needs the user's physical iOS 27 phone, their certificate and a person to
  tap Install. No log exists yet to read.
