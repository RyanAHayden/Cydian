# B119: bundleIdCapabilities GET without `limit`

Apple answers 400 PARAMETER_ERROR.ILLEGAL to `?limit=200` on `GET /v1/bundleIds/{id}/bundleIdCapabilities`
(real call 2026-11-19), so every API-key sign failed at the capabilities step.

## Done
- `web/app/core/asc.js` `appIdCaps`: request the path with no query string (comment says why).
- `web/app/core/asc.test.js` fake ASC: any query string on that path throws an AscError 400
  `PARAMETER_ERROR.ILLEGAL`, like Apple.
- Checked the fake bites: with the old asc.js swapped back in, 8 of 21 asc tests fail with that error; with the
  fix all 21 pass.

## Notes
- Without `limit` Apple uses its default page size; an App ID has only a handful of capabilities, so one page is
  enough. No pagination added.

## Not verified
- A real call to Apple with the fixed code: no API key or network access to App Store Connect from this
  unattended slot. The fix follows the coordinator's real-call finding.
