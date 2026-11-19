// B94: Settings > Signing after a pick: no "password is wrong" before one was given, no Read From a .txt File once the
// password is right or not needed, and no files (or Password) group once the certificate is good.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passwordState, wantsPasswordFile, signingLayout, siteBecameReady } from "./settings.js";
import { parseProfile, summary } from "../core/signing.js";

const profile = parseProfile(new Uint8Array(readFileSync(new URL("../core/fixtures/signing/test.mobileprovision", import.meta.url))));
const p12 = new Uint8Array([0x30]);
const at = { now: new Date("2026-11-18T00:00:00Z"), locale: "en-US", timeZone: "UTC" };
const WRONG = "The certificate's password is wrong.";

test("a .p12 checked with no password isn't called wrong", () => {
  assert.deepEqual(summary({ profile, passwordOk: false, password: null, ...at }).problems, []);
  assert.deepEqual(summary({ profile, passwordOk: false, password: "", ...at }).problems, []);
  assert.deepEqual(summary({ profile, passwordOk: false, password: "nope", ...at }).problems, [WRONG]);
  assert.deepEqual(summary({ profile, passwordOk: true, password: "hunter2", ...at }).problems, []);
  // the Password group says what to do instead
  assert.equal(passwordState({ p12, p12Name: "me.p12", password: null, passwordOk: false }).state, "waiting");
});

test("Read From a .txt File: shown while a password is wanted, hidden once right or not needed", () => {
  const st = (id) => passwordState({ p12, p12Name: "me.p12", ...id }).state;
  assert.equal(wantsPasswordFile(st({ password: null, passwordOk: false })), true); // waiting
  assert.equal(wantsPasswordFile(st({ password: "nope", passwordOk: false })), true); // wrong: back again
  assert.equal(wantsPasswordFile(st({ password: "typed", passwordOk: null })), true); // unchecked
  assert.equal(wantsPasswordFile(st({ password: "hunter2", passwordOk: true })), false); // right
  assert.equal(wantsPasswordFile(st({ password: "", passwordOk: true })), false); // not needed
});

test("no files group once the certificate is good", () => {
  // the website: ready drops the files group even if the caller still counts the picks as staged
  assert.ok(!signingLayout({ mode: "site", certificate: true, staged: true, profile: true, ready: true }).includes("files"));
  assert.ok(signingLayout({ mode: "site", staged: true }).includes("files"));
  // the sideload build: kept in the Keychain with no picks left
  assert.ok(!signingLayout({ mode: "sideload", certificate: true, profile: true, options: true }).includes("files"));
  assert.ok(signingLayout({ mode: "sideload", certificate: true, staged: true, profile: true }).includes("files")); // replacing it
});

test("the website redraws when the typed password makes the certificate ready, not per keystroke", () => {
  const base = { p12, profile: new Uint8Array([1]) };
  const locked = { ...base, password: null, passwordOk: false };
  assert.equal(siteBecameReady(locked, { ...base, password: "hun", passwordOk: false }), false);
  assert.equal(siteBecameReady(locked, { ...base, password: "hunter2", passwordOk: true }), true);
  const right = { ...base, password: "hunter2", passwordOk: true };
  assert.equal(siteBecameReady(right, right), false);
  // a .p12 that can't be checked here: only a finished entry
  assert.equal(siteBecameReady(locked, { ...base, password: "x", passwordOk: null }), false);
  assert.equal(siteBecameReady(locked, { ...base, password: "x", passwordOk: null }, true), true);
  // no profile yet: nothing to redraw for
  assert.equal(siteBecameReady({ p12, password: null, passwordOk: false }, { p12, password: "hunter2", passwordOk: true }), false);
});
