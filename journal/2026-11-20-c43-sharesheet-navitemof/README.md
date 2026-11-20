# C43: sharesheet.js uses navbar.js navItemOf

## What I did
- Removed `nav/sharesheet.js`'s own `navItemOf` (found the page's index among `.page` siblings and took the same index
  of `.nav-stack[data-tab] > .nav-item`). `setShare` now imports `navItemOf` from `nav/navbar.js`, which reads the
  page handle (`handleOf`, nav/go.js) registered by app.js `pageHandle(item, body)`.
- Checked every `setShare` caller (screens/handoff.js `setSourceShare`, called from browse.js `drawSections` and
  altstore.js `renderAltSource`): each passes the page body that app.js registered, so `handleOf` finds it.
- No import cycle: navbar.js imports only go.js, which imports only router.js.

## Found, filed
- B199 (critical): `close()` in sharesheet.js uses `easing: ease`, undefined since C26 renamed it `EASE`; every close
  throws before the scrim is removed and the promise resolves. Not this task's change, so filed, not fixed.

## Tried that failed
none

## Not verified
- The Share button on a real phone or in a browser: no device run; the change is a lookup swap the gate's tests cover
  through navbar.js/go.js.
