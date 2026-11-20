"""Throwaway signing material for signbench (native/sign/bench/main.swift): a PKCS#1 RSA key, its certificate and a
wildcard profile from native/testkit.py, written to the folder given (default native/sign/bench/build/fixtures).
They sign nothing that installs: the bench is about the time signing takes."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
import testkit as T  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "build", "fixtures")
os.makedirs(out, exist_ok=True)
key, cert, _ = T.identity()
files = {
    "key.der": key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.TraditionalOpenSSL,
                                 serialization.NoEncryption()),
    "cert.der": cert.public_bytes(serialization.Encoding.DER),
    "profile.mobileprovision": T.profile(key, cert),
}
for name, data in files.items():
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)
print(out)
