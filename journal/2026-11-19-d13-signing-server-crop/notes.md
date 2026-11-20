# D13: retake crop-signing-server.png

`docs/img/crop-signing-server.png` showed the sideload settings page titled "Signing"; the page is
Settings > Installation & Signing now. Retook it with the README crops route
(`journal/2026-11-19-readme-crops/`: capture.mjs `--mode sideload` with `sideload.json`, then crop.py's
`crop()` for this one crop, band 352-531 points as before).

- The element box (`rect` step) is unchanged at 356-517 points, so the band in crop.py still fits; same size
  (804x446). Only the nav bar title differs from the old image (compared by eye).
- crop.py's `__main__` makes every crop and needs the website shots too; to retake one crop, import it and call
  `crop.crop(raw/"sl-signing.png", 352, 531)`.
- Failed first try: port 8817 (the readme-crops notes' port) was already held by a worker server running from the
  main checkout (not mine, left running), so my server died with EADDRINUSE and the first capture came from
  main's web/app. Retook on port 8873 from this worktree; the result was byte-identical. Pick a free port.

**Not verified**: none.
