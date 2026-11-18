# T9: the Swift signer tests' fixture kit is back

9905b05 deleted the server, and `web/signer/testkit.py` went with it. `native/test_sign.py` and
`native/test_sideload.py` import that file, so the gate quietly skipped every Swift signer test on every machine.
They skipped as "cryptography not installed", which wasn't the real reason.

## What I did
- `native/testkit.py`: `git show 9905b05^:web/signer/testkit.py`, unchanged apart from the docstring (it now says
  who uses it and where it came from). It needs only `cryptography`.
- `native/test_sign.py`: puts `native/` on sys.path in place of `web/` and runs `import testkit`. When the import
  fails, the skip reason gives the ImportError and the python that lacks the module (`MISSING`).
- `native/test_sideload.py`: drops the `web/` path and uses the same `MISSING` reason (taken from test_sign, or
  its own when its cryptography import fails).
- The gate's python (`python3`) here has cryptography 50.0.2, and SWIFT_TOOLCHAIN is set (swift 6.4.2), so the
  tests now run in the gate. Results below.

## Left alone (outside the task's files)
- `native/sign/tests/main.swift:5` and `docs/signing.md:282` still name `web/signer/testkit.py` in comments and
  prose. These are one-word fixes for whoever touches those files next.

## Results
- `python3 -m unittest discover -v -s native -t native -p 'test_si*.py'`: 9 tests, all OK, none skipped
  (test_sign.OnDeviceSigner.test_swift, test_sideload.Sideload.test_swift, the OCSP request and signed-with-edits
  checks, plus the source tests). 35 s.
- The skip reason: I stubbed the module out (`sys.modules['testkit']=None`), and MISSING read
  "import of testkit halted; … (pip install cryptography for /usr/bin/python3)".

## Not verified
- A real machine without cryptography: this one has it, so I checked the skip text only with the stub above.
- Other runner machines: whether their gate python has cryptography or SWIFT_TOOLCHAIN. If not, the tests skip
  and say which one is missing.
