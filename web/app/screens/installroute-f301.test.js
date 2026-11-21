// F301: This iPhone's settings (sideload build) answer quickly and calmly: idevice.status and tailscale.status are read
// at once, each part fills its own rows; every read has a deadline (Not Responding instead of spinning on); the last
// answer shows at once on the next draw, its rows spinning while it's read again; a repaint changes only the rows that
// changed (no full redraw); Test Connection and Check Connection spin in their own rows; Check Connection with no VPN
// on answers at once instead of waiting out idevice.verify.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped().
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, hudHooks, TIMEOUTS, NOT_RESPONDING, forgetStatus, cachedStatus, within, leave } = await import("./installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const detailOf = (box, label) => withClass(cellOf(box, label), "cell-detail")[0]?.textContent;
const spins = (box, label) => withClass(cellOf(box, label), "loading-spinner").length === 1;
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const later = () => { let answer; const p = new Promise((r) => { answer = r; }); return { p, answer }; };
const TS_IN = { connect: "auto", signedIn: true, name: "ifizbox-on-iphone", address: null, use: false };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: TS_IN };

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}
const huds = [];
hudHooks.show = (l) => { huds.push(l); return () => {}; };
hudHooks.delay = 0;

test("both reads go out at once; Tailscale's rows fill from tailscale.status while idevice.status still runs", async () => {
  forgetStatus();
  const dev = later(), ts = later();
  const native = bridge({ "idevice.status": () => dev.p, "tailscale.status": () => ts.p });
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native });
  assert.deepEqual(native.calls, ["idevice.status", "tailscale.status"], "neither waits for the other");
  assert.equal(detailOf(box, "Pairing"), "Checking…");
  assert.ok(spins(box, "Pairing") && spins(box, "LocalDevVPN"), "each row of a part being read has its own spinner");
  ts.answer(TS_IN);
  await flush();
  assert.equal(detailOf(box, "Device"), "ifizbox-on-iphone", "Tailscale's part is in");
  assert.equal(detailOf(box, "Pairing"), "Checking…", "the device part still reads");
  dev.answer(PAIRED_ON);
  await done;
  assert.equal(detailOf(box, "Pairing"), "Paired");
  assert.equal(withClass(box, "loading-spinner").length, 0);
});

test("a read past its deadline says Not Responding in its rows, and nothing spins on", async () => {
  forgetStatus();
  const was = { ...TIMEOUTS };
  TIMEOUTS.status = 20;
  TIMEOUTS.tailscale = 20;
  try {
    const native = bridge({ "idevice.status": () => new Promise(() => {}), "tailscale.status": () => new Promise(() => {}) });
    const box = make("div");
    await drawInstallation(box, "iphone", { store: store(), native });
    assert.equal(detailOf(box, "Pairing"), NOT_RESPONDING);
    assert.equal(detailOf(box, "LocalDevVPN"), NOT_RESPONDING);
    const tsRow = withClass(box, "cell-inner").filter((n) => withClass(n, "cell-label")[0]?.textContent === "Tailscale").at(-1); // not Connect With's
    assert.equal(withClass(tsRow, "cell-detail")[0]?.textContent, NOT_RESPONDING);
    assert.equal(withClass(box, "loading-spinner").length, 0, "no row spins for ever");
    assert.ok(withClass(box, "install-red").length >= 3, "in red, as Another VPN");
  } finally { Object.assign(TIMEOUTS, was); }
  await assert.rejects(within(new Promise(() => {}), 5), (e) => e.code === "not_responding");
  assert.equal(await within(Promise.resolve(7), 50), 7);
});

test("the last answer shows at once on the next draw, its rows spinning while it's read again", async () => {
  forgetStatus();
  await drawInstallation(make("div"), "iphone", { store: store(), native: bridge({ "idevice.status": PAIRED_ON, "tailscale.status": TS_IN }) });
  assert.equal(cachedStatus().paired, "rp");
  const dev = later(), ts = later();
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native: bridge({ "idevice.status": () => dev.p, "tailscale.status": () => ts.p }) });
  assert.equal(detailOf(box, "Pairing"), "Paired", "no Checking… when an answer is known");
  assert.equal(detailOf(box, "LocalDevVPN"), "On");
  assert.ok(spins(box, "Pairing") && spins(box, "LocalDevVPN") && spins(box, "Device"), "but each row spins while it's read again");
  assert.ok(labels(box).includes("Test Connection"));
  dev.answer({ ...PAIRED_ON, localDevVPN: false });
  ts.answer(TS_IN);
  await done;
  assert.equal(detailOf(box, "LocalDevVPN"), "Off", "the fresh answer replaces it");
  assert.equal(withClass(box, "loading-spinner").length, 0);
});

