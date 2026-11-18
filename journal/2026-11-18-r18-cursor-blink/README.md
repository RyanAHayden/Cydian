# R18: does progress.css's blinking cursor blink on iOS 15? (2026-11-18)

**Yes.** `.progress-cursor` (`progress-blink 1s steps(1, end) infinite`, `@keyframes progress-blink { 50% { opacity: 0 } }`)
blinks in the app on the iPhone 7 (iOS 15.8.8, Cydian 0.5.0-974). Nothing to change. I only added a comment in
`web/app/progress.css` that records the check, so nobody "fixes" it later by analogy with F166.

## How

I used the same method as F166. I backed up the installed app's `web/index.html`, added a fixed black overlay before
`</body>`, killed the app, opened `cydian://home` and took screenshots with `tools/ui-7.sh` (under the lock, about 0.25 s
apart). Then I restored the backup, relaunched the app and checked a screenshot showed no overlay.

The overlay's columns, left to right:

1. `class="progress-cursor"`: the app's own rule, unchanged (only made larger)
2. the same with `animation-duration: 2.6s` (so screenshots ~0.25 s apart can't alias against a 1 s cycle)
3. the same as 2 with `will-change: opacity`
4. control: hold keyframes (`0%, 49.999% { opacity: 1 } 50%, 100% { opacity: 0 }`) with `linear`, 2.6 s, the way
   ios6.css's hud-spin works
5. control: `progress-blink` with `linear` (fades)
6. (second run) `transform: translateY(60px)` at 50 %, `steps(1, end)`, 2.6 s
7. (second run) the same move with hold keyframes and `linear`

Sampled grey level (169 = shown, 0 = hidden) over 24 frames in about 4 s, some of them:

```
frame  1s-steps  2.6s-steps  2.6s-steps+wc  hold  linear
 9        0         0            0           0     119
10      169         0            0           0     150
11      169       169          169         169     156
12        0       169          169         169     125
14      169       169          169         169      60
16        0         0            0           0       6
18      169         0            0           0      71
20        0         0            0           0     135
21        0       169          169         169     162
```

- The 1 s cursor is on about 0.5 s and off about 0.5 s.
- The 2.6 s steps() copies switch on the same frames as the hold-keyframes control, with and without `will-change`.
- `probe-before.png`: the first 8 frames, columns 1-5.
- `probe-vs-transform.png`: the second run, all 7 columns.

## Something F166's note doesn't cover

In the same session, column 6 (`steps(1, end)` on a **transform**, translateY) moved too, in step with its hold twin
(frames 8 and 13 in `probe-vs-transform.png`). So what F166 found (`rotate` to 360deg over `steps(12)` standing still)
doesn't apply to every steps() transform. A single step of a translate is fine on iOS 15. I didn't test which part
causes the freeze (the step count, rotate, or the interpolated 0 -> 360 range with nothing in between), because it's
outside this task and the hold keyframes fix the spinners either way.

## Not verified

- **The cursor on the real progress page during a real install.** The probe used the app's own `.progress-cursor` class
  and rule in the app's WKWebView, but in an overlay on Home. I didn't start an apt install on the test phone just to
  see a cursor. The real page could only differ through something that sets `animation` on an ancestor, and nothing in
  progress.css does.
- **The sideload IPA** (same `web/app/`, same WKWebView, no phone to install it on) and **iOS 16+**. I only checked iOS 15.
