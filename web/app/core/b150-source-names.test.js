// B150: an app installed from a source keeps the source's name (the variant it was picked as) on every row, though
// its IPA's Info.plist says otherwise (RyukGram's IPA is "Instagram"); an IPA with no source keeps its own name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withSourceNames, signedAppsNamed, memoryAppStore, recordInstall, appRows } from "./installed.js";
import { withSignatures } from "../screens/installed.js";
import { signedAppRows, needsResign } from "./signing.js";
import { finishHere, shownName } from "../signing-client.js";

const SRC = "https://source.ryuksign.com/";
// What Install records (screens/queue.js recordApp: the job's name, from the source's app entry).
const ryuk = { id: "com.burbn.instagram", name: "RyukGram (No Plugins)", version: "400.0", source: SRC, sourceName: "RyukSign" };
const dup = { id: "com.ryuk.ryukgram", name: "RyukGram (Duplicate)", version: "400.0", source: SRC, sourceName: "RyukSign" };
// A My IPAs file import (screens/myipas.js recorder: source null, the IPA's own name).
const delta = { id: "io.dev.delta", name: "Delta", version: "1.5", source: null, sourceName: "My IPAs" };
const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
// signing.installed: the shell names each app by its IPA.
const installed = { apps: [
  { bundleId: "com.burbn.instagram", originalBundleId: "com.burbn.instagram", name: "Instagram", version: "400.0", expires: soon },
  { bundleId: "com.ryuk.ryukgram.ABCDE", originalBundleId: "com.ryuk.ryukgram", name: "Instagram", version: "400.0", expires: soon },
  { bundleId: "io.dev.delta", originalBundleId: "io.dev.delta", name: "Delta Emulator", version: "1.5", expires: soon },
  { bundleId: "com.other.app", name: "Other", version: "1", expires: soon },
] };

test("withSourceNames: a source record names its app; no-source records and unrecorded apps keep the IPA's", () => {
  const out = withSourceNames(installed, [ryuk, dup, delta]);
  assert.deepEqual(out.apps.map((a) => a.name), ["RyukGram (No Plugins)", "RyukGram (Duplicate)", "Delta Emulator", "Other"]);
  assert.equal(installed.apps[0].name, "Instagram", "the input is untouched");
  assert.equal(withSourceNames(installed, []), installed);
  assert.equal(withSourceNames(null, [ryuk]), null);
});

test("the bundle ID alone doesn't name it: real Instagram from a file import stays Instagram", () => {
  const real = { id: "com.burbn.instagram", name: "Instagram", version: "401.0", source: null, sourceName: "My IPAs" };
  assert.equal(withSourceNames(installed, [real]).apps[0].name, "Instagram");
});

test("signedAppsNamed: the bridge's list renamed by the device's records", async () => {
  const store = memoryAppStore();
  await recordInstall(store, ryuk, 1);
  await recordInstall(store, delta, 2);
  const native = { call: async (m) => { assert.equal(m, "signing.installed"); return installed; } };
  const out = await signedAppsNamed(native, { store: async () => store });
  assert.equal(out.apps[0].name, "RyukGram (No Plugins)");
  assert.equal(out.apps[2].name, "Delta Emulator");
  // no store: the IPA's names, not a failure
  const bare = await signedAppsNamed(native, { store: () => Promise.reject(new Error("no db")) });
  assert.equal(bare.apps[0].name, "Instagram");
});

test("every row shows the source name: Installed, its signed-only rows, Signed Apps, Needs Re-sign", async () => {
  const records = [ryuk, dup, delta];
  const { rows, extra } = withSignatures(appRows(records), withSourceNames(installed, records));
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Delta", "RyukGram (Duplicate)", "RyukGram (No Plugins)"]);
  assert.deepEqual(extra.map((r) => r.name), ["Other"]);
  // a signed-only row (its record gone from Installed's list, say) still takes a source record's name
  const only = withSignatures([], withSourceNames(installed, records)).extra;
  assert.deepEqual(only.map((r) => r.name), ["RyukGram (No Plugins)", "RyukGram (Duplicate)", "Delta Emulator", "Other"]);
  const signed = signedAppRows(withSourceNames(installed, [ryuk, dup, delta]));
  assert.deepEqual(signed.map((r) => r.label).sort(), ["Delta Emulator", "Other", "RyukGram (Duplicate)", "RyukGram (No Plugins)"]);
  const resign = needsResign(withSourceNames(installed, [ryuk, dup, delta]), { now: new Date(), window: 7 });
  for (const r of resign) assert.notEqual(r.name, "Instagram");
});

test("install progress: 'Installed <source name>', not the IPA's name; an unnamed install falls back to the IPA's", () => {
  const page = () => { const h = { finished: null, set() {}, finish(o) { h.finished = o; } }; return h; };
  const a = page();
  finishHere(a, { name: "Instagram", bundleId: "com.burbn.instagram" }, { name: "RyukGram (iOS 15)" });
  assert.equal(a.finished.status, "Installed RyukGram (iOS 15)");
  assert.equal(a.finished.also.label, "Open RyukGram (iOS 15)");
  const b = page();
  finishHere(b, { name: "Delta", bundleId: "io.dev.delta" }, { name: "" });
  assert.equal(b.finished.status, "Installed Delta");
  assert.equal(shownName("delta.ipa", { name: "Delta" }), "Delta", "a file name gives way to the IPA's own");
  assert.equal(shownName("delta.ipa", {}), "delta.ipa");
  assert.equal(shownName("RyukGram", { name: "Instagram" }), "RyukGram");
});