test("an answer patches the rows in place: groups and unchanged rows stay the same elements", async () => {
  forgetStatus();
  const dev = later();
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native: bridge({ "idevice.status": () => dev.p, "tailscale.status": TS_IN }) });
  await flush();
  const groups = [...box.children];
  const openRow = cellOf(box, "Open LocalDevVPN");
  const autoRow = cellOf(box, "Automatic");
  const pairingRow = cellOf(box, "Pairing");
  dev.answer(PAIRED_ON);
  await done;
  assert.deepEqual([...box.children], groups, "no group was rebuilt");
  assert.equal(cellOf(box, "Open LocalDevVPN"), openRow, "a row whose content didn't change is the same element");
  assert.equal(cellOf(box, "Automatic"), autoRow);
  assert.notEqual(cellOf(box, "Pairing"), pairingRow, "the row that changed was swapped");
  assert.equal(detailOf(box, "Pairing"), "Paired");
});

test("a row kept from an earlier draw calls the latest draw's handler", async () => {
  forgetStatus();
  const opened = [];
  const box = make("div");
  const native = bridge({ "idevice.status": PAIRED_ON, "tailscale.status": TS_IN, "idevice.openLocalDevVPN": () => { opened.push(1); return Promise.resolve({ opened: true }); } });
  await drawInstallation(box, "iphone", { store: store(), native });
  const row = cellOf(box, "Open LocalDevVPN");
  await drawInstallation(box, "iphone", { store: store(), native });
  assert.equal(cellOf(box, "Open LocalDevVPN"), row, "kept");
  await tap(box, "Open LocalDevVPN");
  assert.deepEqual(opened, [1]);
});

test("Test Connection spins Testing… in its own row (no HUD); past its deadline the alert says Not Responding", async () => {
  forgetStatus();
  huds.length = 0;
  const was = TIMEOUTS.test;
  TIMEOUTS.test = 20;
  try {
    const alerts = [];
    const box = make("div");
    const native = bridge({ "idevice.status": PAIRED_ON, "tailscale.status": TS_IN, "tailscale.test": () => new Promise(() => {}) });
    await drawInstallation(box, "iphone", { store: store(), native, alert: async (a) => { alerts.push(a); return { index: 0 }; } });
    const run = tap(box, "Test Connection");
    await flush();
    assert.ok(spins(box, "Test Connection"));
    assert.equal(detailOf(box, "Test Connection"), "Testing…");
    tap(box, "Test Connection"); // a second tap while it runs does nothing
    await run;
    assert.deepEqual(huds, []);
    assert.deepEqual(alerts.map((a) => a.title), [NOT_RESPONDING]);
    assert.ok(!spins(box, "Test Connection"));
    assert.equal(native.calls.filter((c) => c === "tailscale.test").length, 1);
  } finally { TIMEOUTS.test = was; }
});

test("Check Connection on the Pairing page: VPN off by the time it's tapped, the answer comes from idevice.status alone", async () => {
  forgetStatus();
  const alerts = [];
  let n = 0;
  const native = bridge({ "idevice.status": () => Promise.resolve(n++ ? { ...PAIRED_ON, localDevVPN: false } : PAIRED_ON), "idevice.vpnApps": { localdevvpn: true },
    "idevice.verify": () => new Promise(() => {}) });
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { alerts.push(a.title); return { index: 0 }; } });
  await tap(box, "Check Connection");
  // B258: signed in to Tailscale with Connect With: Automatic is set up with Tailscale (setUpWithTailscale), so
  // with neither VPN on it names Tailscale, as the status cell does (Tailscale Is Off)
  assert.deepEqual(alerts, ["Turn On Tailscale"]);
  assert.ok(!native.calls.includes("idevice.verify"), "idevice.verify isn't asked");
  leave();
});
