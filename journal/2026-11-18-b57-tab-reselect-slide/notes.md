# B57: tab bar reselect jumps to the top instead of sliding

## Cause (measured on the iPhone 7, iOS 15.8.8)
**The overflow toggle.** F148's `scrollToTop` set `overflow-y: hidden`, forced a layout and cleared it (to stop a
coasting fling), then called `scrollTo({top: 0, behavior: "smooth"})`. Right after that toggle, WebKit does the smooth
scroll as an instant jump. Reduce Motion was off on the phone (no ReduceMotion key in
`com.apple.Accessibility.plist`, and the probe read `prefers-reduced-motion: reduce` as false), so that wasn't it.
Smooth scrolling itself works in this WebKit.

`probe.html` (here) is a `.page-body`-like box with a tab-bar-like button. scrollTop was logged on every rAF for 900 ms
after the tap, starting from 4000 px (`safari-frames.jsonl`, Safari 15.6.8 UA):

| `?m=` | what the tap does | scrollTop per frame |
|---|---|---|
| smooth | `scrollTo` smooth alone | 4000, 3985, 3912, 3781 … 51, 3, 0: **slides**, ~300 ms, ease-in-out |
| toggle | the F148 code: toggle, then smooth | 4000, 4000, **0**: the jump |
| tonly | the toggle alone | stays at 4000 (the toggle doesn't move it, it just breaks the smooth call after it) |
| raf | the B57 code | 4000, 3960, 3217, 2695 … 11, 2, 0: **slides**, 20 frames, ease-out |

During a fling (`phonectl swipe` and a tap 0.2 s later), heading away from the top: raf 4793 → 0 in 18 frames,
toggle 4776 → 0 in one frame, smooth 4732 → 4749 (momentum still going) → 0. Heading toward the top, raf and smooth both
reached 0.

## Fix
`web/app/nav/tabbar.js` `scrollToTop`: it still stops momentum with the toggle first, then slides by setting scrollTop
on each requestAnimationFrame: `TOP_MS` = 300 ms, ease-out cubic, ending exactly on 0. A touchstart on the list stops
the slide where it is, and a second call replaces a running slide. Reduced motion: one `scrollTop = 0`. With no
`requestAnimationFrame` (node fakes in `statusbar.test.js`, which this task doesn't own) it falls back to
`scrollTo`, so those tests stay as they are. The status-bar tap (F167, `statusbar.js`) uses the same function and
slides too.

I chose rAF over "toggle, then native smooth on the next frame" because the brief asks for ease-out (WebKit's native
smooth scroll is ease-in-out, slow off the mark), and we want one curve we control. Cost: the slide's ~18 frames
run on the main thread at rAF rate (60 Hz in Safari, per R17), for 300 ms once per tap. Momentum scrolling isn't
touched. A transform-based slide for 120 Hz wasn't needed on this 60 Hz phone; see Not verified.

Tests: `web/app/nav/tabbar-slide.test.js` (frames are stepped by hand: ≥10 in-between positions, never moves back
down, ~300 ms, ease-out, lands on 0; reduced motion = one write; touch stops it; a second tap replaces the first; a
frame stamped before the tap doesn't push the list down). `tabbar.test.js` keeps the no-rAF fallback test.

## In the jailbreak app
I built `native/build.sh deb` (0.9.7-1426, this branch) and installed it on the 7 over 0.9.7-1415, then left it
installed. On the Installed tab I scrolled down and tapped Installed:
- `app-old-jump.jpg`: the old build (1415), before | 50 ms after the tap: already at the top.
- `app-new-slide.jpg`: the new build. The first panel is the earlier run's start position (the burst run started
  a bit further up). Then a burst of screenshots after the tap, about 0–185, 185–310 and 310–400 ms: the list in the
  L section, then partway up (A section, search bar not in view yet), then at the top. A screenshot takes ~100–180 ms,
  so a burst catches only about two frames of the slide.
- `safari-raf-mid.jpg`: Safari, the probe 50 ms after the tap: row 23 on the way from row 45 to row 0.

The server, the `ssh -R` tunnel and the UI lock were all released afterwards, and the phone was left on the home screen.

## Not verified
- **A real screen recording.** phonectl takes stills only, ~100–180 ms each, so smoothness on screen is shown by the
  per-frame scrollTop log (main thread's view) and two mid-slide stills, not by video. A person's eye on the phone is
  the final check for feel.
- **Reduced motion on the phone.** I didn't toggle Reduce Motion in Settings (no tool for it through ui-7.sh);
  the node test covers the instant jump.
- **120 Hz phones.** The iPhone 7 is 60 Hz. On ProMotion, WebKit runs rAF at ~60 fps by default (R17), so the slide
  updates at 60 Hz there. The brief's transform-then-scrollTop variant for 120 Hz wasn't done; file it if a 120 Hz
  check shows judder.
- **Per-frame timing inside the app's WKWebView.** The app can't post logs to the probe server, so in the app the
  stills are the only evidence. Safari and the app run the same iOS 15.8 WebKit.
