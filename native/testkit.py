"""Throwaway signing material for the Swift signer's tests (native/test_sign.py, native/test_sideload.py; moved here
from web/signer/ when the server went, 9905b05): a self-signed "Apple Development"
certificate in a .p12, a provisioning profile that lists it (a CMS-signed plist, the shape Apple's are), and a tiny
IPA whose app is one hand-built arm64 Mach-O. Nothing here is Apple's, and nothing here runs on a phone: it only has
to be what the signer (native/sign/) reads and checks. Needs only `cryptography`.
"""
from __future__ import annotations

import datetime as dt
import io
import plistlib
import struct
import zipfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7, pkcs12
from cryptography.x509.oid import NameOID

TEAM = "TESTTEAM42"


def _name(cn: str, team: str | None = None, uid: str | None = None) -> x509.Name:
    attrs = []
    if uid:
        attrs.append(x509.NameAttribute(NameOID.USER_ID, uid))
    attrs.append(x509.NameAttribute(NameOID.COMMON_NAME, cn))
    if team:
        attrs.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, team))
    attrs += [x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Test Person" if team else "iFizBox Test CA"),
              x509.NameAttribute(NameOID.COUNTRY_NAME, "US")]
    return x509.Name(attrs)


def ca():
    """(key, cert): a throwaway CA standing in for Apple's WWDR intermediate (zsign wants the leaf's issuer)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = _name("iFizBox Test Worldwide Developer Relations CA")
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(start)
            .not_valid_after(start + dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                         crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .sign(key, hashes.SHA256()))
    return key, cert


_CA = None


def identity(team: str = TEAM, name: str = "Apple Development: Test Person (ABCDE12345)", days: int = 365,
             not_before: dt.datetime | None = None):
    """(key, cert, ca_cert): RSA-2048 and a certificate issued by the test CA whose subject carries the team as
    OU, as Apple's do."""
    global _CA
    if _CA is None:
        _CA = ca()
    ca_key, ca_cert = _CA
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    start = not_before or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1))
    cert = (x509.CertificateBuilder().subject_name(_name(name, team, "ABCDE12345")).issuer_name(ca_cert.subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(start)
            .not_valid_after(start + dt.timedelta(days=days))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                         crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([x509.ObjectIdentifier("1.3.6.1.5.5.7.3.3")]), critical=True)
            .sign(ca_key, hashes.SHA256()))
    return key, cert, ca_cert


def p12(key, cert, ca_cert=None, password: str = "hunter2", legacy: bool = False) -> bytes:
    """A .p12 as Keychain exports one: key, certificate and (here) the issuer. `legacy`: SHA-1 and 3DES, as older
    Keychain and OpenSSL 1.x write them; otherwise AES-256 and PBKDF2 (OpenSSL 3's default)."""
    if not password:
        enc = serialization.NoEncryption()
    elif legacy:
        enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
               .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1())
               .build(password.encode()))
    else:
        enc = serialization.BestAvailableEncryption(password.encode())
    return pkcs12.serialize_key_and_certificates(b"Test Person", key, cert, [ca_cert] if ca_cert else None, enc)


def profile(key, cert, team: str = TEAM, app_id: str = "*", days: int = 7, devices: int = 3,
            extra_certs=(), name: str = "Test Profile", now: dt.datetime | None = None) -> bytes:
    """A provisioning profile: the plist Apple's carry, CMS-signed (here by the same throwaway key)."""
    now = (now or dt.datetime.now(dt.timezone.utc)).replace(microsecond=0, tzinfo=None)
    plist = {
        "AppIDName": "Test",
        "ApplicationIdentifierPrefix": [team],
        "CreationDate": now - dt.timedelta(days=1),
        "Platform": ["iOS"],
        "DeveloperCertificates": [c.public_bytes(serialization.Encoding.DER) for c in (*extra_certs, cert)],
        "Entitlements": {
            "application-identifier": f"{team}.{app_id}",
            "com.apple.developer.team-identifier": team,
            "get-task-allow": True,
            "keychain-access-groups": [f"{team}.*"],
        },
        "ExpirationDate": now + dt.timedelta(days=days),
        "Name": name,
        "ProvisionedDevices": [f"00008110-{i:016X}" for i in range(devices)],
        "TeamIdentifier": [team],
        "TeamName": "Test Person",
        "TimeToLive": days,
        "UUID": "11111111-2222-3333-4444-555555555555",
        "Version": 1,
    }
    data = plistlib.dumps(plist, fmt=plistlib.FMT_XML)
    return (pkcs7.PKCS7SignatureBuilder().set_data(data).add_signer(cert, key, hashes.SHA256())
            .sign(serialization.Encoding.DER, []))


def macho(entry: bytes = b"\xc0\x03\x5f\xd6") -> bytes:
    """A minimal arm64 MH_EXECUTE: __PAGEZERO, __TEXT (one __text section: `ret`), __LINKEDIT, LC_MAIN. Not
    something iOS would launch (no dyld, no libSystem), but every structure a signer walks is there."""
    page = 0x4000
    text_size = len(entry)
    text_off = page - 64  # code near the end of the first page, leaving room after the load commands
    seg = struct.Struct("<II16sQQQQiiII")
    sect = struct.Struct("<16s16sQQIIIIIIII")
    cmds = []
    cmds.append(seg.pack(0x19, seg.size, b"__PAGEZERO", 0, 0x100000000, 0, 0, 0, 0, 0, 0))
    text = seg.pack(0x19, seg.size + sect.size, b"__TEXT", 0x100000000, page, 0, page, 5, 5, 1, 0)
    text += sect.pack(b"__text", b"__TEXT", 0x100000000 + text_off, text_size, text_off, 2, 0, 0,
                      0x80000400, 0, 0, 0)
    cmds.append(text)
    linkedit_size = 16
    cmds.append(seg.pack(0x19, seg.size, b"__LINKEDIT", 0x100000000 + page, page, page, linkedit_size, 1, 1, 0, 0))
    cmds.append(struct.pack("<IIQQ", 0x80000028, 24, text_off, 0))  # LC_MAIN
    lc = b"".join(cmds)
    header = struct.pack("<IiiIIIII", 0xFEEDFACF, 0x0100000C, 0, 2, len(cmds), len(lc), 0x00200085, 0)
    body = bytearray(page + linkedit_size)
    body[:len(header) + len(lc)] = header + lc
    body[text_off:text_off + text_size] = entry
    return bytes(body)


def ipa(bundle_id: str = "dev.ifizbox.fixture", name: str = "Fixture", version: str = "1.0") -> bytes:
    """A tiny IPA: Payload/Fixture.app with Info.plist, the Mach-O and a resource file."""
    info = {
        "CFBundleExecutable": name, "CFBundleIdentifier": bundle_id, "CFBundleName": name,
        "CFBundleDisplayName": name, "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version,
        "CFBundleVersion": "1", "MinimumOSVersion": "14.0", "CFBundleSupportedPlatforms": ["iPhoneOS"],
        "UIDeviceFamily": [1],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        app = f"Payload/{name}.app/"
        z.writestr(app + "Info.plist", plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
        zi = zipfile.ZipInfo(app + name, date_time=(2026, 11, 17, 0, 0, 0))
        zi.external_attr = 0o100755 << 16
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, macho())
        z.writestr(app + "hello.txt", "Hello from iFizBox's signer test.\n")
    return buf.getvalue()
