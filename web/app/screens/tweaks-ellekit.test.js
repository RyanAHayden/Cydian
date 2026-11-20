// The Inject Tweaks group's side of the bundled ElleKit: loadElleKit fetches vendor/ellekit next to the page and
// checks it, preparedItems/preparedFor add it when a tweak needs CydiaSubstrate, and a failed load says what to do.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadElleKit, preparedItems, preparedFor, prepareItems } from "./tweaks.js";
import { ELLEKIT } from "../core/tweaks.js";

const app = new URL("../", import.meta.url);
const deb = () => new Uint8Array(readFileSync(new URL(ELLEKIT.file, app)));
const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const answer = (bytes, ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const tweak = [{ name: "fixture.deb", data: fx("tweak-xz.deb") }];

test("loadElleKit: a failed fetch or a changed file is refused with words, then tried again", async () => {
  const asked = [];
  await assert.rejects(loadElleKit({ fetch: async (u) => { asked.push(u); return answer(new Uint8Array(0), false); } }), /bundled ElleKit couldn't be loaded.*ElleKit's \.deb/);
  assert.equal(asked[0], new URL(ELLEKIT.file, app).href); // next to the page, on the site and in the app
  const bad = deb().slice();
  bad[10] ^= 0xff;
  await assert.rejects(loadElleKit({ fetch: async () => answer(bad) }), /isn't the expected file/);
  await assert.rejects(loadElleKit({ fetch: async () => { throw new TypeError("offline"); } }), /couldn't be loaded/);
  // after a failure the next call fetches again; once loaded it's kept
  let n = 0;
  const good = async () => { n++; return answer(deb()); };
  assert.equal((await loadElleKit({ fetch: good })).length, ELLEKIT.size);
  await loadElleKit({ fetch: good });
  assert.equal(n, 1);
});

test("preparedItems: ElleKit goes in only when a tweak needs CydiaSubstrate", async () => {
  let loads = 0;
  const ellekit = async () => { loads++; return deb(); };
  assert.equal(await preparedItems([], { ellekit }), null);
  const plain = await preparedItems([{ name: "Plain.dylib", data: fx("Plain.dylib") }], { ellekit });
  assert.equal(loads, 0);
  assert.ok(!plain.files.some((f) => /ellekit/.test(f.path)));
  const p = await preparedItems(tweak, { ellekit });
  assert.equal(loads, 1);
  assert.deepEqual(p.bundled, ["ElleKit 1.2"]);
  assert.ok(p.files.some((f) => f.path === "Frameworks/libellekit.dylib"));
  // without the bundled file the old refusal stands
  assert.throws(() => prepareItems(tweak), /needs CydiaSubstrate/);
  await assert.rejects(preparedItems(tweak, { ellekit: async () => { throw new Error("The bundled ElleKit couldn't be loaded."); } }), /couldn't be loaded/);
});

test("preparedFor: the website's Install gets the kept tweaks with ElleKit", async () => {
  const store = async () => ({ get: async (id) => (id === "com.x" ? tweak : undefined) });
  const p = await preparedFor("com.x", { store, ellekit: async () => deb() });
  assert.deepEqual(p.names, ["fixture.deb"]);
  assert.deepEqual(p.missing, []);
  assert.equal(await preparedFor("com.none", { store, ellekit: async () => deb() }), null);
});
