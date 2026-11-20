// B141: Lite's first launch imported the website's sources (Open in App, transfer.link) after the launch refresh had
// run, and Search then found nothing. The import now tells onSourcesChanged: screens/sources.js loads the sources
// never read under the reload bar and puts the ones that came in already read (Add's IPA record) in the catalog.
// Search tries a source whose first fetch failed once more per visit, says "still loading" while a run goes, and
// runs the query again once the source lands. The real wiring with a fake backend (getBackend() hands every caller
// the same object), catalog and ctx; no network, no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import { reviewAndImport } from "./importlink.js";
import { useContext, loadNew, isLoading } from "./sources.js";
import { followNewSources, emptyNote, LOADING_NOTE } from "./search.js";
import { retryFilter } from "../core/sources.js";
import { getBackend } from "../backend.js";
import { encodeLink } from "../core/transfer.js";

globalThis.document ??= { querySelectorAll: () => [], querySelector: () => null };
globalThis.CSS ??= { escape: (s) => String(s) };

const UNBOUND = "https://repo.unbound.test/app-repo.json";
const READY = "https://ready.test/apps.json";
const altKey = (u) => `alt:${u}`;
const guard = (p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what)), 10000).unref())]); // hang guard only

const ctx = { setBadge() {} };
function world({ failFirst = false } = {}) {
  const list = [];
  const asked = [];
  let fails = failFirst ? 1 : 0;
  const fake = {
    sources: async () => list.map((s) => ({ ...s })),
    // As core/altstore.js withAltSources: a URL detected as an IPA source is saved already read (ipaRecord: updated,
    // count); the Unbound-like one here is a seed row, its URL only.
    async addSource(link) {
      // the import hands AltStore sources over as altstore://source?url=… (core/sourcelist.js)
      const input = String(link).startsWith("altstore:") ? new URL(link).searchParams.get("url") : link;
      const rec = input === READY
        ? { key: altKey(input), kind: "altstore", uri: input, name: "Ready", count: 1, updated: Date.now(), error: null }
        : { key: altKey(input), kind: "altstore", uri: input, name: null, count: null, updated: null, error: null };
      list.push(rec);
      return rec;
    },
    async refreshSources(onEach, { filter } = {}) {
      const keys = list.filter((s) => filter?.(s)).map((s) => s.key);
      asked.push(keys);
      await new Promise((r) => setTimeout(r, 5)); // the download
      const out = [];
      for (const k of keys) {
        const i = list.findIndex((s) => s.key === k);
        list[i] = fails > 0
          ? { ...list[i], updated: Date.now(), error: "The network connection was lost." }
          : { ...list[i], name: "Unbound", updated: Date.now(), error: null, count: 1 };
        if (fails > 0) fails--;
        out.push(list[i]);
        onEach?.(list[i]);
      }
      return out;
    },
  };
  Object.assign(getBackend(), fake);
  const catalogRows = [];
  const bars = [];
  // One ctx for the whole file, as the app has one: sources.js keeps the first one it is handed (feedCatalog's
  // coalesced load among them), so each world swaps what it points at.
  Object.assign(ctx, {
    reloadBar(text, { onCancel } = {}) {
      const bar = { text, onCancel, hidden: false, set(t) { this.text = t; }, hide() { this.hidden = true; } };
      bars.push(bar);
      return bar;
    },
    async loadData() { // catalog.ensure: reads the sources read without an error
      for (const s of list) {
        if (s.updated && !s.error && !catalogRows.some((r) => r.key === s.key)) {
          catalogRows.push({ id: s.uri === READY ? "com.ready.app" : "com.unbound.app", name: s.name, key: s.key });
        }
      }
    },
  });
  const search = (q) => catalogRows.filter((r) => String(r.name).toLowerCase().includes(q));
  return { list, asked, ctx, bars, search, catalogRows };
}

