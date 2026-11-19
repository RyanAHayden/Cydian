# F247 Single install opens on the Log

## What I did

- `web/app/nav/progress.js`: `startView(count)` ("log" for exactly one item, else "pane") and `openOn(page, seg,
  count)`, which selects the segmented control's tab and shows that view.
- `web/app/screens/apprun.js` (IPA run) and `web/app/screens/queuerun.js` (install run) call `openOn(page, seg,
  rows.length)` where they used to call `page.view("pane")`. The Packages/Apps tab still switches to the list.
- "Any other single install on that page": the other users of the black page are `progressHUD` jobs (the website's
  and Lite's single installs through signing-client.js). They have no rows list or tabs and already show only the log,
  so nothing changed there.
- The install run counts **rows**, meaning what apt's plan changes. Queuing one package that pulls in a dependency
  gives two rows, so that run opens on the list. I chose this because the list is useful as soon as there is more
  than one thing to follow.
- Tests: `nav/progress.test.js` (startView/openOn), `screens/apprun.test.js` and `screens/queuerun.test.js` (a run
  of one opens on Log with tab 1 selected; a run of two opens on the list with tab 0 selected).

## Tried and failed

Nothing.

## Not verified

- I did not look at it on a device or in a browser (iPhone 7 .deb, Lite, the website). The task did not ask for a
  phone test, and the change only picks which tab and view the page opens on, using the same calls the tab taps
  already make. The node tests cover that with a fake page.
