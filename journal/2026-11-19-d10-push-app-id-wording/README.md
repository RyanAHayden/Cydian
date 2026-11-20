# D10: push wording, one App ID covers every app

- `docs/developer-account.md` step 3: replaced "One App ID per app" with: one App ID with Push covers every app's
  notifications (push goes to the Info.plist ID); apps on the same App ID share a keychain and App Groups, so an App
  ID per app is only for keeping those apart.
- `web/app/core/keepid.js` `profileNotes`: the `one-app` note (id kept, so settings.js's filter and the existing id
  tests still hold) now says the App ID covers every app's notifications and an ID per app only keeps keychain and
  App Groups apart, instead of "use it for one app".
- `keepid.test.js`: asserts the new wording and that "use it for one app" is gone.

Ran `node --test` on keepid.test.js and settings.test.js: 29 pass. Gate runs in `agent-runner done`.

Nothing tried that failed.

## Not verified

- How the longer note looks in the install sheet on a phone: no device check for a text-only change.
