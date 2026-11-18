# B18: Sileo DepictionButtonView with a nested view / isLink

## What was wrong
`DepictionButtonView` only drew `text`. Chariz puts the content in `view` (a DepictionLabelView, or a
DepictionImageView for its logo) and no `text`, so the button was an empty filled tint bar. `isLink` was ignored.

## What I did
- `web/app/screens/depiction.js`: the nested `view` is rendered inside the `<a>` (Sileo's DepictionButtonView
  does this), with `aria-label` from `text` or the view's text/accessibilityText; that label is also the sub-depiction
  title. `isLink` adds the class `link`, a nested view adds `has-view`, and `yPadding` sets the vertical padding.
- `web/app/packages.css` (not in the task's file list, but the link style needs it; I only added lines):
  `.dep-button.link` is a plain tint-colour link with no fill or padding. A nested label takes the tint, the way
  Sileo's actionable label does. `has-view` drops the button's own margin because the view brings its own (still
  6px 12px when it is a filled button).
- Test in `depiction.test.js`, using the three buttons from Oneko's depiction.json exactly as served, plus a
  filled button with a view (sub-depiction) and a plain text button.
- Rendered the live Oneko JSON in headless Chromium at 2x with ios6.css + packages.css: "Version History" sits
  right-aligned in the tint colour beside "New in Version 1.0.0". "Email Support" is a tint link, and the Chariz logo is drawn
  centred.

## Tried and failed
nothing

## Not verified
- On the iPhone 7 in the app: this task didn't say to drive the phone. I only checked it in desktop headless Chromium.
- Label `margins` ("{21, 15, 6, 15}") are still not applied (no view uses them yet). The label keeps its default
  4px 12px margin, so spacing differs a little from Sileo.
- `openExternal` is ignored: every http(s) link opens in a new tab, as before.
