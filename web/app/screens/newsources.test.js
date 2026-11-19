// B75: a source just added (Manage > Recommended > Add All) and never loaded: opening Search loads it under the
// Sources tab's reload bar (screens/sources.js loadNew, one shared run) and runs the query again once its packages
// reach the catalog, so its rows show without a visit to Sources. A fake backend, catalog and ctx; no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadNew, onLanded } from "./sources.js";
import { followNewSources } from "./search.js";

// The rows a run paints (none here) are looked up after the modules load, which build nothing without a DOM.
globalThis.document ??= { querySelectorAll: () => [], querySelector: () => null };
globalThis.CSS ??= { escape: (s) => String(s) };

const KEY = "alt:https://youmod.test/source.json";

function world() {
  const list = [{ key: KEY, uri: "https://youmod.test/source.json" }]; // added: its URL only (a seed row)
  const asked = [];
  const backend = {
    sources: async () => list.map((s) => ({ ...s })),
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
  const catalogRows = [];
  const bars = [];
  const ctx = {
    setBadge() {},
    reloadBar(text, { onCancel } = {}) {
      const bar = { text, onCancel, hidden: false, set(t) { this.text = t; }, hide() { this.hidden = true; } };
      bars.push(bar);
      return bar;
    },
    // catalog.ensure: reads the sources whose refresh time changed
    async loadData() {
      for (const s of list) {
        if (s.updated && !catalogRows.some((r) => r.key === s.key)) catalogRows.push({ id: "com.youmod.app", name: "YouMod", key: s.key });
      }
    },
  };
  const search = (q) => catalogRows.filter((r) => r.name.toLowerCase().includes(q));
  return { list, asked, backend, ctx, bars, search };
}

test("B75: Search loads a just-added source under the reload bar and runs the query again when it lands", async () => {
  const w = world();
  const runs = [];
  let job = null;
  let landedOnce;
  const landed = new Promise((r) => { landedOnce = r; });
  const rerun = () => { runs.push(w.search("youmod")); landedOnce(); };
  runs.push(w.search("youmod")); // the query as typed: nothing yet
  const follow = followNewSources(w.ctx, rerun, () => true, {
    load: (ctx) => (job = loadNew(ctx, { backend: w.backend })),
  });
  assert.ok(job, "opening Search starts the load");
  assert.deepEqual(await job.then((r) => r?.map((x) => x.key)), [KEY]);
  await Promise.race([landed, new Promise((_, no) => setTimeout(() => no(new Error("the query never ran again")), 10000))]); // a hang guard only
  assert.deepEqual(w.asked, [[KEY]], "refreshSources was asked for the added source");
  assert.deepEqual(runs[0], [], "before it landed: no rows");
  assert.deepEqual(runs.at(-1).map((r) => r.id), ["com.youmod.app"], "the query ran again and found its rows");
  assert.equal(w.bars.length, 1, "one run under the reload bar, as Refresh");
  assert.equal(typeof w.bars[0].onCancel, "function", "with Refresh's Cancel");
  assert.equal(w.bars[0].hidden, true, "the bar goes once it has landed");

  // Typing again: the source was tried this session, so nothing is downloaded twice and no bar drops.
  assert.equal(await follow.load(), null);
  assert.deepEqual(w.asked, [[KEY]]);
  assert.equal(w.bars.length, 1);
  follow.off();
});

test("B75: a page left behind stops listening; listeners can unsubscribe", () => {
  let fire = null;
  const landed = (f) => { fire = f; return () => { fire = null; }; };
  let n = 0;
  let alive = true;
  followNewSources({}, () => n++, () => alive, { load: () => null, landed });
  fire();
  assert.equal(n, 1);
  alive = false;
  fire();
  assert.equal(n, 1, "not run for a page no longer on screen");
  assert.equal(fire, null, "and unsubscribed");
  const off = onLanded(() => {});
  assert.equal(off(), true);
});
