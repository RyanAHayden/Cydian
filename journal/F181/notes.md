# F181 / F182: the iOS 6 App Store package page and reviews

Concept the user approved 2026-11-18 ("otherwise its perfect"): `concept/*.dc.html`. Each is a static mockup in
inline styles (open in a browser; ignore the `support.js` line and the `<x-dc>` wrapper). Sample data (Velvet,
Sample Dev, the numbers, the screenshots) is made up. Their one change: **Install / Modify stays in the nav bar,
top right** (Cydia's), not in the header.

- `TweakDetails.dc.html`: header (72px icon with gloss and reflection, name, author, stars + count, version · size
  · price), Details / Reviews / Related segmented control, sideways screenshots with page dots, a sideways row of
  info tiles (Rating, Works On + "Your iPhone ✓", Size, Section, Updated), Description with More, What's New with
  Version History, Information table, More by the author, Support.
- `TweakReviews.dc.html`: the average, the 5-to-1 bar chart, Tap to Rate, Write a Review / Report a Problem,
  review cells (title, stars, "by name – Version – date", text, an optional Developer Response).
- `WriteReview.dc.html`: the modal sheet (Cancel / Send, stars, Title, Name, Review).

Ratings today come only from Sileo depictions (`RatingView`/`ReviewView`, written by the repo, screens/depiction.js)
and, for IPAs, Apple's lookup (`core/applookup.js`: average and count, no text). No user reviews exist yet: F182.
