// core/p12cert.js: the certificate inside a .p12, read in the browser whatever the file encrypts it with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { p12Certificates, p12Serial, p12Leaf, p12LeafCert, des3Decryptor, rc2Decryptor } from "./p12cert.js";
import { certSerial, makeP12 } from "./freecert.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${n}`, import.meta.url)));
const hex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
const toHex = (b) => Buffer.from(b).toString("hex");
const CERT = fx("test-cert.der"), CA = fx("test-ca.der");
const SERIAL = certSerial(CERT);

test("DES-EDE3 and RC2 decrypt the published test vectors", () => {
  // FIPS 81's "Now is t" with one key three times (EDE = single DES)
  assert.equal(toHex(des3Decryptor(hex("0123456789abcdef".repeat(3)))(hex("3fa40e8a984d4815"))), "4e6f772069732074");
  // RFC 2268 section 5
  for (const [k, bits, p, c] of [["0000000000000000", 63, "0000000000000000", "ebb773f993278eff"],
    ["ffffffffffffffff", 64, "ffffffffffffffff", "278b27e42e2f0d49"], ["88", 64, "0000000000000000", "61a8a244adacccf0"],
    ["88bca90e90875a7f0f79c384627bafb2", 128, "0000000000000000", "2269552ab0f85ca6"]]) {
    assert.equal(toHex(rc2Decryptor(hex(k), bits)(hex(c))), p, k);
  }
});

test("the serial of the .p12's own certificate: AES (OpenSSL 3), 3DES (-legacy, Keychain) and RC2-40 bags", async () => {
  for (const f of ["test.p12", "test-legacy.p12", "test-rc2.p12"]) {
    const certs = await p12Certificates(fx(f), "hunter2");
    assert.equal(certs.length, 2, f); // the certificate and its CA
    assert.equal(await p12Serial(fx(f), "hunter2"), SERIAL, f);
  }
  assert.deepEqual(await p12Leaf(fx("test.p12"), "hunter2"), { serial: SERIAL, team: "TESTTEAM42" });
  assert.match(await p12Serial(fx("test-nopass.p12"), ""), /^[0-9A-F]+$/);
});

test("a wrong password or a file that isn't a .p12: null, never a guess", async () => {
  for (const f of ["test.p12", "test-legacy.p12", "test-rc2.p12"]) assert.equal(await p12Serial(fx(f), "hunter3"), null, f);
  assert.equal(await p12Serial(Uint8Array.of(0x30, 1), "x"), null);
  assert.equal(await p12Serial(new Uint8Array(0), ""), null);
  assert.equal(await p12Serial(CERT, ""), null);
});

test("a .p12 made here (plain certificate bag) reads back", async () => {
  const p12 = await makeP12({ pkcs8: fx("test-key.pk8"), cert: CERT, password: "pw", chain: [CA] }, globalThis.crypto.subtle);
  assert.equal(await p12Serial(p12, "pw"), SERIAL);
});

test("the leaf: paired with the key, else the one with a localKeyId, else the one that issued no other", () => {
  assert.equal(p12LeafCert([{ cert: CA, keyId: null, paired: false }, { cert: CERT, keyId: Uint8Array.of(1), paired: true }]), CERT);
  assert.equal(p12LeafCert([{ cert: CA, keyId: null }, { cert: CERT, keyId: Uint8Array.of(1) }]), CERT);
  assert.equal(p12LeafCert([{ cert: CA, keyId: null }, { cert: CERT, keyId: null }]), CERT);
  assert.equal(p12LeafCert([]), null);
  assert.equal(p12LeafCert(null), null);
});
