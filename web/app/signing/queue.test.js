// B257: the sign-ahead run's KeepAlive (signing/queue.js heldLanes): signing.hold {on} as each sign or install starts,
// {on: false} once none has run for the idle time or the run's page closes; the lanes' answers pass through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldLanes } from "./queue.js";

function clock() {
  const timers = new Map();
  let n = 0;
  return {
    later: (f) => { timers.set(++n, f); return n; },
    clear: (t) => { timers.delete(t); },
    fire() { const fs = [...timers.values()]; timers.clear(); for (const f of fs) f(); },
    get pending() { return timers.size; },
  };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("heldLanes: held from Confirm; on as each lane starts, off once none runs for the idle time", async () => {
  const c = clock();
  const sent = [];
  let finish = null;
  const lanes = {
    sign: async (r) => `signed ${r}`,
    install: () => new Promise((f) => { finish = f; }),
    local: () => true,
  };
  const h = heldLanes(lanes, { keep: (_n, on) => sent.push(on), later: c.later, clear: c.clear });
  assert.equal(c.pending, 1); // Confirm's hold lets go if nothing starts
  assert.equal(h.local(), true); // other lanes as they are
  assert.equal(await h.sign("a"), "signed a");
  assert.deepEqual(sent, [true]);
  await settle();
  const inst = h.install("a");
  assert.equal(c.pending, 0); // a lane running: no let-go pending
  assert.deepEqual(sent, [true, true]); // each start renews the shell's limit
  c.fire(); // nothing pending to fire
  assert.deepEqual(sent, [true, true]);
  finish({ installed: true });
  assert.deepEqual(await inst, { installed: true });
  await settle();
  assert.equal(c.pending, 1);
  c.fire();
  assert.deepEqual(sent, [true, true, false]);
  h.release(); // already off: nothing more sent
  assert.deepEqual(sent, [true, true, false]);
});

test("heldLanes: a failed lane still counts down; release lets go at once; nothing started lets go after the idle time", async () => {
  const c = clock();
  const sent = [];
  const h = heldLanes({ sign: async () => { throw new Error("no"); } }, { keep: (_n, on) => sent.push(on), later: c.later, clear: c.clear });
  await assert.rejects(h.sign("a"), /no/);
  await settle();
  assert.equal(c.pending, 1);
  h.release();
  assert.deepEqual(sent, [true, false]);
  assert.equal(c.pending, 0);

  const c2 = clock();
  const sent2 = [];
  heldLanes({}, { keep: (_n, on) => sent2.push(on), later: c2.later, clear: c2.clear });
  c2.fire();
  assert.deepEqual(sent2, [false]); // Confirm's {on} let go: no lane ever ran
});

test("B264: heldLanes.during(promise) holds like a lane until it settles (the badge's recount after an app ends)", async () => {
  const c = clock();
  const sent = [];
  const h = heldLanes({}, { keep: (_n, on) => sent.push(on), later: c.later, clear: c.clear });
  let done = null;
  const p = h.during(new Promise((f) => { done = f; }));
  assert.deepEqual(sent, [true]);
  assert.equal(c.pending, 0); // held: no let-go pending while the count runs
  done(3);
  assert.equal(await p, 3);
  await settle();
  c.fire();
  assert.deepEqual(sent, [true, false]);
});
