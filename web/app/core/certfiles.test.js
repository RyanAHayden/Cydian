import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { sortCertFiles, passwordCandidates, findPassword, unzipEntries } from "./certfiles.js";

const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${name}`, import.meta.url)));
const text = (s) => new TextEncoder().encode(s);

// A minimal zip (one deflated entry per file), as a phone or a Mac makes them.
function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const { name, bytes } of files) {
    const n = text(name), data = deflateRawSync(bytes);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}

test("one pick sorts the .p12, the profile and the password file, and finds the password", async () => {
  const s = await sortCertFiles([
    { name: "cert.p12", bytes: fx("test.p12") },
    { name: "app.mobileprovision", bytes: fx("test.mobileprovision") },
    { name: "password.txt", bytes: text("hunter2\n") },
  ]);
  assert.equal(s.p12.name, "cert.p12");
  assert.equal(s.profile.name, "app.mobileprovision");
  assert.equal(await findPassword(s.p12.bytes, s.passwords), "hunter2");
});

test("a .zip of the three works the same, skipping macOS's resource forks", async () => {
  const z = zip([
    { name: "Certs/dist.p12", bytes: fx("test.p12") },
    { name: "Certs/dist.mobileprovision", bytes: fx("test.mobileprovision") },
    { name: "__MACOSX/Certs/._dist.p12", bytes: text("junk") },
    { name: "Certs/info.txt", bytes: text("Certificate for 2026\nPassword: hunter2\n") },
  ]);
  assert.equal((await unzipEntries(z)).length, 4);
  const s = await sortCertFiles([{ name: "certs.zip", bytes: z }]);
  assert.equal(s.p12.name, "Certs/dist.p12");
  assert.ok(s.profile);
  assert.equal(await findPassword(s.p12.bytes, s.passwords), "hunter2");
});

test("password guesses: a labelled line first, then bare words; none that opens it -> null", async () => {
  assert.equal(passwordCandidates("pass = abc\nsome note here\nxyz")[0], "abc");
  assert.ok(!passwordCandidates("pass = abc\nsome note here\nxyz").includes("some note here"));
  assert.equal(await findPassword(fx("test.p12"), ["nope", "1234"]), null);
});
