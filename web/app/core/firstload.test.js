// F43: sources seeded by default (F28) are bare URLs until read. A first visit to Sources refreshes the ones that
// never loaded, once, and leaves loaded ones (and APT sources) alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLoadFilter, loadNeverLoaded, loadTweakSources } from "./sources.js";

const DEFAULT_SOURCES = await loadTweakSources(); // web/app/tweak-sources.json
import { seedRecord, neverLoaded } from "./altstore.js";

const seeded = seedRecord("https://example.com/apps.json");
const loaded = { ...seedRecord("https://example.org/apps.json"), name: "Org", count: 3, updated: 1 };
const failed = { ...seedRecord("https://example.net/apps.json"), updated: 1, error: "timeout" };
const apt = { ...DEFAULT_SOURCES[0] }; // no `updated` either, but APT

// A backend whose refreshSources records each call and which sources its filter kept.
function fakeBackend(list) {
  const calls = [];
  return {
    calls,
    async refreshSources(onEach, { filter } = {}) {
      const kept = list.filter(filter ?? (() => true));
      calls.push(kept.map((s) => s.key));
      return kept.map((s) => ({ ...s, updated: 2 }));
    },
  };
}

test("neverLoaded: a seed record yes; loaded or failed no", () => {
  assert.equal(neverLoaded(seeded), true);
  assert.equal(neverLoaded(loaded), false);
  assert.equal(neverLoaded(failed), false);
  assert.equal(neverLoaded(null), false);
});

test("firstLoadFilter keeps never-loaded AltStore sources only, and only what the device shows", () => {
  for (const type of ["none", "iphoneos-arm64", "iphoneos-arm"]) {
    const f = firstLoadFilter(type);
    assert.deepEqual([seeded, loaded, failed, apt].filter(f).map((s) => s.key), [seeded.key], type);
  }
});

test("a never-loaded seeded source triggers one refresh, of it alone, with the HUD", async () => {
  const list = [seeded, loaded, failed, apt];
  const b = fakeBackend(list);
  const tried = new Set();
  let huds = 0;
  let hidden = 0;
  const begin = () => { huds++; return () => hidden++; };
  const out = await loadNeverLoaded(b, list, "none", { tried, begin });
  assert.deepEqual(b.calls, [[seeded.key]]);
  assert.equal(out.length, 1);
  assert.deepEqual([huds, hidden], [1, 1]);
  // A second visit in the same session (even if the list still looked unloaded) asks nothing again.
  assert.equal(await loadNeverLoaded(b, list, "none", { tried, begin }), null);
  assert.equal(b.calls.length, 1);
  assert.equal(huds, 1);
});

test("a loaded source doesn't trigger a refresh, nor does an APT one", async () => {
  const list = [loaded, failed, apt];
  const b = fakeBackend(list);
  let huds = 0;
  assert.equal(await loadNeverLoaded(b, list, "iphoneos-arm64", { begin: () => { huds++; return () => {}; } }), null);
  assert.deepEqual(b.calls, []);
  assert.equal(huds, 0);
});

test("the HUD goes away when the refresh throws", async () => {
  const list = [seedRecord("https://x.example/a.json")];
  let hidden = 0;
  const b = { refreshSources: async () => { throw new Error("boom"); } };
  await assert.rejects(loadNeverLoaded(b, list, "none", { begin: () => () => hidden++ }), /boom/);
  assert.equal(hidden, 1);
});
