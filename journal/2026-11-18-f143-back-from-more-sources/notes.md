# F143: Back from a source opened in Manage > More Sources

## Cause
Manage's More Sources rows link to `#/sources/<key>`. From Home, Manage is mounted (`#/home/~sources/manage`), and
`mountLink` rebased every link to Sources onto that mount: `#/home/~sources/<key>`, which threw Manage away, so
Back went to Home. From the Sources tab the same link was a plain same-tab route: the stack replaced Manage
(`sources/manage` -> `sources/<key>`), so Back went to the Sources root.

## Fix (web/app/router.js `mountLink`, no page special-cased)
- A link that leaves the branch it is on for another branch of the same tab (first segment of the shown pages
  differs: `manage` -> `<key>`) mounts that tab again on top: `#/sources/manage/~sources/<key>`,
  `#/home/~sources/manage/~sources/<key>`. `mounted`, `prefixes` and `parent` already handle nested mounts
  (innermost wins, mounts skipped), so the stack holds Manage below the source, and Back (history.back or the
  replace on a deep link) walks Source > Manage > Home/Sources.
- Links inside a mount use the innermost mount of that tab (`lastIndexOf`), so the source's own package links
  stay in the inner mount.
- A link to a page the route stands on (`parent`, which Back's replace uses) stays a pop, never a new mount.
- Unchanged: pushes into the current branch, siblings under a shared first segment (`x/y` -> `x/z`), a tab's root,
  and same-tab links from inside another tab's mount (Home > About).

Behaviour change worth knowing: any link between two top-level branches of a tab now pushes instead of
replacing. One F123 router assertion used such a link (Settings `iosVersion` -> `device` inside a mount); it is
now a push, and the test keeps its "stays in the mount" case with a within-branch link. Manage's preview Add
(`manage/recommended/<key>` -> `<key>`) likewise pushes now: Back from the added source shows the preview.

## Tests
`web/app/router.test.js`: Home > Manage > source (> package) > Back = source, Manage, Home (with the stacks); the
same from the Sources tab; a reload on the nested route (no history, Back replaces); and the plain cases that
must stay null.

## Not verified
- On a phone or browser (Safari's own edge swipe on the web, our swipe in the native app): not run, the gate has
  no browser; the swipe calls the same goBack the tests emulate.
