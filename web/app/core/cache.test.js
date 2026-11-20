import { test } from "node:test";
import assert from "node:assert/strict";
import { openIndexCache } from "./cache.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";


test("index cache: put, get, keys, delete, clear, survives reopening", async () => {
  const indexedDB = fakeIndexedDB();
  const cache = await openIndexCache({ indexedDB });
  assert.equal(await cache.get("https://r.example/Packages"), undefined);
  const value = [{ package: "a", version: "1", debUrl: "https://r.example/a.deb" }];
  const before = Date.now();
  await cache.put("https://r.example/Packages", value, { etag: '"x1"' });
  const rec = await cache.get("https://r.example/Packages");
  assert.deepEqual(rec.value, value);
  assert.equal(rec.etag, '"x1"');
  assert.equal(rec.lastModified, null);
  assert.ok(rec.savedAt >= before);
  await cache.put("https://b.example/Packages", []);
  assert.deepEqual(await cache.keys(), ["https://b.example/Packages", "https://r.example/Packages"]);
  cache.close();

  const again = await openIndexCache({ indexedDB });
  assert.deepEqual((await again.get("https://r.example/Packages")).value, value);
  await again.delete("https://r.example/Packages");
  assert.deepEqual(await again.keys(), ["https://b.example/Packages"]);
  await again.clear();
  assert.deepEqual(await again.keys(), []);
});

test("index cache: no IndexedDB is a rejection, not a throw", async () => {
  await assert.rejects(openIndexCache({ indexedDB: null }), /not available/);
});
