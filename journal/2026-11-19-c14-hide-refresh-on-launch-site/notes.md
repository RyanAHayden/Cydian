# C14: hide Refresh Sources on Launch on the website

The website refreshes the sources by itself on every unlocked launch (websign-gate.js `refreshOnLaunch`, F250;
`launchRefresh` never reads the setting when `siteRefreshesItself`), so the Settings toggle did nothing there.

- `web/app/core/settings.js`: `refreshOnLaunch` modes `ALL` -> `BOTH` (jailbreak, sideload). Default unchanged
  (off for "site"), so `get()` on the site still answers false; app.js's `refreshSetting` already checks `isShown`.
- `web/app/core/settings.test.js`: site layout and site key list drop the row; the refresh test now checks
  `isShown` per mode.
- `docs/settings.md`: the General row and the key table say apps only (outside the task's file list, but the doc
  would otherwise describe a toggle the site no longer shows).

Edge case decided: a "site" mode page with only a legacy `ifizboxApp` bridge (no `ifizboxNative`) skips the site's
own refresh and used to fall back to the setting; it now never refreshes at launch. detectMode returns "site" only
without `ifizboxNative`, and every shipped shell sets `ifizboxNative`, so nothing real runs that path.

**Not verified**
- No look at the Settings page in a browser: the row list comes from `sections()`, which the unit tests cover.
