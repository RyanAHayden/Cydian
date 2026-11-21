# B278: an app installed in a background run was never recorded

The B264 phone check (iPhone 15 Pro, iOS 27): two upgrades in one run, iFizBox on the Home Screen right after
Confirm. Both apps went to 2.0 (`ios apps`), but the page's record still had Alpha at 1.0, so Changes kept Alpha's
upgrade. Beta was recorded. That run kept no page log.

## Why it was skipped

- The run went through the This iPhone route: Home right after Confirm leaves nobody to tap an iOS prompt, and the
  B264 notes say only This iPhone was run. On that route `signing.open` answers once installd has the app, and the
  shell always sends `installed: true` (`SignAhead.open`, `servers.local`). `openPrepared` passes it on, so the row
  ends `installed` with `unsure` off. That holds even with `f.away` set by the page going hidden.
- So `recordWhen(row)` is "now" at once (B136: `!row.unsure`), and `recordIf` wrote the record at the row's end.
  recordWhen didn't refuse it. The B236 null/`fetched` rule only applies to unsure rows.
- The only way such a row ends with no record is `record(job)` throwing. `recordIf` swallowed that ("no store")
  and kept the row in `recorded`, so it never tried again. `followHandoff` only asks about rows that ended unsure,
  so nothing else ever came back to Alpha.
- Why it throws only sometimes: Alpha's end came while iFizBox was in the background (in the B264 3.0 run, Alpha's
  `signing.open` answered while hidden). Beta's record ran once the page woke up in front. My best guess is that
  iOS suspends WebKit's storage process in the background and aborts the IndexedDB write that is going on (the
  store's `put` rejects with the transaction's abort). In the 3.0 run the same write got through while hidden,
  which fits a race with the suspension, not a write that always fails. **Not proven on the phone**, see below.

## The fix (`web/app/screens/apprun.js`)

- A record that throws is taken out of `recorded`. It is written again `RECORD_TRIES` (5) times, `RECORD_RETRY`
  (3 s) apart, and again on every return to the front, where the tries start over. Its Log gets a grey line
  (`Couldn't record Alpha as installed (<why>); trying again`), so the next phone check can see it.
- A retry only writes if `recordWhen` still says "now": a row that was retried or failed since then is dropped.
- When a retry is written, `onAppEnd` runs again, so the badge counts again as it does at an app's end (B264).
- The retries keep going after the run's page closes. They are about Installed's record, not about the page.
- Test: `web/app/screens/apprun-b278.test.js`: a failed first write is written by the retry while the other
  app's record is left alone, the tries run out while hidden and the return to the front writes it, and a write
  that works happens once.

## Tried and failed

- Nothing failed. I looked for a skip in recordWhen / recordIf first (an unsure This iPhone row, a `recorded` id
  left over from an earlier pass, `onChange` throwing before `recordIf`). None of them can happen on this route:
  `queue.clear` and `draw` don't throw, and each pass of a run has its own `recorded` map.

## Not verified

- **The IndexedDB abort on the phone.** I didn't run a background run on the iPhone 15 to catch the failed write.
  The B264 2.0 run had no log, and the failure is a race that a single run may not hit. The new grey Log line
  shows it when it happens. The next background run with two or more apps (B264's checks) should look for it.
- **A store whose IndexedDB connection is lost for good** (WebKit's "Connection to Indexed Database server lost"):
  `apps()` keeps its first open, so every retry would fail until the app restarts. Beta being recorded in the same
  run says this wasn't the case here. A reopen in `core/installed.js` is outside this task's files.
