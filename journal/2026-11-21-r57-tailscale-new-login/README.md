# R57: a brand-new Tailscale login on the iPhone 15 Pro (B218's second half)

## Outcome

Blocked on the owner (CONFIRM). Sign Out followed by Sign In opens login.tailscale.com, and only the owner can
finish that login (memory: "iPhone 15 Lite state + Tailscale login"). I did **not** tap Sign Out: once the app is
signed out, no agent can sign it back in, and the other slots' install tests on this phone use This iPhone over
Tailscale. So the sign-out cycle itself is left for the owner, with the baseline and what to expect written below.

## Baseline: the tailnet's nodes before the check (`tailscale status --json` on the desktop, 2026-11-21)

| Node | Created (UTC) | Last seen (UTC) |
|---|---|---|
| `ifizbox-on-iphone` | 2026-11-19 23:19 | 2026-11-19 23:30 |
| `ifizbox-on-iphone-1` | 2026-11-19 23:30 | 2026-11-19 23:31 |
| `ifizbox-on-iphone-2` | 2026-11-20 06:06 | 2026-11-20 21:08 |
| `ifizbox-on-iphone-3` | 2026-11-20 23:24 | 2026-11-21 06:50 |
| `ifizbox-on-iphone-4` | 2026-11-21 03:49 | 2026-11-21 09:10 |

Five nodes, the same five R55 saw. `-4` is the app's current node, and it is the only one created after B218
landed on main (2026-11-21 00:53 UTC). The four older ones date from before B218, when every fresh container meant
a new login. All five are offline because the node runs only during installs and tests. Nothing was deleted.

## What the code says Sign Out does (read, not run)

`native/sideload/tailscale/Tailscale.swift` `tailscale.signOut`: starts the node, calls `TSLogout()`
(`tsnet.go`: `LocalClient.Logout`, which logs the node out on the tailnet), stops it, then `Tailscale.forget()`
deletes the container's `tailscaled.state` **and** the Keychain copy (`TailscaleKeep.forgetNode()`). B218 chose
this on purpose: "only Sign Out deletes the node's copy".

So on the next Sign In the app has no machine key, and the tailnet registers a **new machine**. The brief's literal
wording, "still lists the same ifizbox-on-iphone nodes, no new one per sign-in", cannot hold for the
Sign Out → Sign In step as built. What B218 can promise is:

1. **Sign Out → Sign In (new login):** a new machine is registered either way. The list stays the same size only if
   the tailnet drops the logged-out `-4` (my unverified expectation of `LocalClient.Logout`, not a known fact). Then
   the count stays at five, though the name may change (`-4` again, or `-5`). If `-4` stays listed beside the new
   node, every Sign Out cycle adds a node, which fails the brief. That would be a bug to file, with two possible
   fixes: keep the machine key across Sign Out, or delete the node through the API.
2. **The whole cycle a second time** (the brief's "then again"): the same as step 1 again. Each cycle should
   leave the count where it was.

Whether Tailscale removes a logged-out node at once, or keeps it as "expired" until someone deletes it, is not
verified here: it is the key thing for the owner to read off the admin console.

`-4` was created at 03:49 UTC (22:49 on 2026-11-20, local time), three hours after B218 reached main, but B218 does
not explain it. B218 keeps a node only once one exists, and `-4` came from a **new login**: that evening the owner
set up Tailscale on the phone (memory: B246, about 23:45 local), and the app had no kept state to restore. Whether
the build the owner signed in with already held B218 is not known.

## Owner's check (what the CONFIRM asks)

1. Install Apps With > Tailscale > Sign Out. Look at login.tailscale.com/admin/machines: is `ifizbox-on-iphone-4`
   gone, or still listed (as logged out / expired)?
2. Sign In with your login. Admin console: what name did the node get, and how many `ifizbox-on-iphone*` nodes
   are there now? Five passes; six means Sign Out leaves the old node behind.
3. Do steps 1 and 2 once more (Sign Out, Sign In). Does the count stay the same again?
4. Then Test, with no Sign Out first. No login page expected, and no new node.

Don't delete old nodes.

## Not verified

- The whole sign-out / new-login cycle on the 15 Pro: it needs the owner's Tailscale login (an agent can't finish
  login.tailscale.com), and signing out without signing back in would take This iPhone away from the other slots.
- Whether `LocalClient.Logout` removes the node from the tailnet's list or leaves it listed as expired: not tested,
  and the admin console was not read (no login here; `tailscale status` on the desktop shows the same tailnet's
  nodes).
- The phone's current app state (signed in as `-4`) was taken from R55's notes and the desktop's list (`-4` last
  seen 09:10 UTC). It was not read again through Web Inspector.
