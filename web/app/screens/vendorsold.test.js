// B19: paid packages a vendor sells (payment_endpoint) never reach apt's queue from Changes' Upgrade (N) or
// Search's Add Source & Install: apt can't fetch them (Havoc answers 418); their pages offer Download & Install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vendorSoldIds, addSourceAndInstall } from "./extras.js";
import { upgradeJobs, upgradeAll } from "./changes.js";
import { createQueue } from "../core/queue.js";

const HAVOC = { key: "deb:https://havoc.app/:./", uri: "https://havoc.app/" };
const FREE = { key: "deb:https://repo.ex.test/:./", uri: "https://repo.ex.test/" };

test("B19: vendorSoldIds picks the paid rows whose source has a vendor", async () => {
  const rows = [
    { id: "paid.vendor", paid: true, key: HAVOC.key },
    { id: "free.vendor", paid: false, key: HAVOC.key },
    { id: "paid.novendor", paid: true, key: FREE.key },
    { id: "paid.gone", paid: true, key: "deb:https://gone.test/:./" },
    null,
  ];
  const asked = [];
  const sells = async (s) => { asked.push(s.key); return s.key === HAVOC.key; };
  assert.deepEqual([...(await vendorSoldIds(rows, [HAVOC, FREE], { sells }))], ["paid.vendor"]);
  assert.deepEqual(asked.sort(), [HAVOC.key, FREE.key].sort(), "only paid rows on a known source are asked about");
  const broken = await vendorSoldIds(rows, [HAVOC], { sells: () => { throw new Error("offline"); } });
  assert.equal(broken.size, 0, "a vendor that can't be asked counts as not selling");
  assert.equal((await vendorSoldIds(undefined, undefined)).size, 0);
});

test("B19: Upgrade (N) leaves out the upgrades a vendor sells", () => {
  const available = [
    { id: "tweak", version: "2", installed: "1", name: "Tweak" },
    { id: "elysian", version: "1.3", installed: "1.2", name: "Elysian", paid: true, key: HAVOC.key },
  ];
  const skip = new Set(["elysian"]);
  assert.deepEqual(upgradeJobs(available, skip).map((j) => j.id), ["tweak"]);
  assert.deepEqual(upgradeJobs(available).map((j) => j.id), ["tweak", "elysian"], "no skip set: as before");
  const q = createQueue();
  const jobs = upgradeAll((job) => q.add(job), available, skip);
  assert.deepEqual(jobs.map((j) => j.id), ["tweak"]);
});

test("B19: Add Source & Install opens a vendor-sold package's page without queuing it", async () => {
  const row = { id: "com.havoc.elysian", name: "Elysian", version: "1.2",
    repo: { uri: HAVOC.uri, name: "Havoc", flat: true, dist: "./" } };
  const stanza = { version: "1.2", tag: "cydia::commercial" };
  function setup(sold) {
    const log = [];
    const deps = {
      backend: {
        addSource: async () => ({ key: HAVOC.key, uri: HAVOC.uri }),
        sources: async () => [HAVOC],
        refreshSources: async () => {},
        queue: (job) => log.push(["queue", job]),
      },
      catalog: { ensure: async () => {}, package: async () => ({ key: HAVOC.key, stanza, row: { name: "Elysian" } }) },
      showHUD: () => () => {}, showAlert: async (a) => log.push(["alert", a.title]),
      go: (href) => log.push(["go", href]),
      sold: async (st, source) => { log.push(["sold", st.tag, source.key, source.uri]); return sold; },
    };
    return { log, deps };
  }
  let { log, deps } = setup(true);
  assert.equal(await addSourceAndInstall(row, deps), "paid");
  assert.deepEqual(log.map((l) => l[0]), ["go", "sold"], "the page opens; nothing queued, no alert");
  assert.deepEqual(log[1].slice(1), ["cydia::commercial", HAVOC.key, HAVOC.uri]);

  ({ log, deps } = setup(false));
  assert.equal(await addSourceAndInstall(row, deps), "queued", "commercial but no vendor: apt fetches it as before");
  assert.equal(log.at(-1)[0], "queue");

  ({ log, deps } = setup(true));
  deps.sold = async () => { throw new Error("offline"); };
  assert.equal(await addSourceAndInstall(row, deps), "queued", "a vendor that can't be asked: queued as before");
});
