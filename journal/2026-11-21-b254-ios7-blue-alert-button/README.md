# B254 iOS 7: Too Big alert's Download IPA flat

- Added `html[data-style="ios7"] .alert-button.blue` to ios7.css's flat alert-button rule (beside .cancel/.green/.red),
  so the Download IPA button is flat tinted text in iOS 7. Colours come from `--i7-tint`, which the White and the
  OLED Black tone blocks both set, so both tones are covered by the one rule.
- Pressed: altstore.css's `.alert-button.blue.is-pressed` (0,3,0) loses to ios7.css's
  `html[data-style="ios7"] .alert-button.is-pressed` (0,3,1), and `:active` likewise, so it takes the kit's highlight.
- Extended ios6-css.test.js's F333 test: each of cancel/green/red/blue is listed in the flat rule, and pressed uses
  `--i7-alert-pressed`.
- Note: by specificity the base `html[data-style="ios7"] .alert-button` (0,2,1) already beat altstore's
  `.alert-button.blue` (0,2,0); listing .blue makes it explicit and safe against a more specific altstore rule later.

**Not verified**
- No rendered check of the Too Big alert in a browser or on a device: the change is one selector added to an
  existing rule, checked by the CSS test and the specificity reasoning above.
