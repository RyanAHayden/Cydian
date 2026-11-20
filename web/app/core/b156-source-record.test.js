// B156: OpenTennis, installed from Search on the FIZL0 source, had no Installed record (iOS answered "not yet" to
// the one check the run made), so the Installed tab listed it as "Signed by iFizBox. No source lists it." after
// every letter. The shell's signed-app record keeps the IPA's url; the source offering that download names it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unrecordedSigned, sourceRecordFor, memoryAppStore, recordInstall, withSourceNames } from "./installed.js";
import { withSignatures, restoreSourceRecords, appSections } from "../screens/installed.js";
import { followHandoff } from "../screens/apprun.js";

const SRC = "https://fizl0.github.io/apps/source.json";
const OT_URL = "https://github.com/FIZL0/opentennis/releases/download/v1.8.2/opentennis-ios.ipa";
const soon = new Date(Date.now() + 5 * 86400e3).toISOString();
// The catalog's packages (core/altstore.js appStanza): the source's name for the app differs from its IPA's.
const pkgOf = (id, name, urls, key = `alt:${SRC}`) => ({ key, row: { id, name },
  stanza: { kind: "ipa", downloadURL: urls[0], ipa: { bundleIdentifier: id, name, sourceUrl: SRC, sourceName: "FIZL0",
    iconURL: `https://i/${id}.png`, versions: urls.map((u, i) => ({ version: `1.8.${3 - i}`, downloadURL: u })) } } });
const ot = pkgOf("io.github.fizl0.hst", "OpenTennis", ["https://github.com/FIZL0/opentennis/releases/download/v1.8.3/opentennis-ios.ipa", OT_URL]);
// signing.installed: named by the IPA (here "Tennis" to show the source's name wins), with the url it came from.
const signedOT = { bundleId: "io.github.fizl0.hst", originalBundleId: "io.github.fizl0.hst", name: "Tennis", version: "1.8.2",
  url: OT_URL, signed: "2026-11-20T10:00:00Z", expires: soon };
const openmxRec = { id: "io.github.fizl0.openmx", name: "openMX", version: "0.18.0", source: SRC, sourceName: "FIZL0", date: 2 };
const youmodRec = { id: "com.yt.youmod", name: "YouMod", version: "1", source: "https://y/", sourceName: "Y", date: 1 };
const installed = { apps: [
  signedOT,
  { bundleId: "io.github.fizl0.openmx", originalBundleId: "io.github.fizl0.openmx", name: "openMX", version: "0.18.0", url: "https://x/o.ipa", expires: soon },
  { bundleId: "com.burbn.instagram", originalBundleId: "com.burbn.instagram", name: "Instagram", version: "400", url: "https://elsewhere/ig.ipa", expires: soon },
] };

test("unrecordedSigned: the signed apps no record stands for, by bundle ID or original ID", () => {
  assert.deepEqual(unrecordedSigned(installed, [openmxRec]).map((a) => a.bundleId), ["io.github.fizl0.hst", "com.burbn.instagram"]);
  assert.deepEqual(unrecordedSigned({ apps: [{ bundleId: "x.ABCDE", originalBundleId: "x" }] }, [{ id: "x" }]), []);
  assert.deepEqual(unrecordedSigned(null, []), []);
});

test("sourceRecordFor: the source offering the signed IPA's url names the app (its name, not the IPA's)", () => {
  const rec = sourceRecordFor(signedOT, [ot], 5);
  assert.deepEqual({ ...rec }, { id: "io.github.fizl0.hst", name: "OpenTennis", version: "1.8.2", key: `alt:${SRC}`, source: SRC,
    sourceName: "FIZL0", icon: "https://i/io.github.fizl0.hst.png", date: Date.parse("2026-11-20T10:00:00Z") });
  // a re-signed copy under another ID still matches by its url and is recorded under the ID iOS has
  const dup = sourceRecordFor({ ...signedOT, bundleId: "io.github.fizl0.hst.ABCDE" }, [ot]);
  assert.equal(dup.id, "io.github.fizl0.hst.ABCDE");
  // the same bundle ID from another IPA (B150: RyukGram vs Instagram) is no match; nor no url, nor a bad one
  const ig = pkgOf("com.burbn.instagram", "RyukGram", ["https://ryuk/ryukgram.ipa"]);
  assert.equal(sourceRecordFor(installed.apps[2], [ig]), null);
  assert.equal(sourceRecordFor({ ...signedOT, url: undefined }, [ot]), null);
  assert.equal(sourceRecordFor({ ...signedOT, url: "file:///var/x.ipa" }, [ot]), null);
  assert.equal(sourceRecordFor(signedOT, []), null);
  // a url spelled with spaces around it is the same download
  assert.equal(sourceRecordFor({ ...signedOT, url: ` ${OT_URL} ` }, [ot]).sourceName, "FIZL0");
});

