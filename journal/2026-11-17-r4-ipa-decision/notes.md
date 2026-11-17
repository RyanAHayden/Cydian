# R4: does Cydian need an IPA?

## What I did
- Read AGENTS.md, docs/native.md, the F7/F9/F10/F11/N5/I1 tasks, and sidedrop's README and app.py (how it
  signs: one ad hoc profile on a wildcard App ID; README says push and App Groups won't work).
- Wrote docs/ipa.md: what the IPA would be for (non-jailbroken phones have only AltStore-source IPAs to
  update, and an IPA can't list installed apps any better than the PWA), a side-by-side table, each IPA-only
  ability rated, the signing limits, and the verdict: **drop**.
- Plan: dropped I1; filed F12 (later, parked): widget-only IPA if Web Push proves unreliable; noted F10
  (setAppBadge, on-device "check now" push, check itms-services from standalone PWA); filed D1 (low) to fix
  AGENTS.md/README, which still name `ipa/` (outside R4's files).

## Decisions made without asking
- Drop rather than build: Web Push is server-scheduled and reaches anyone on iOS 16.4+, while BGAppRefreshTask
  is opportunistic and the IPA reaches only enrolled UDIDs or 7-day sideloaders. The widget is the one real
  extra; parked instead of built.
- Didn't edit AGENTS.md myself: not in R4's files, and other slots load and touch it.

## Tried and failed
- nothing failed; desk research only.

## Not verified
- No phone was used (none in scope). BGAppRefreshTask frequency, widget reload budget, itms-services from a
  standalone PWA, the SW push-handler time budget, and Shortcuts "Run Immediately" before iOS 17 come from docs
  and developer experience, not measured. Listed in docs/ipa.md with who picks each up (F10).
