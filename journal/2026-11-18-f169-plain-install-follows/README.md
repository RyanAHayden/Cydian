# F169: plain Install follows iOS's install (Open <app>)

## Did
- `web/app/signing-client.js` installOnDeviceOnce: with no `after`, when signing.install answers a `bundleId`,
  it now calls signing-sheet.js `followInstall` (dynamic import, as installFromLibrary does; injectable as the
  `follow` dep), so the progress page ends on F155's "Open <app>" rather than Done + Return to Cydian.
- Not followed for Cydian itself: `host: true`, an `isSelfIpa(url)` URL, or a result whose bundleId is
  `CYDIAN_ID`. The last two catch core/selfupdate.js, which installs Cydian's release without `host`.
  Those cases, and an answer with no bundleId, still end on Done after 1200 ms.
- Tests in `signing-client-device.test.js`: the existing phases test now expects the follow; new tests cover the
  ID/name handed over, the real followInstall reaching `finish({ label: "Open X" })`, no bundleId -> Done, and
  Cydian's own IPA/ID -> Done.

## Tried, failed
- Putting the `host: true` case in the Cydian test: `showBanner` needs `document`, which node doesn't have.
  I took the case out instead of mocking the DOM.

## Not verified
- On a device: no iPhone in this unattended run. Whether signing.install's answer carries the *signed* bundleId
  (the wildcard profile's ID) is taken from F155/Custom Install, which already uses `result.bundleId` this way.
- The `host: true` skip isn't covered by a test (it needs the DOM banner, see above). It's one plain condition.