test("restoreSourceRecords: OpenTennis gets its record back and the Installed list has it under O with FIZL0", async () => {
  const store = memoryAppStore([openmxRec, youmodRec]);
  const asked = [];
  const pkgsOf = async (id) => { asked.push(id); return id === "io.github.fizl0.hst" ? [ot] : []; };
  const wrote = await restoreSourceRecords(installed, await store.all(), { pkgsOf, record: (rec) => recordInstall(store, rec, rec.date) });
  assert.deepEqual(wrote.map((r) => r.id), ["io.github.fizl0.hst"]);
  assert.deepEqual(asked, ["io.github.fizl0.hst", "com.burbn.instagram"]);
  const records = await store.all();
  const { rows, extra } = withSignatures(records, withSourceNames(installed, records));
  const secs = appSections(rows, { mode: "user" });
  const o = secs.find((s) => s.header === "O");
  assert.ok(o, "an O section");
  const row = o.rows.find((r) => r.id === "io.github.fizl0.hst");
  assert.equal(row.name, "OpenTennis");
  assert.equal(row.sourceName, "FIZL0");
  assert.ok(!extra.some((r) => r.id === "io.github.fizl0.hst"), "not a signed-only row any more");
  assert.deepEqual(extra.map((r) => r.id), ["com.burbn.instagram"]);
  // a store that refuses leaves it signed-only, and nothing throws
  assert.deepEqual(await restoreSourceRecords(installed, [], { pkgsOf, record: async () => { throw new Error("no db"); } }), []);
});

test("followHandoff: a 'not yet' from iOS is asked again until iOS has the app, then no more", async () => {
  const timers = [];
  const later = (f) => { timers.push(f); return timers.length; };
  const confirmed = [];
  const run = { confirm: (id) => confirmed.push(id), away: () => {} };
  const rows = [{ id: "ot", state: "installed", unsure: true, mode: "install", bundleId: "io.github.fizl0.hst" }];
  const answers = [false, false, true];
  const heard = [];
  const h = followHandoff(run, rows, { isInstalled: async () => ({ "io.github.fizl0.hst": answers.shift() }), doc: null,
    answered: (r, v) => { heard.push(v); if (v) r.unsure = false; }, later, clear: () => {} });
  await h.check();
  assert.equal(timers.length, 1);
  await timers.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.length, 1);
  await timers.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(heard, [false, false, true]);
  assert.deepEqual(confirmed, ["ot"]);
  assert.equal(timers.length, 0, "a yes asks no more");
  // bounded, and stop() ends it
  const left = [];
  const h2 = followHandoff(run, [{ ...rows[0], unsure: true }], { isInstalled: async () => ({ "io.github.fizl0.hst": false }),
    doc: null, tries: 2, later: (f) => { left.push(f); return 1; }, clear: () => {} });
  await h2.check();
  await left.shift()();
  await new Promise((r) => setImmediate(r));
  await left.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(left.length, 0, "two tries, then it stops asking");
  const h3 = followHandoff(run, [{ ...rows[0], unsure: true }], { isInstalled: async () => ({ "io.github.fizl0.hst": false }),
    doc: null, later: (f) => { left.push(f); return 1; }, clear: () => left.splice(0) });
  await h3.check();
  h3.stop();
  assert.equal(left.length, 0);
});
