# B11: paid packages' nav bar Install

Problem (R10, iPhone 7): Havoc's Elysian ($3.49, signed out) offered the nav bar Install, whose sheet queued an apt
install (and Other Versions led to more apt installs). Havoc answers apt with 418; paid debs only come through
paid.install after the vendor authorizes them, so the queue could only fail.

## What I did

- `screens/extras.js`: `paidNav(info, signedIn, {...})` decides, from the vendor's package info, the nav button's
  label and the sheet's actions: the same step the Purchase group shows (Sign In / Buy for $x / Download & Install,
  nothing when not available or the vendor can't be asked). `drawApp` now builds its action row from it too, so the
  group and the nav button can't drift. `paymentGroup(st, source, ctx, { onState })` publishes that state each time
  the group is drawn (null when the source turns out to have no vendor); `paidStateOf(box)` answers it (waiting for
  the vendor's first answer). `soldByVendor(st, source)` for the Versions page. App only; the site is unchanged.
- `screens/browse.js`:
  - Nav label: the price (as Cydia showed it) until the vendor says purchased, then Install; Modify once installed.
    `rememberPackage` and N11's `refreshPackagePages` go through `buttonLabel`, which knows the paid label.
  - `packageActions`: for a vendor-sold paid package, `paidActions` instead of the apt sheet. Not installed: the
    Purchase step + Wish List (no Install, no Other Versions). Installed: Upgrade/Reinstall run Download & Install
    (only once bought; it fetches the page's version), Remove through the queue, no Downgrade (vendors only hand out
    the current deb).
  - Versions page: no queue rows for a vendor-sold paid package; the footer points to Download & Install.
- Decision (unattended): the nav tap opens a sheet rather than buying/installing straight away, so a purchase always
  takes a second, explicit tap.
- Tests: `screens/paidnav.test.js`.

Nothing tried failed.

## Not verified

- On the iPhone 7 with Havoc's Elysian: the task did not say to touch the phone (AGENTS.md: only when the task says
  so). Covered by unit tests of `paidNav`/`paidActions` only; the DOM wiring (label refresh on Sign In, the sheet
  from the real nav button, the Versions footer) was not seen on a device or in a browser.
- Other apt entry points for paid packages (Search's Add Source & Install, Wish List, Changes' Upgrade All) are not
  in this task's scope and were not checked; filed as B19.
