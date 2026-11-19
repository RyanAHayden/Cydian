# README crops

Cropped screenshots beside the README's Install steps, Host your own server and iFizBox Account, and in
worker/README.md and docs/developer-account.md (`docs/img/crop-*.png`).

Retake:

```sh
REVIEWS_DB=off PORT=8817 HOST=127.0.0.1 node worker/node.mjs &
node capture.mjs http://127.0.0.1:8817/ RAW website.json
APP_VERSION=99.0 node capture.mjs http://127.0.0.1:8817/ RAW sideload.json --mode sideload
python3 crop.py RAW docs/img
```

- capture.mjs is T12's with `--mode sideload` (the fake shell as the sideload app, no phone dir: the Signing Server
  group only shows there) and a `rect` step (element boxes in points, to pick the bands in crop.py).
- APP_VERSION above the release, or the sideload page shows the "iFizBox x.y is out" banner under the nav bar.
- crop.py stacks the nav bar (points 62-106) on a band of the page, rounds the top corners and fades the bottom 14
  points. End each band on blank page below its last text: a fade over text looks muddy on GitHub's dark theme.
