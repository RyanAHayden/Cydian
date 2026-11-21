# R50: B218 check on the iPhone 15 Pro (handed to the owner)

## What the task asks

On the 15 Pro, Lite build: pick This iPhone and sign in to Tailscale, reinstall the Lite IPA, sign in with the
saved account key. Expect: route still This iPhone, Tailscale signed in without a login page, and the tailnet
admin console still shows one '<name> on <device>' node. Sign in twice: still one node.

## What I did

- Confirmed B218 is on main (`bba3b618 Merge branch 'task/B218'`), so the build under test exists.
- Did not try the Tailscale login. Tailscale Sign In in the Lite app opens login.tailscale.com, which wants the
  owner's account (email, Google, Microsoft, GitHub, Apple or passkey). B219 hit the same wall and handed its check
  to a person as R48. The admin console (login.tailscale.com/admin/machines) needs the same account.
- Every step after the login checks the login itself (no login page after reinstall, one node in the owner's
  admin console), so there is no part an agent can do once the owner has signed in. Handed the whole check to the
  owner as a CONFIRM with the steps above.

## What failed

Nothing was run; nothing failed.

## Not verified

- The whole device check: it needs the owner's Tailscale account for the first sign-in and for reading the admin
  console's machine list. Handed to the owner (CONFIRM on R50).
