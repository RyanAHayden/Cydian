// B247: RyukGram, installed in the Lite app from its own source, read "Instagram · Version 454.0.0 · AppTesters IPA
// Repo" in Installed: AppTesters' Instagram entry lists the same bundle ID (com.burbn.instagram), and the record kept by
// bundle ID named that entry. Signing from a source now sends the source's app (`credit`), the shell keeps it on its
// signed record, and every list matches on it first, the bundle ID only as a fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceCredit, creditOf, creditedRecords, recreditedRecords, withSourceNames, sourceRecordFor, urlCredit,
  recordWithCredit, memoryAppStore, recordInstall } from "./installed.js";
import { appJob } from "./appqueue.js";
import { prepareParams } from "../signing/queue.js";
import { withSignatures, appSubtitle, recreditRecords } from "../screens/installed.js";
import { signedAppRows, needsResign } from "./signing.js";

const IG = "com.burbn.instagram";
const RYUK_SRC = "https://source.ryuksign.com/";
const AT_SRC = "https://repo.apptesters.org/";
const RYUK_URL = "https://github.com/ryuk/ryukgram/releases/download/454.0.0/RyukGram.ipa";
const AT_URL = "https://cdn.apptesters.org/Instagram_454.0.0.ipa";
// Two sources' catalog packages (core/altstore.js appStanza) under one bundle ID.
const pkgOf = (key, src, sourceName, name, url) => ({ key, row: { id: IG, name },
  stanza: { kind: "ipa", downloadURL: url, ipa: { bundleIdentifier: IG, name, sourceUrl: src, sourceName, iconURL: `https://i/${key}.png`,
    versions: [{ version: "454.0.0", downloadURL: url }] } } });
const ryukPkg = pkgOf(`alt:${RYUK_SRC}`, RYUK_SRC, "RyukSign", "RyukGram", RYUK_URL);
const atPkg = pkgOf(`alt:${AT_SRC}`, AT_SRC, "AppTesters IPA Repo", "Instagram", AT_URL);
const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
const ryukCredit = { name: "RyukGram", source: RYUK_SRC, sourceName: "RyukSign", key: `alt:${RYUK_SRC}` };
// signing.installed: the IPA's Info.plist says "Instagram"; the shell hands back the credit it was signed with.
const signedRyuk = { bundleId: IG, originalBundleId: IG, name: "Instagram", version: "454.0.0", url: RYUK_URL,
  signed: "2026-11-20T09:00:00Z", expires: soon, credit: ryukCredit };
// The record Installed holds by bundle ID: AppTesters' Instagram entry's.
const atRec = { id: IG, name: "Instagram", version: "454.0.0", key: `alt:${AT_SRC}`, source: AT_SRC, sourceName: "AppTesters IPA Repo",
  icon: `https://i/alt:${AT_SRC}.png`, date: 1000 };
const delta = { id: "io.dev.delta", name: "Delta", version: "1.5", source: null, sourceName: "My IPAs", date: 900 };

test("the queue's sign call sends the source's app it is; each source's entry its own", () => {
  const ryuk = prepareParams(appJob(ryukPkg));
  assert.deepEqual(ryuk.credit, ryukCredit);
  assert.equal(ryuk.url, RYUK_URL);
  assert.deepEqual(prepareParams(appJob(atPkg)).credit, { name: "Instagram", source: AT_SRC, sourceName: "AppTesters IPA Repo", key: `alt:${AT_SRC}` });
  // no source (My IPAs, a Re-sign from the phone's record): no credit
  assert.equal(sourceCredit({ name: "Delta", source: null }), null);
  assert.equal(sourceCredit({ name: "", source: RYUK_SRC }), null);
  assert.equal(prepareParams({ id: IG, mode: "resign", url: null }).credit, undefined);
  assert.equal(creditOf({ credit: { source: RYUK_SRC } }), null, "a credit needs a name");
});

