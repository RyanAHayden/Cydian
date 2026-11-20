# C18 Drop the Pairing Screenshots credit

- Removed the "Pairing Screenshots — Ryan Hayden (Fizlo), Their own iPhone's Settings" row from
  Credits > Artwork in `web/app/screens/home.js`. Artwork now lists only Cydia's Section Icons and
  Interface Wording.
- README had no matching Credits line; no test referenced the row (grepped the repo outside
  journal/ and plan/), so there were no tests to update.
- Kept the other "Ryan Hayden (Fizlo)" mentions in home.js: they are the app's author byline
  (About text, Credits header footer), not credits for the screenshots.

**Not verified**: did not look at the Credits page in a browser or on a phone; the change only
deletes one entry from a row array, and the gate's tests cover the file.
