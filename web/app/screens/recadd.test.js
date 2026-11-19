// B98: adding a recommended source (Search's Add Source offer, Manage > Recommended's Add) loads it right away:
// manage.js addRecommended tells onSourcesChanged, screens/sources.js's listener starts loadNew under the reload bar,
// and an open Search runs again at once (Recommended Sources drops the source) and once more when its packages
// land (the app is then a normal result). The real wiring, with the shared backend's source calls swapped for a
// fake (getBackend() hands every caller the same object); no network, no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import { addRecommended, onSourcesChanged } from "./manage.js";
import { followNewSources } from "./search.js";
import { getBackend } from "../backend.js";

globalThis.document ??= { querySelectorAll: () => [], querySelector: () => null };
globalThis.CSS ??= { escape: (s) => String(s) };

const URI = "https://youmod.test/source.json";
const KEY = `alt:${URI}`;
const ROW = { key: KEY, input: URI, label: "YouMod", record: { uri: URI } };

function world() {
  const list = []; // the device's sources: empty until the add
  const asked = [];
  const added = [];
  const fake = {
    sources: async () => list.map((s) => ({ ...s })),
    async addSource(input) {
      added.push(input);
      list.push({ key: `alt:${input}`, uri: input }); // added: its URL only, never loaded
      return list.at(-1);
    },
    async refreshSources(onEach, { filter } = {}) {
      const keys = list.filter((s) => filter?.(s)).map((s) => s.key);
      asked.push(keys);
      await new Promise((r) => setTimeout(r, 5)); // the download
      const out = [];
      for (const k of keys) {
        const i = list.findIndex((s) => s.key === k);
        list[i] = { ...list[i], name: "YouMod", updated: Date.now(), count: 1 };
        out.push(list[i]);
        onEach?.(list[i]);
      }
      return out;
    },
  };
  Object.assign(getBackend(), fake);
  const catalogRows = [];
  const bars = [];
  const huds = [];
  const ctx = {
    setBadge() {},
    showHUD(text) { const h = { text, hidden: false }; huds.push(h); return () => { h.hidden = true; }; },
    reloadBar(text, { onCancel } = {}) {
      const bar = { text, onCancel, hidden: false, set(t) { this.text = t; }, hide() { this.hidden = true; } };
      bars.push(bar);
      return bar;
    },
    async loadData() { // catalog.ensure: reads the sources whose refresh time changed
      for (const s of list) {
        if (s.updated && !catalogRows.some((r) => r.key === s.key)) catalogRows.push({ id: "com.youmod.app", name: "YouMod", key: s.key });
      }
    },
  };
  const search = (q) => catalogRows.filter((r) => r.name.toLowerCase().includes(q)).map((r) => r.id);
  return { list, asked, added, ctx, bars, huds, search };
}

const within = (p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what)), 10000).unref?.())]); // a hang guard only

test("B98: Add Source on a recommended app loads the source at once and Search runs again", async () => {
  const w = world();
  // An open Search page: what each run finds, and whether the source is still "recommended" (not in the list).
  const runs = [];
  let landedOnce;
  const landed = new Promise((r) => { landedOnce = r; });
  const rerun = async () => {
    const listed = (await getBackend().sources()).some((s) => s.key === KEY);
    const found = w.search("youmod");
    runs.push({ listed, found });
    if (found.length) landedOnce();
  };
  const follow = followNewSources(w.ctx, rerun, () => true, { load: async () => null }); // opening: nothing new yet
  const told = [];
  const off = onSourcesChanged((ctx) => told.push(ctx));

  assert.equal(await addRecommended(ROW, w.ctx), true);
  assert.deepEqual(w.added, [URI], "the source is added");
  assert.equal(w.huds[0].text, "Verifying URL");
  assert.equal(w.huds[0].hidden, true);
  assert.equal(told[0], w.ctx, "the add passes its ctx on, so the load runs under its reload bar");

  await within(landed, "the source was never loaded, or Search never ran again");
  assert.deepEqual(w.asked, [[KEY]], "the load asked for the added source, without a Refresh");
  assert.equal(runs[0].listed, true, "Search ran at once: the source is listed, so Recommended Sources drops it");
  assert.deepEqual(runs[0].found, [], "its packages weren't in yet");
  assert.deepEqual(runs.at(-1).found, ["com.youmod.app"], "once it landed the app is a normal result");
  assert.equal(w.bars.length, 1, "one run under the reload bar, as Refresh");
  assert.equal(w.bars[0].hidden, true, "the bar goes once it has landed");
  follow.off();
  off();
});

test("B98: a failed add shows the alert and loads nothing", async () => {
  const told = [];
  const off = onSourcesChanged((ctx) => told.push(ctx));
  const alerts = [];
  const backend = { addSource: async () => { throw Object.assign(new Error("not a source"), { title: "Bad Source" }); } };
  const ctx = { showHUD: () => () => {} };
  assert.equal(await addRecommended(ROW, ctx, { backend, alert: async (a) => { alerts.push(a); } }), false);
  assert.equal(alerts[0].title, "Bad Source");
  assert.deepEqual(told, [], "no listener told, so no load starts");
  off();
});

test("B98: Search runs again on an add and on any catalog load, and stops once its page is gone", () => {
  let fire = null;
  let load = null;
  const changed = (f) => { fire = f; return () => { fire = null; }; };
  // the source page Add Source opens loads the new source through catalog.ensure(), not the reload bar
  const loaded = (f) => { load = f; return () => { load = null; }; };
  let n = 0;
  let alive = true;
  followNewSources({}, () => n++, () => alive, { load: () => null, landed: () => () => {}, changed, loaded });
  fire();
  assert.equal(n, 1, "an add runs the open Search again");
  load();
  assert.equal(n, 2, "so does a catalog load from anywhere");
  alive = false;
  fire();
  assert.equal(n, 2);
  assert.equal(fire, null, "and unsubscribed");
  assert.equal(load, null, "from both");
});
