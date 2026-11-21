// F344a: the Sources tab in the sideload app judges its Tweak Sources against the Tweak Index and keeps the keys of
// those with nothing for the user's apps, so the next launch draws without them. Its own file: module state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakeNative, memStorage } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage();
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.ifizboxNative = fakeNative({ "sources.list": [] }, { mode: "sideload" });
const sources = await import("./sources.js");

const done = (tweaks) => ({ enabled: true, known: true, refreshed: 1, pending: 0, tweaks });
const ytTweak = { package: "a", ok: true, bundles: ["com.google.ios.youtube"] };

test("off under node unless a test switches it on: no fetch from the gate", () => {
  assert.equal(sources.tweakJudge.enabled, false);
  assert.equal(sources.judgeTweakSources([{ key: "x" }]), null);
});

test("judging: nothing usable hides, unknown keeps what was known, kept on the device, not asked again for ten minutes", async () => {
  let answers = {
    "deb:https://bigboss/:./": done([{ package: "s", ok: true, bundles: ["com.apple.springboard"], systemOnly: true }]),
    "deb:https://havoc/:./": done([ytTweak]),
    "deb:https://slow/:./": null,
  };
  let asks = 0;
  Object.assign(sources.tweakJudge, {
    enabled: true, apps: async () => ["com.google.ios.youtube"], ask: async (s) => { asks++; return answers[s.key]; },
  });
  const list = Object.keys(answers).map((key) => ({ key }));
  const hidden = await sources.judgeTweakSources(list, { now: 1000 });
  assert.deepEqual([...hidden], ["deb:https://bigboss/:./"]);
  assert.deepEqual(JSON.parse(localStorage.getItem(sources.TWEAK_HIDDEN_KEY)), ["deb:https://bigboss/:./"]);
  assert.equal(asks, 3);
  assert.equal(sources.judgeTweakSources(list, { now: 2000 }), null, "judged lately");
  // ten minutes on, the index can't be reached: BigBoss stays out; Havoc's tweak stops counting: it goes too
  answers = { ...answers, "deb:https://bigboss/:./": null, "deb:https://havoc/:./": done([]) };
  const later = await sources.judgeTweakSources(list, { now: 1000 + sources.tweakJudge.every });
  assert.deepEqual([...later].sort(), ["deb:https://bigboss/:./", "deb:https://havoc/:./"]);
  // a source with something for the user's apps again comes back
  answers = { ...answers, "deb:https://bigboss/:./": done([{ package: "u", ok: true, anyApp: true }]) };
  const back = await sources.judgeTweakSources([...list, { key: "deb:https://new/:./" }], { now: 1001 + sources.tweakJudge.every });
  assert.deepEqual([...back], ["deb:https://havoc/:./"]);
});
