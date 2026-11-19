# B97: website signing's crash message never reads [object Object]

When zsign (WebAssembly) throws something other than emscripten's ExitStatus, websign-job.js formatted it as
`e?.message ?? e`, so a thrown plain object came out as "zsign stopped: [object Object]".

## What I did
- `web/app/websign-job.js`: new exported `zsignCrash(e)`. It returns "Out of memory" for a RangeError, a
  WebAssembly.RuntimeError (or anything named RangeError/RuntimeError), an emscripten abort or a message about
  memory/alloc, and for anything with no readable message (a bare object, null, an empty string). Otherwise it
  returns the error's own message. runSignJob uses it in the "zsign stopped: … The app may be too big" message.
- Decision: a thrown object with no message counts as out of memory. That's the case seen on the iPhone 7 (a second
  100 MB IPA in one tab), and the sentence after it already says the app may be too big. A RuntimeError from a real
  trap (`unreachable`) also reads "Out of memory". The brief asked for that, and on a phone memory is what fails.
- `web/app/websign-job.test.js`: the fake zsign gets a `throws` option. A new test checks a bare object, RangeError,
  RuntimeError, an "Aborted(OOM)" Error, an abort string, null, a TypeError (which keeps its own message) and that
  exit() ({ status }) still goes through zsign's log.

## Tried and failed
- The first version of the exit() check used `/stopped/`, which also matched zsign's normal "zsign stopped without
  saying why." I narrowed it to `stopped:|too big`.

## Not verified
- Re-running the out-of-memory case in a browser on the iPhone 7 (signing a 100 MB IPA twice in one tab). It needs
  the phone and a person, and an unattended run has neither. The logic is covered by the unit test with a thrown
  plain object.