test("the credit names it in Signed Apps, Needs Re-sign and Installed, over the record by bundle ID", () => {
  const named = withSourceNames({ apps: [signedRyuk] }, [atRec]);
  assert.equal(named.apps[0].name, "RyukGram");
  assert.equal(signedAppRows(named)[0].label, "RyukGram");
  assert.equal(needsResign(named, { now: new Date(), window: 7 })[0].name, "RyukGram");
  // no credit (signed before the shell kept one): the record by bundle ID names it, as B150 did
  assert.equal(withSourceNames({ apps: [{ ...signedRyuk, credit: undefined }] }, [atRec]).apps[0].name, "Instagram");

  const rows = creditedRecords([atRec, delta], named);
  assert.equal(rows[0].name, "RyukGram");
  assert.equal(rows[0].sourceName, "RyukSign");
  assert.equal(rows[0].source, RYUK_SRC);
  assert.equal(rows[0].key, `alt:${RYUK_SRC}`, "Installed's upgrade check asks RyukGram's source first");
  assert.equal(rows[1], delta, "a record no credit stands for is left as it is");
  assert.match(appSubtitle(rows[0], "en-US"), /^RyukSign · /);
  const { rows: listed } = withSignatures(rows, named);
  assert.equal(listed[0].name, "RyukGram");
  assert.ok(listed[0].sig, "still matched to its signature");
  // written back once; a record that already agrees isn't
  const fixes = recreditedRecords([atRec, delta], named);
  assert.deepEqual(fixes.map((r) => [r.id, r.name, r.sourceName, r.date]), [[IG, "RyukGram", "RyukSign", 1000]]);
  assert.deepEqual(recreditedRecords(rows, named), []);
});

test("an installed-as ID (profile's) matches by the original ID", () => {
  const as = { ...signedRyuk, bundleId: `${IG}.ABCDE` };
  assert.equal(creditedRecords([atRec], { apps: [as] })[0].name, "RyukGram");
  // a RyukGram copy beside AppTesters' Instagram (kept the original ID, no credit): Instagram's record isn't touched
  const real = { ...signedRyuk, url: AT_URL, credit: undefined };
  assert.equal(creditedRecords([atRec], { apps: [as, real] })[0], atRec);
  assert.equal(creditedRecords([{ ...atRec, id: as.bundleId }], { apps: [as, real] })[0].name, "RyukGram");
});

test("an unrecorded app gets its record from the credit, not the first source listing the ID (B156)", () => {
  const rec = sourceRecordFor(signedRyuk, [atPkg, ryukPkg], 5);
  assert.equal(rec.name, "RyukGram");
  assert.equal(rec.sourceName, "RyukSign");
  assert.equal(rec.icon, `https://i/alt:${RYUK_SRC}.png`);
  assert.equal(rec.date, Date.parse(signedRyuk.signed));
  // without a credit, the url still picks the entry offering the IPA
  assert.equal(sourceRecordFor({ ...signedRyuk, credit: undefined }, [atPkg, ryukPkg]).sourceName, "RyukSign");
});

test("an app signed before credits: the entry offering its IPA's url, when the record's own doesn't", () => {
  const old = { ...signedRyuk, credit: undefined };
  assert.deepEqual(urlCredit(old, [atPkg, ryukPkg], atRec), ryukCredit);
  assert.equal(urlCredit(old, [atPkg, ryukPkg], { ...atRec, key: `alt:${RYUK_SRC}` }), null, "its own entry offers it");
  assert.equal(urlCredit({ ...old, url: "https://x/other.ipa" }, [atPkg, ryukPkg], atRec), null, "nobody offers it");
  assert.equal(urlCredit(signedRyuk, [atPkg, ryukPkg], atRec), null, "a credit already says");
  // both entries offering the same IPA: the record's stands
  const atSame = pkgOf(`alt:${AT_SRC}`, AT_SRC, "AppTesters IPA Repo", "Instagram", RYUK_URL);
  assert.equal(urlCredit(old, [atSame, ryukPkg], atRec), null);
  assert.equal(recordWithCredit(atRec, ryukCredit).name, "RyukGram");
  assert.equal(recordWithCredit({ ...atRec, ...ryukCredit }, ryukCredit), null);
});

test("Installed writes the corrected record back, date kept, with the credited entry's icon", async () => {
  const pkgsOf = async (id) => (id === IG ? [atPkg, ryukPkg] : []);
  for (const signed of [{ apps: [signedRyuk] }, { apps: [{ ...signedRyuk, credit: undefined }] }]) {
    const store = memoryAppStore();
    await recordInstall(store, atRec, atRec.date);
    const wrote = await recreditRecords(signed, await store.all(), { pkgsOf, record: (r) => recordInstall(store, r, r.date) });
    assert.equal(wrote.length, 1);
    const [rec] = await store.all();
    assert.deepEqual([rec.name, rec.sourceName, rec.source, rec.key, rec.icon, rec.date],
      ["RyukGram", "RyukSign", RYUK_SRC, `alt:${RYUK_SRC}`, `https://i/alt:${RYUK_SRC}.png`, 1000]);
    assert.deepEqual(await recreditRecords(signed, await store.all(), { pkgsOf, record: (r) => recordInstall(store, r, r.date) }), [],
      "nothing more to write");
  }
});
