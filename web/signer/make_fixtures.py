"""Writes web/app/core/fixtures/signing/ for core/signing.test.js: throwaway certificates, fixed dates.

    .venv/bin/python web/signer/make_fixtures.py

The keys are made up for the tests and sign nothing real; they are public on purpose.
"""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from signer import testkit as T  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "app" / "core" / "fixtures" / "signing"
START = dt.datetime(2026, 11, 16, tzinfo=dt.timezone.utc)

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    key, cert, ca = T.identity(days=365, not_before=START)
    _, other, _ = T.identity(team="OTHERTEAM1", name="Apple Development: Someone Else (ZZZZZ99999)", not_before=START)
    (OUT / "test.p12").write_bytes(T.p12(key, cert, ca, password="hunter2"))
    (OUT / "test-legacy.p12").write_bytes(T.p12(key, cert, ca, password="hunter2", legacy=True))
    (OUT / "test.mobileprovision").write_bytes(
        T.profile(key, cert, app_id="*", days=7, devices=3, extra_certs=[other], name="Cydian Test Profile",
                  now=START + dt.timedelta(days=1)))
    print("wrote", OUT)
