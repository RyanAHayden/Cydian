// F248: after a pick, the .p12's password (core/certfiles.js resolvePassword): a .p12 with no password is opened by
// the empty one and saved as "", a locked one with nothing that opens it is `locked` (Settings focuses the field).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePassword } from "./certfiles.js";

const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${name}`, import.meta.url)));

test("a .p12 with no password: passwordOk true with password ''", async () => {
  assert.deepEqual(await resolvePassword(fx("test-nopass.p12"), null, []), { password: "", passwordOk: true, locked: false });
  // a wrong saved password and text-file guesses don't get in the way
  assert.deepEqual(await resolvePassword(fx("test-nopass.p12"), "old", ["nope"]), { password: "", passwordOk: true, locked: false });
});

test("a locked .p12: the guess that opens it, or locked when none does", async () => {
  assert.deepEqual(await resolvePassword(fx("test.p12"), null, ["x", "hunter2"]), { password: "hunter2", passwordOk: true, locked: false });
  assert.deepEqual(await resolvePassword(fx("test.p12"), "hunter2", []), { password: "hunter2", passwordOk: true, locked: false });
  assert.deepEqual(await resolvePassword(fx("test.p12"), null, ["nope"]), { password: null, passwordOk: null, locked: true });
  assert.deepEqual(await resolvePassword(fx("test.p12"), "wrong", []), { password: "wrong", passwordOk: false, locked: true });
});

test("a .p12 that can't be checked here keeps a saved password and isn't called locked", async () => {
  const unknown = async () => null;
  assert.deepEqual(await resolvePassword(new Uint8Array([0x30]), "typed", [], unknown), { password: "typed", passwordOk: null, locked: false });
  assert.equal((await resolvePassword(new Uint8Array([0x30]), null, [], unknown)).locked, true);
});
