# F318: a FREE paid tweak downloads signed out (sideload build)

## What changed

- `web/app/core/payment.js`
  - `buildRequest(…, "authorize_download", { tokenless: true })` builds the request with no token. Without the
    flag it still refuses, as before.
  - `createPaymentClient().authorizeDownload(id, { …, tokenless })` passes the flag through. If the account is
    signed in, the token still goes along.
  - `paidTweakDeb`: when signed out and package_info says `price` FREE and `purchased: true`, it calls
    authorize_download without a token first. Any failure at that step (a vendor refusal, no https URL, a network
    error) becomes `PaidNeeded("signin")`, so the screen offers Sign In as before. A priced tweak, or a FREE one
    that isn't marked purchased, still asks for Sign In without trying.
- `web/app/screens/tweaks-paid.test.js`: the old "signed out → Sign In" check now uses a seller that refuses. A new
  test drives the real `createPaymentClient` against a Chariz-like fake request. It checks the download works with
  no `token` field, that a refusal leads to Sign In with no download, that priced and not-purchased tweaks never
  try, and that the builder is still strict without the flag.

Decision: on the tokenless attempt I catch every error, not just `PaymentError`. The brief says "fall back to
Sign In on any refusal", and Sign In is the action that can fix it. Errors from `download()` after a URL was
handed out still go through unchanged.

## Follow-up

- F319 (low, after F318): give the jailbreak build's paid.install path (`screens/extras.js`) the same tokenless try.
  extras.js is not in this task's file list.

## Not verified

- I did not try it against live Chariz. The brief says R45 checked that authorize_download hands out the .deb with
  no token (2026-11-20). I only tested with fakes, and no phone or sideload build was used for an end-to-end run.
