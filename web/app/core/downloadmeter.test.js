// B262: an IPA download's progress once a second (core/downloadmeter.js, the shell's DownloadMeter words), and the
// run page's row showing MB of MB and MB/s from the shell's numbers (core/apprun.js rowStatus).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloadMeter, downloadLine, rateText } from "./downloadmeter.js";
import { appRows, createAppRun, rowStatus } from "./apprun.js";

const MB = 1048576;

test("the meter ticks once a second with the last interval's rate", () => {
  let t = 0;
  const m = createDownloadMeter({ now: () => t });
  assert.equal(m.add(0, 300 * MB), null, "the first call only starts the clock");
  t = 500; assert.equal(m.add(10 * MB, 300 * MB), null, "nothing before a second");
  t = 1000; assert.deepEqual(m.add(30 * MB, 300 * MB), { bytes: 30 * MB, total: 300 * MB, rate: 30 * MB });
  t = 3000; assert.equal(m.add(40 * MB, 300 * MB).rate, 5 * MB);
  t = 5000; assert.equal(m.add(MB, 300 * MB), null, "started again: the count starts again");
});

test("the Log's line, with and without a total", () => {
  assert.equal(downloadLine({ bytes: 120.3 * MB, total: 312 * MB, rate: 21.4 * MB }), "Downloaded 120.3 of 312.0 MB (38%), 21.4 MB/s");
  assert.equal(downloadLine({ bytes: 5 * MB, total: 0, rate: 2.5 * MB }), "Downloaded 5.0 MB, 2.5 MB/s");
  assert.equal(rateText(-1), "0.0 MB/s");
});

test("the row says MB of MB and MB/s from the shell's numbers", async () => {
  const rows = appRows([{ id: "a", name: "Big", url: "https://x/a.ipa" }]);
  let report = null, release = null;
  const run = createAppRun({
    rows,
    sign: (r, { progress }) => { report = progress; return new Promise((res) => { release = res; }); },
    install: async () => ({ installed: true }),
    later: () => 0, clear: () => {},
  });
  const end = run.start();
  await new Promise((r) => setTimeout(r, 0));
  report("downloading", 0, "downloading");
  assert.equal(rowStatus(rows[0]), "Downloading");
  report("downloading", 0.1, "downloading", { bytes: 30 * MB, total: 300 * MB, rate: 21.4 * MB });
  assert.equal(rowStatus(rows[0]), "Downloading 30.0 of 300.0 MB, 21.4 MB/s");
  report("downloading", 0.11, "downloading"); // a percent between ticks keeps the last rate
  assert.equal(rowStatus(rows[0]), "Downloading 33.0 of 300.0 MB, 21.4 MB/s");
  release({ token: "t", bundleId: "a" });
  await end;
});

test("no total: the bytes and the rate", () => {
  const [row] = appRows([{ id: "a", name: "Big" }]);
  Object.assign(row, { state: "downloading", fraction: 0, bytes: 5 * MB, total: 0, rate: 2.5 * MB });
  assert.equal(rowStatus(row), "Downloading 5.0 MB, 2.5 MB/s");
  Object.assign(row, { bytes: 0, rate: 0, size: 48 * MB, fraction: 0.5 });
  assert.equal(rowStatus(row), "Downloading 24.0 of 48.0 MB", "the queue's listed size, as before");
});
