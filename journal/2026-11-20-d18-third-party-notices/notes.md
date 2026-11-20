# D18: third-party notices and one idevice pin

## Done

- `native/sideload/idevice/LICENSE`: idevice's MIT licence, fetched from `LICENSE.txt` at the pinned commit
  (2dca9a58…) with `gh api`. Listed in that folder's README.
- `native/test_notices.py`:
  - the Credits screen (`renderCredits` in `web/app/screens/home.js`) has a row labelled zsign, OpenSSL, zlib,
    idevice, Tailscale and ElleKit;
  - the idevice LICENSE is there and is the MIT text naming Jackson Coxson;
  - `tools/setup/cli/Cargo.toml`'s idevice `rev` equals `IDEVICE_COMMIT` in `pin.env`.
  Each check also has a case showing it would fail on a renamed label or a moved rev.
- Credits > Software only named ElleKit and Canister, so the new test would have failed. I added five rows there
  (zsign, OpenSSL, zlib, idevice, Tailscale: author, what it's for and its licence, each linking to its project).
  `home.js` is not in the task's file list. I changed it anyway, because the brief's check can't pass without it.
  The rows are added inside the Software group only. The group's footer is unchanged: it is already longer than the
  footer rule's one or two sentences, and adding the licences there would make it worse.

## Checked

- `python3 -m unittest native/test_notices.py`: 5 OK.
- By hand: renamed the Tailscale row to "Tailnet" and changed the pin's last hex digit. Both tests failed with
  clear messages, then passed again once the edits were reverted.
- `node --test web/app/screens/`: 804 pass, 0 fail.

## Not verified

- I took no screenshot of the Credits screen with the new rows. It is low priority, and the rows use the same
  `thanks-row` cell as the ElleKit and Canister rows already there.
- The root README's Credits section still names only zsign and OpenSSL among these. It is outside this task's
  files, and D-tasks D17/D19 are already editing docs.
