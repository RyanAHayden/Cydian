# B13: Purchase group said "Price: Purchased" for a free commercial package when signed out

R10 found Chariz answering `{"price":"FREE","purchased":true,"available":true}` for betterAlarm
(com.noisyflake.betteralarm) with no token, and drawApp showed "Purchased" whenever `purchased` was true.

## Done
- `core/payment.js`: `isFreePrice(price)`, true for "free" in any case (trimmed). `parsePackageInfo` keeps its shape
  (existing deepEqual tests and backend-native-paid tests compare it whole), so the check is a separate function.
- `screens/extras.js`: `priceDetail(info, signedIn)` (exported, tested) for the Price row:
  free -> "Free"; signed in and purchased -> "Purchased"; else the price, or "Paid".
  The Buy row says "Buy for Free" instead of "Buy for FREE".

## Decisions (unattended, nobody to ask)
- "Free" wins over "Purchased" even for a signed-in account: the brief says Free when the price is FREE, and a
  vendor's `purchased: true` on a free package means nothing (it says so signed out).
- Row actions are unchanged: signed out still offers Sign In (download needs a token); signed in with
  `purchased: true` offers Download & Install.

## Not verified
- Live check against Chariz signed in (no vendor account here, and the screen only calls vendors in the app).
- The rendered page on a phone: the change is the row's text only, covered by the unit tests.
