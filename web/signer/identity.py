"""The signing identity a visitor sends with POST /sign: their .p12 (key and certificate) and provisioning profile.

Everything here works on bytes in memory and returns objects in memory: nothing is written anywhere. The checks
give the clear errors the page shows (a wrong password, an expired certificate or profile, a certificate the profile
doesn't list, a profile whose app ID doesn't fit the app) before any IPA is downloaded.
"""
from __future__ import annotations

import datetime as dt
import plistlib
from dataclasses import dataclass, field

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

# OID 1.2.840.113549.1.7.1 (pkcs7-data), DER-encoded: every PKCS#12 file wraps its contents in one.
_PKCS7_DATA = bytes.fromhex("06092a864886f70d010701")


class SignError(Exception):
    """`code` names the failure for the page (signing.js maps a few to their own wording); `status` is the HTTP
    status the server answers with."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class Identity:
    key: object
    cert: x509.Certificate
    cas: list = field(default_factory=list)

    @property
    def name(self) -> str:
        return _attr(self.cert.subject, NameOID.COMMON_NAME) or self.cert.subject.rfc4514_string()

    @property
    def team(self) -> str | None:
        return _attr(self.cert.subject, NameOID.ORGANIZATIONAL_UNIT_NAME)

    @property
    def expires(self) -> dt.datetime:
        return self.cert.not_valid_after_utc

    def der(self) -> bytes:
        return self.cert.public_bytes(serialization.Encoding.DER)

    def unlocked_p12(self) -> bytes:
        """The same key, certificate and chain as an unencrypted PKCS#12, for zsign (signer/zsign.py hands it over
        in memory). Unencrypted, so the visitor's password never reaches a command line."""
        return pkcs12.serialize_key_and_certificates(b"cydian", self.key, self.cert, self.cas or None,
                                                     serialization.NoEncryption())


@dataclass
class Profile:
    name: str
    team: str | None
    team_name: str | None
    app_id: str            # application-identifier without the team prefix: "*", "com.example.*", "com.example.app"
    expires: dt.datetime
    devices: int           # ProvisionedDevices; 0 with all_devices (enterprise) too
    all_devices: bool
    certs: list            # DeveloperCertificates, DER bytes each
    entitlements: dict


def _attr(name: x509.Name, oid) -> str | None:
    got = name.get_attributes_for_oid(oid)
    return str(got[0].value) if got else None


def _utc(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def load_p12(data: bytes, password: str) -> Identity:
    if not data:
        raise SignError("bad_p12", "No certificate (.p12) was sent.")
    try:
        key, cert, cas = pkcs12.load_key_and_certificates(data, (password or "").encode("utf-8") or None)
    except ValueError:
        # cryptography says "invalid password or PKCS12 data" for both: a file that is PKCS#12-shaped means the
        # password is what's wrong.
        if data[:1] == b"\x30" and _PKCS7_DATA in data[:64]:
            raise SignError("bad_password", "The certificate's password is wrong.") from None
        raise SignError("bad_p12", "That file is not a .p12 certificate.") from None
    except Exception:  # noqa: BLE001 - an unsupported algorithm and the like: still the visitor's file
        raise SignError("bad_p12", "This .p12 could not be read.") from None
    if key is None or cert is None:
        raise SignError("bad_p12", "This .p12 has no private key and certificate in it: export both from Keychain.")
    return Identity(key, cert, list(cas or []))


def parse_profile(data: bytes) -> Profile:
    """A .mobileprovision is a CMS SignedData whose content is an XML plist; the plist is all we need."""
    if not data:
        raise SignError("bad_profile", "No provisioning profile was sent.")
    start, end = data.find(b"<?xml"), data.rfind(b"</plist>")
    if start < 0 or end < start:
        raise SignError("bad_profile", "That file is not a provisioning profile (.mobileprovision).")
    try:
        p = plistlib.loads(data[start:end + len(b"</plist>")])
    except Exception:  # noqa: BLE001
        raise SignError("bad_profile", "The provisioning profile could not be read.") from None
    if not isinstance(p, dict):
        raise SignError("bad_profile", "The provisioning profile could not be read.")
    ent = p.get("Entitlements") if isinstance(p.get("Entitlements"), dict) else {}
    teams = p.get("TeamIdentifier") or []
    team = teams[0] if teams else ent.get("com.apple.developer.team-identifier")
    full = str(ent.get("application-identifier") or "")
    prefixes = list(p.get("ApplicationIdentifierPrefix") or []) + ([team] if team else [])
    app_id = full
    for pre in prefixes:
        if full.startswith(pre + "."):
            app_id = full[len(pre) + 1:]
            break
    expires = p.get("ExpirationDate")
    if not isinstance(expires, dt.datetime):
        raise SignError("bad_profile", "The provisioning profile has no expiry date.")
    return Profile(
        name=str(p.get("Name") or ""), team=team, team_name=p.get("TeamName"), app_id=app_id,
        expires=_utc(expires), devices=len(p.get("ProvisionedDevices") or []),
        all_devices=bool(p.get("ProvisionsAllDevices")),
        certs=[bytes(c) for c in p.get("DeveloperCertificates") or []], entitlements=ent)


def check(identity: Identity, profile: Profile, now: dt.datetime | None = None) -> None:
    """Refuse a pair that cannot sign anything: expired, not yet valid, or a certificate the profile doesn't list."""
    now = now or dt.datetime.now(dt.timezone.utc)
    day = lambda t: t.strftime("%-d %b %Y")  # noqa: E731
    if identity.expires < now:
        raise SignError("cert_expired", f"The certificate expired on {day(identity.expires)}.")
    if identity.cert.not_valid_before_utc > now:
        raise SignError("cert_not_yet_valid", f"The certificate is not valid until {day(identity.cert.not_valid_before_utc)}.")
    if profile.expires < now:
        raise SignError("profile_expired", f"The provisioning profile expired on {day(profile.expires)}.")
    if identity.der() not in profile.certs:
        raise SignError("cert_not_in_profile",
                        "This provisioning profile doesn't list this certificate: use the profile made for it.")


def target_bundle_id(profile: Profile, bundle_id: str) -> str:
    """The bundle ID the app is signed as. A wildcard profile keeps the app's own ID if it fits; an explicit one
    signs it as the profile's ID (one app ID, one app)."""
    app_id = profile.app_id
    if app_id == "*":
        return bundle_id
    if app_id.endswith(".*"):
        if bundle_id.startswith(app_id[:-1]):
            return bundle_id
        raise SignError("app_id_mismatch",
                        f"The provisioning profile is for {app_id}, which doesn't fit this app ({bundle_id}). "
                        "Use a wildcard profile or one made for this app.")
    if not app_id:
        raise SignError("bad_profile", "The provisioning profile has no app ID.")
    return app_id
