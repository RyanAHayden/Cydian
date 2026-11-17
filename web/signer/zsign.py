"""Running zsign (https://github.com/zhlynn/zsign, MIT, built into the Docker image) on one IPA.

The key and certificate reach zsign without touching a disk: they go into anonymous in-memory files (memfd_create)
that the child inherits and opens as /dev/fd/N. The p12 handed over is unencrypted (identity.unlocked_p12), so no
password is ever on a command line. The provisioning profile goes the same way. Only the IPA itself, unpacked by
zsign into the job's own work folder, is on disk, and the caller removes that folder when the job ends.
"""
from __future__ import annotations

import os
import plistlib
import re
import shutil
import subprocess

from .identity import SignError

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def find() -> str | None:
    """CYDIAN_ZSIGN, else zsign on PATH."""
    path = os.environ.get("CYDIAN_ZSIGN")
    if path:
        return path if os.access(path, os.X_OK) else None
    return shutil.which("zsign")


def _memfd(name: str, data: bytes) -> int:
    fd = os.memfd_create(name, os.MFD_CLOEXEC)
    view = memoryview(data)
    while view:
        n = os.write(fd, view)
        view = view[n:]
    return fd


def sign(binary: str, ipa_in: str, ipa_out: str, p12: bytes, profile: bytes, workdir: str,
         bundle_id: str | None = None, timeout: float = 300.0, entitlements: dict | None = None) -> None:
    """Sign `ipa_in` into `ipa_out` with the profile's entitlements (zsign takes them from -m). Raises SignError."""
    if not hasattr(os, "memfd_create"):
        raise SignError("unsupported", "This server can't sign: it needs Linux (memfd_create).", 501)
    fds = []
    try:
        fds.append(_memfd("cydian-identity", p12))
        fds.append(_memfd("cydian-profile", profile))
        cmd = [binary, "-f", "-q", "-k", f"/dev/fd/{fds[0]}", "-m", f"/dev/fd/{fds[1]}", "-t", workdir,
               "-z", "6", "-o", ipa_out]
        if bundle_id:
            cmd += ["-b", bundle_id]
        if entitlements is not None:  # the app's own entitlements (identity.app_entitlements), not the profile's raw ones
            fds.append(_memfd("cydian-entitlements", plistlib.dumps(entitlements)))
            cmd += ["-e", f"/dev/fd/{fds[-1]}"]
        cmd.append(ipa_in)
        try:
            r = subprocess.run(cmd, cwd=workdir, pass_fds=fds, stdin=subprocess.DEVNULL, capture_output=True,
                               timeout=timeout, env={"PATH": "/usr/bin:/bin", "HOME": workdir, "TMPDIR": workdir})
        except subprocess.TimeoutExpired:
            raise SignError("timeout", f"Signing took longer than {timeout:g} s.", 504) from None
        except OSError as e:
            raise SignError("sign_failed", f"zsign could not run: {e.strerror}", 500) from None
    finally:
        for fd in fds:
            os.close(fd)
    if r.returncode != 0 or not os.path.exists(ipa_out):
        out = _ANSI.sub("", (r.stdout + r.stderr).decode("utf-8", "replace"))
        lines = [l.strip(" >\t") for l in out.splitlines() if l.strip()]
        why = next((l for l in reversed(lines) if "fail" in l.lower() or "invalid" in l.lower()), lines[-1] if lines else "")
        raise SignError("sign_failed", f"Signing failed{': ' + why if why else ''}.", 500)
