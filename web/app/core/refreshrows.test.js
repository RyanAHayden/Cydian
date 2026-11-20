// F233: the Sources rows while a refresh runs, the strip's words and the tab badge (core/refreshrows.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshRows, tabBadge, coalesce, ROW } from "./refreshrows.js";

test("F233: rows start Waiting, spin when started, land with their count or fail with a reason", () => {
  const rows = refreshRows(["a", "b", "c", "a"]);
  assert.deepEqual(rows.keys(), ["a", "b", "c"]);
  assert.deepEqual(rows.counts(), { total: 3, done: 0, failed: 0, waiting: 3, loading: 0 });
  rows.set("a", ROW.loading);
  rows.set("b", ROW.loading);
  assert.equal(rows.get("a").state, ROW.loading);
  rows.land({ key: "a", count: 1234 });
  assert.deepEqual(rows.get("a"), { state: ROW.done, count: 1234, reason: null });
  rows.land({ key: "b", count: 10, error: "the repo answered HTTP 404" });
  assert.deepEqual(rows.get("b"), { state: ROW.failed, count: 10, reason: "the repo answered HTTP 404" });
  assert.deepEqual(rows.counts(), { total: 3, done: 1, failed: 1, waiting: 1, loading: 0 });
  assert.deepEqual(rows.failedKeys(), ["b"]);
  // landed rows don't go back to spinning
  rows.set("a", ROW.loading);
  assert.equal(rows.get("a").state, ROW.done);
});

test("F233: apt's live Err keeps a row red when its record lands without an error of its own", () => {
  const rows = refreshRows(["dead"]);
  rows.set("dead", ROW.loading);
  rows.fail("dead", "apt-get update couldn't fetch Packages (525)");
  rows.land({ key: "dead", count: 40 }); // apt kept the old lists: a count, but this refresh failed
  assert.deepEqual(rows.get("dead"), { state: ROW.failed, count: 40, reason: "apt-get update couldn't fetch Packages (525)" });
  rows.fail("x"); // a key outside the run gets a row, with a reason
  assert.equal(rows.get("x").reason, "Failed");
});

test("F233: finish() lands rows never heard of; retry() spins one failed row again", () => {
  const rows = refreshRows(["a", "b", "c"]);
  rows.set("b", ROW.loading);
  rows.fail("c", "timed out");
  rows.finish();
  assert.equal(rows.over, true);
  assert.deepEqual(rows.counts(), { total: 3, done: 2, failed: 1, waiting: 0, loading: 0 });
  rows.retry("c");
  assert.equal(rows.over, false);
  assert.deepEqual(rows.get("c"), { state: ROW.loading, count: null, reason: null });
  rows.land({ key: "c", count: 7 });
  rows.finish();
  assert.deepEqual(rows.counts(), { total: 3, done: 3, failed: 0, waiting: 0, loading: 0 });
});

test("F233: the Sources badge spins while running, then counts failures", () => {
  assert.equal(tabBadge({ failed: 2 }, true), "spinner");
  assert.equal(tabBadge({ failed: 2 }, false), 2);
  assert.equal(tabBadge({ failed: 0 }, false), null);
  assert.equal(tabBadge(undefined, false), null);
});

test("F233: coalesce runs the catalog load once at a time, and once more for calls made meanwhile", async () => {
  let runs = 0;
  let release;
  const fn = async () => { runs++; await new Promise((r) => { release = r; }); };
  const feed = coalesce(fn);
  const p1 = feed();
  const p2 = feed();
  const p3 = feed();
  assert.equal(p1, p2);
  assert.equal(runs, 1);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs, 2, "the calls made while it ran: one more run, not two");
  release();
  await Promise.all([p1, p3]);
  assert.equal(runs, 2);
  // a throwing load doesn't stop the next call
  const bad = coalesce(async () => { runs++; throw new Error("x"); });
  await bad();
  await bad();
  assert.equal(runs, 4);
});
