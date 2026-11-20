// B133: every step of Settings > Installation & Signing's This iPhone setup that waits on the phone, the network or the
// pairing shows iOS 6's spinner and what it does: the grey spinner in place for waits inside a page, the HUD for a
// one-off action (shown only once the call has taken a moment).
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped() and the pair page's sections.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, leave, hudHooks, busy, installationGroups } = await import("./installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const spins = (box, label) => withClass(cellOf(box, label), "loading-spinner").length === 1;
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = (route = "server") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const later = () => { let answer; const p = new Promise((r) => { answer = r; }); return { p, answer }; };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

// The HUD as a log: [label, "hide"], shown at once (delay 0) unless a test says otherwise.
function hudLog(delay = 0) {
  const log = [];
  hudHooks.show = (label) => { log.push(label); return () => log.push("hide"); };
  hudHooks.delay = delay;
  return log;
}

test("busy: the HUD only once the call has taken the delay, and it goes when the call ends (or fails)", async () => {
  let log = hudLog(30);
  assert.equal(await busy("Quick", async () => 7), 7);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(log, [], "a quick answer shows nothing");
  log = hudLog(0);
  const slow = later();
  const run = busy("Checking Connection", () => slow.p);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log, ["Checking Connection"]);
  slow.answer("ok");
  assert.equal(await run, "ok");
  assert.deepEqual(log, ["Checking Connection", "hide"]);
  log = hudLog(0);
  await assert.rejects(busy("Forgetting Pairing", async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error("x"); }));
  assert.deepEqual(log, ["Forgetting Pairing", "hide"]);
});

test("the main page: Pairing spins Checking… while idevice.status answers; no Developer Mode row (F300)", async () => {
  const st = later();
  const native = bridge({ "idevice.status": () => st.p });
  const box = make("div");
  const done = drawInstallation(box, null, { store: store("iphone"), native });
  assert.ok(spins(box, "Pairing"));
  assert.equal(withClass(cellOf(box, "Pairing"), "cell-detail")[0].textContent, "Checking…");
  assert.match(box.textContent, /LocalDevVPNChecking…/);
  st.answer(PAIRED_ON);
  await done;
  assert.ok(!spins(box, "Pairing"));
  assert.ok(!labels(box).includes("Developer Mode"), labels(box).join(", "));
  assert.deepEqual(native.calls, ["idevice.status", "tailscale.status"], "Developer Mode isn't asked (F301: Tailscale's own read at once beside it)");
  assert.equal(withClass(box, "loading-spinner").length, 0, "nothing spins once everything answered");
});

test("Tailscale signing in: the row spins with its step", () => {
  const gs = installationGroups("iphone", PAIRED_ON, { busy: "Log in on the page" });
  assert.deepEqual(gs[3].rows, [{ label: "Signing In…", detail: "Log in on the page", spin: true }]);
});

test("pairing: the code's place spins until the code comes, then the step line spins while the iPhone connects", async () => {
  hudLog();
  let send, cancel;
  const native = bridge({ "idevice.status": { ...PAIRED_ON, paired: null }, "idevice.vpnApps": { localdevvpn: true, tailscale: false },
    "idevice.pair": (p, ev) => { send = ev; return new Promise((_, no) => { cancel = () => no(Object.assign(new Error("cancelled"), { code: "canceled" })); }); },
    "idevice.pairCancel": () => { cancel(); return Promise.resolve(null); } });
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  await flush();
  const lines = () => withClass(box, "loading").map((n) => n.textContent);
  assert.deepEqual(lines(), ["Getting the Code…", "Starting…"]);
  send([{ pin: "042917" }]);
  await flush();
  assert.deepEqual(lines(), ["Starting…"]);
  assert.match(box.textContent, /042 917/);
  send([{ step: "advertised", text: "Waiting for the iPhone to connect (port 5)." }]);
  await flush();
  assert.deepEqual(lines(), ["Waiting for the iPhone to connect (port 5)."]);
  send([{ step: "failed", error: "bad proof" }]);
  await flush();
  assert.deepEqual(lines(), [], "a failed try waits on a tap on the iPhone, not on the phone");
  leave();
});

test("Check Connection spins in its own row (F301, no HUD); Forget Pairing runs under the HUD, then the page spins Checking… while it reads again", async () => {
  const log = hudLog();
  const verify = later(), forget = later(), again = later();
  let n = 0;
  const native = bridge({ "idevice.status": () => (n++ > 1 ? again.p : Promise.resolve(PAIRED_ON)), "idevice.vpnApps": { localdevvpn: true, tailscale: false },
    "idevice.verify": () => verify.p, "idevice.forget": () => forget.p });
  const alerts = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store("iphone"), native, alert: async (a) => { alerts.push(a.title); return { index: 0 }; } });
  const button = cellOf(box, "Check Connection");
  const checking = tap(box, "Check Connection");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log, [], "no HUD");
  assert.equal(withClass(button, "loading-spinner").length, 1, "its row spins");
  assert.deepEqual(alerts, []);
  verify.answer({});
  await checking;
  assert.equal(withClass(button, "loading-spinner").length, 0);
  assert.deepEqual(alerts, [], "B135: a success shows on the button, not in an alert");

  const forgetting = tap(box, "Forget Pairing");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log, ["Forgetting Pairing"]);
  forget.answer({});
  await forgetting;
  await flush();
  assert.deepEqual(log, ["Forgetting Pairing", "hide"]);
  assert.deepEqual(withClass(box, "loading").map((x) => x.textContent), ["Checking…"], "the old page doesn't stay up while it reads");
  again.answer({ ...PAIRED_ON, paired: null, localDevVPN: false });
  await flush();
  await flush();
  assert.ok(!box.textContent.includes("Checking…"));
  leave();
});

test("B167: switching Connect With to Automatic while signed in: Tailscale's row spins Checking… until the status comes, never Sign In", async () => {
  hudLog(1000);
  const SIGNED_IN = { ...PAIRED_ON, tailscale: { connect: "tailscale", signedIn: true, name: "ifizbox-on-iphone", address: "100.1.2.3" } };
  const again = later();
  let n = 0;
  const native = bridge({ "idevice.status": () => (n++ ? again.p : Promise.resolve(SIGNED_IN)), "idevice.developerMode": { on: true }, "tailscale.setConnect": null,
    "tailscale.status": () => again.p.then((s) => s.tailscale) });
  const box = make("div");
  await drawInstallation(box, null, { store: store("iphone"), native, alert: async () => ({ index: 0 }) });
  await flush();
  assert.ok(labels(box).includes("Sign Out"));
  tap(box, "Automatic");
  await flush();
  await flush();
  assert.ok(!labels(box).includes("Sign In"), `no Sign In flash: ${labels(box)}`);
  // F301: the last answer stays (signed in) with the spinner on its Device row while it's read again; the pick holds
  assert.ok(spins(box, "Device"), "Tailscale's Device row spins while it's read again");
  assert.ok(labels(box).includes("Sign Out"));
  assert.ok(spins(box, "Automatic"), "the pick is checked and spins");
  assert.ok(withClass(cellOf(box, "Automatic"), "cell-check").length === 1);
  again.answer({ ...SIGNED_IN, tailscale: { ...SIGNED_IN.tailscale, connect: "auto" } });
  await flush();
  await flush();
  assert.ok(labels(box).includes("Sign Out"), "its real state comes back");
  assert.ok(!labels(box).includes("Sign In"));
});
