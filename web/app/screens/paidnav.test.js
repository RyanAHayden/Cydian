// B11: a cydia::commercial package on a source with a payment_endpoint never goes to apt (Havoc answers apt with 418;
// paid debs come only through paid.install). The nav bar button shows the price until the vendor says purchased,
// and its sheet offers the Purchase group's step (extras.js paidNav, browse.js paidActions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paidNav, paidStateOf } from "./extras.js";
import { paidActions } from "./browse.js";

const fn = (name) => Object.assign(() => name, { tag: name });
const signIn = fn("signIn"), buy = fn("buy"), install = fn("install");
const cbs = { vendorName: "Havoc", signIn, buy, install };
const labels = (r) => r.actions.map((a) => a.label);

test("signed out, priced: the price on the button, Sign In in the sheet, nothing to install", () => {
  const n = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  assert.equal(n.label, "$3.49");
  assert.equal(n.purchased, false);
  assert.equal(n.install, null);
  assert.deepEqual(labels(n), ["Sign In to Havoc"]);
  assert.equal(n.actions[0].run, signIn);
  // The vendor's banner button names Sign In when it has one.
  assert.deepEqual(labels(paidNav({ price: "$3.49", purchased: false, available: true }, false, { ...cbs, signInLabel: "Log In" })), ["Log In"]);
});

test("signed in, not bought: Buy for the price", () => {
  const n = paidNav({ price: "$3.49", purchased: false, available: true }, true, cbs);
  assert.equal(n.label, "$3.49");
  assert.deepEqual(labels(n), ["Buy for $3.49"]);
  assert.equal(n.actions[0].run, buy);
});

test("bought: Install on the button, Download & Install in the sheet", () => {
  const n = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  assert.equal(n.label, "Install");
  assert.equal(n.purchased, true);
  assert.equal(n.install, install);
  assert.deepEqual(labels(n), ["Download & Install"]);
});

test("purchased: true without a token (Chariz's free packages) still needs Sign In; free packages say Install", () => {
  const n = paidNav({ price: "FREE", purchased: true, available: true }, false, cbs);
  assert.equal(n.label, "Install");
  assert.equal(n.install, null);
  assert.deepEqual(labels(n), ["Sign In to Havoc"]);
});

test("not available, or the vendor couldn't be asked: nothing to queue, and the note says why", () => {
  const n = paidNav({ price: "$1", purchased: false, available: false }, true, cbs);
  assert.deepEqual(n.actions, []);
  assert.match(n.note, /Not available/);
  const e = paidNav(null, false, { note: "offline" });
  assert.deepEqual(e.actions, []);
  assert.equal(e.label, "Install");
  assert.equal(e.note, "offline");
});

test("a box that isn't a vendor's paid package has no paid state", async () => {
  assert.equal(await paidStateOf(null), null);
  assert.equal(await paidStateOf({}), null);
});

const wishOf = (ids = []) => { const s = new Set(ids); return { has: (i) => s.has(i), set: (i, on) => (on ? s.add(i) : s.delete(i)) }; };
const noQueue = () => assert.fail("nothing queued");

test("not installed: the sheet is the Purchase step and Wish List, never a queued Install or Other Versions", () => {
  const paid = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  const r = paidActions(paid, { id: "com.havoc.elysian", version: "1.2", installed: null, queue: noQueue, wish: wishOf() });
  assert.deepEqual(labels(r), ["Sign In to Havoc", "Add to Wish List"]);
  assert.match(r.title, /Sold by Havoc/);
  const bought = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  const b = paidActions(bought, { id: "com.havoc.elysian", version: "1.2", installed: null, queue: noQueue, wish: wishOf() });
  assert.deepEqual(labels(b), ["Download & Install", "Add to Wish List"]);
  assert.equal(b.actions[0].run, install);
});

test("installed and bought: Upgrade or Reinstall through Download & Install, Remove through the queue, no Downgrade", () => {
  const bought = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  const jobs = [];
  const queue = (j) => jobs.push(j);
  const up = paidActions(bought, { id: "p", version: "1.2", installed: "1.1", queue, wish: wishOf() });
  assert.deepEqual(labels(up), ["Upgrade", "Remove"]);
  assert.equal(up.actions[0].run, install);
  const same = paidActions(bought, { id: "p", version: "1.2", installed: "1.2", queue, wish: wishOf(["p"]) });
  assert.deepEqual(labels(same), ["Reinstall", "Remove", "Remove from Wish List"]);
  same.actions[1].run();
  assert.deepEqual(jobs, [{ op: "remove", id: "p" }]);
  // Installed but signed out: only Remove (the vendor won't hand out the deb yet).
  const out = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  assert.deepEqual(labels(paidActions(out, { id: "p", version: "1.2", installed: "1.1", queue, wish: wishOf() })), ["Remove"]);
});
