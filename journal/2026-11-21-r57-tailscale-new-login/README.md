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

1. **Sign Out → Sign In (new login):** the logged-out `-4` should drop off the list (Tailscale removes a node that
   logs out) and one new node take its place. The **count stays at five**, though the name may change (`-4` again,
   or `-5`). If `-4` stays listed beside a new node, every Sign Out cycle adds a node: that would be a bug to file
   (the fix would be either to keep the machine key across Sign Out, or to delete the node through the API).
2. **Sign In again, with no Sign Out in between** (the brief's "then again"): the state is kept, so it should go
   straight to Running with no login page and no new node.

Whether Tailscale removes a logged-out node at once, or keeps it as "expired" until someone deletes it, is not
verified here: it is the key thing for the owner to read off the admin console.

## Owner's check (what the CONFIRM asks)

1. Install Apps With > Tailscale > Sign Out. Look at login.tailscale.com/admin/machines: is `ifizbox-on-iphone-4`
   gone, or still listed (as logged out / expired)?
2. Sign In with your login. Admin console: which name did it get, and how many `ifizbox-on-iphone*` nodes now
   (five expected)?
3. Sign In again (or Test). No login page expected, and no new node.

Don't delete old nodes.

## Not verified

- The whole sign-out / new-login cycle on the 15 Pro: it needs the owner's Tailscale login (an agent can't finish
  login.tailscale.com), and signing out without signing back in would take This iPhone away from the other slots.
- Whether `LocalClient.Logout` removes the node from the tailnet's list or leaves it listed as expired: not tested,
  and the admin console was not read (no login here; `tailscale status` on the desktop shows the same tailnet's
  nodes).
- The phone's current app state (signed in as `-4`) was taken from R55's notes and the desktop's list (`-4` last
  seen 09:10 UTC). It was not read again through Web Inspector.
