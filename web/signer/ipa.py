"""Getting the IPA: an SSRF-guarded download to a file, and a look inside before zsign unpacks it.

The download uses the fetch proxy's guard (fetch.Fetcher.check: http(s) only, no private, loopback or link-local
address, the checked IP pinned for the connection, every redirect re-checked) but streams to disk with its own
caps, since an IPA is far bigger than anything /api/fetch buffers.
"""
from __future__ import annotations

import http.client
import plistlib
import re
import socket
import ssl
import time
import zipfile
from dataclasses import dataclass
from urllib.parse import urljoin

import fetch

from .identity import SignError

_FETCH_STATUS = {"bad_url": 400, "refused": 403, "too_large": 413, "timeout": 504, "network": 502, "upstream": 502}
_INFO = re.compile(r"^Payload/[^/]+\.app/Info\.plist$")


def _fail(e: fetch.FetchError) -> SignError:
    return SignError(e.code, f"Could not download the IPA: {e}", _FETCH_STATUS.get(e.code, 502))


def download(fetcher: fetch.Fetcher, url: str, dest: str, max_bytes: int, timeout: float) -> str:
    """Stream `url` into the file `dest`. Returns the final URL. Raises SignError."""
    deadline = time.monotonic() + timeout
    try:
        for _ in range(fetch.MAX_REDIRECTS + 1):
            target = fetcher.check(url)
            status, location = _get(fetcher, target, dest, max_bytes, deadline, timeout)
            if location:
                url = urljoin(url, location)
                continue
            if not 200 <= status < 300:
                raise SignError("upstream", f"Could not download the IPA: the server answered HTTP {status}.", 502)
            return url
        raise SignError("upstream", "Could not download the IPA: too many redirects.", 502)
    except fetch.FetchError as e:
        raise _fail(e) from None


def _get(fetcher, t, dest, max_bytes, deadline, timeout):
    def left():
        s = deadline - time.monotonic()
        if s <= 0:
            raise fetch.FetchError("timeout", f"gave up after {timeout:g} s")
        return s

    conn = fetch._PinnedConnection(t, fetcher, left())  # noqa: SLF001 - the same pinned, checked connection
    try:
        try:
            conn.putrequest("GET", t.path, skip_accept_encoding=True)
            for k, v in fetch.HEADERS.items():
                conn.putheader(k, v)
            conn.putheader("Accept", "*/*")
            conn.putheader("Connection", "close")
            conn.endheaders()
            sock = conn.sock
            fetch._settimeout(sock, left())  # noqa: SLF001
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308) and resp.getheader("location"):
                return resp.status, resp.getheader("location")
            if not 200 <= resp.status < 300:
                return resp.status, None
            length = resp.getheader("content-length") or ""
            if length.isdigit() and int(length) > max_bytes:
                raise SignError("too_large", f"The IPA is {int(length) // 2**20} MB, over this server's "
                                             f"{max_bytes // 2**20} MB limit.", 413)
            total = 0
            with open(dest, "wb") as f:
                while True:
                    fetch._settimeout(sock, left())  # noqa: SLF001
                    chunk = resp.read1(1 << 16)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise SignError("too_large", f"The IPA is over this server's {max_bytes // 2**20} MB limit.", 413)
                    f.write(chunk)
            return resp.status, None
        except socket.timeout:
            raise fetch.FetchError("timeout", f"gave up after {timeout:g} s") from None
        except ssl.SSLError as e:
            raise fetch.FetchError("network", f"TLS error: {e}") from None
        except (OSError, http.client.HTTPException) as e:
            raise fetch.FetchError("network", f"{type(e).__name__}: {e}") from None
    finally:
        conn.close()


@dataclass
class AppInfo:
    bundle_id: str
    name: str
    version: str


def inspect(path: str, max_unzipped: int, max_entries: int = 200_000) -> AppInfo:
    """Read Payload/<App>.app/Info.plist, refusing what isn't an IPA, a zip bomb or entries that leave the folder."""
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            if len(infos) > max_entries:
                raise SignError("bad_ipa", "The IPA has too many files.")
            total = 0
            plist_name = None
            for i in infos:
                parts = i.filename.replace("\\", "/").split("/")
                if i.filename.startswith(("/", "\\")) or ".." in parts or ":" in parts[0]:
                    raise SignError("bad_ipa", "The IPA has a file outside its folder.")
                total += i.file_size
                if plist_name is None and _INFO.match(i.filename):
                    plist_name = i.filename
            if total > max_unzipped:
                raise SignError("too_large", f"The IPA unpacks to over {max_unzipped // 2**20} MB.", 413)
            if not plist_name:
                raise SignError("bad_ipa", "That file is not an IPA: it has no Payload/<App>.app/Info.plist.")
            with z.open(plist_name) as f:
                info = plistlib.loads(f.read(4 * 2**20))
    except zipfile.BadZipFile:
        raise SignError("bad_ipa", "That file is not an IPA (not a zip archive).") from None
    except (plistlib.InvalidFileException, ValueError, OSError, EOFError):
        raise SignError("bad_ipa", "The IPA's Info.plist could not be read.") from None
    bundle_id = info.get("CFBundleIdentifier") if isinstance(info, dict) else None
    if not isinstance(bundle_id, str) or not bundle_id:
        raise SignError("bad_ipa", "The IPA's Info.plist has no bundle ID.")
    name = info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle_id
    version = info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or "1.0"
    return AppInfo(bundle_id, str(name), str(version))