const ui = {
  alert: async () => ({ index: 0 }),
  hud: () => { const h = () => {}; h.done = () => {}; return h; },
  banner: () => {},
};
const store = { isShown: () => false, get: () => undefined, set() {}, holds: { list: () => [], set: async () => {} } };
const until = async (cond, what) => {
  const end = Date.now() + 10000;
  while (!cond()) {
    if (Date.now() > end) throw new Error(what);
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("B141: importing the website's sources loads them at once, with no Refresh and no Sources visit", async () => {
  const w = world();
  useContext(w.ctx); // app.js hands the app's ctx at start
  const url = await encodeLink({ sources: [UNBOUND, READY], settings: {}, holds: [] });
  assert.equal(await reviewAndImport(url, { native: null, backend: getBackend(), store, ...ui }), "imported");
  await until(() => w.search("unbound").length && w.search("ready").length, "the imported sources never reached the catalog");
  assert.deepEqual(w.asked, [[altKey(UNBOUND)]], "the never-read source was refreshed; the one already read was not");
  assert.equal(w.bars.length, 1, "under the reload bar");
  await until(() => !isLoading(), "the run never ended");
});

test("B141: Search tries a source whose first fetch failed again, says it is loading, and finds the app once landed", async () => {
  const w = world({ failFirst: true });
  useContext(w.ctx);
  const DEFAULT = "https://repo.unbound.test/default.json"; // not the first test's: sources.js's `tried` is per session
  await getBackend().addSource(DEFAULT); // a default source, seeded
  // First launch: the first load fails (the network still coming up); Sources' first load tries it only once.
  await loadNew(w.ctx);
  assert.equal(w.list[0].error, "The network connection was lost.");
  assert.equal(retryFilter("none")(w.list[0]), true);
  assert.equal(await loadNew(w.ctx), null, "without Search's retry set it is not asked again");

  // Opening Search: the visit's retry loads it again; the typed query says "still loading", then finds Unbound.
  const notes = [];
  const rerun = () => { const rows = w.search("unbound"); notes.push(emptyNote(rows.length, isLoading())); };
  let job = null;
  const follow = followNewSources(w.ctx, rerun, () => true, {
    load: (ctx, opts) => (job = loadNew(ctx, opts)),
    loaded: () => () => {},
  });
  rerun(); // the query as typed
  assert.equal(notes[0], LOADING_NOTE, "typed while the retry runs: not a bare No Results");
  await guard(job, "the retry never ended");
  await until(() => notes.at(-1) === "", "the query never ran again with Unbound");
  assert.deepEqual(w.asked, [[altKey(DEFAULT)], [altKey(DEFAULT)]], "fetched twice: launch, then Search");
  assert.deepEqual(w.search("unbound").map((r) => r.id), ["com.unbound.app"]);

  // Typing again in the same visit: landed now, so nothing is fetched a third time.
  assert.equal(await follow.load(), null);
  assert.equal(w.asked.length, 2);
  follow.off();
});

test("B141: emptyNote and retryFilter", () => {
  assert.equal(emptyNote(3, true), "");
  assert.equal(emptyNote(0, true), LOADING_NOTE);
  assert.equal(emptyNote(0, false), "No Results");
  const f = retryFilter("none");
  const base = { key: altKey(UNBOUND), uri: UNBOUND };
  assert.equal(f({ ...base, updated: 1, count: 4, error: null }), false, "loaded with apps");
  assert.equal(f({ ...base, updated: 1, count: 0, error: null }), true, "no apps");
  assert.equal(f({ ...base, updated: 1, count: null, error: "timeout" }), true, "failed");
  assert.equal(f({ ...base, updated: null, error: null }), true, "never loaded");
  assert.equal(f({ ...base, updated: 1, count: null, error: null, unsupported: "encrypted" }), false, "only its own app reads it");
  assert.equal(f({ key: "deb:https://a/:./", updated: 1, error: "x" }), false, "APT sources are Refresh's");
});
