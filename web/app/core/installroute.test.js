// Settings > Installation's route rules (core/installroute.js) and how an install picks its route (signing-client.js
// chooseRoute): This iPhone only with a pairing and LocalDevVPN on; otherwise the Signing Server, said in an alert.
import test from "node:test";
import assert from "node:assert/strict";
import { decideRoute, routeParams, storedRoute, pairState, pairEvent, pairFooter, pairFromNative, pinText, verifyFailure, ROUTE_OPTIONS, ALERTS, VPNS, vpnList, STORAGE_KEY, IPHONE_INTRO, setupState, vpnOn, CONNECT_ALERT, PAIR_GUIDE } from "./installroute.js";
import { existsSync } from "node:fs";
import { SETTINGS } from "./settings.js";

const mem = (v) => ({ getItem: (k) => (k === STORAGE_KEY ? v : null) });

test("the server unless This iPhone is chosen", () => {
  assert.deepEqual(decideRoute("server", { paired: "rp", localDevVPN: true }), { route: "server" });
  assert.equal(storedRoute(mem(null)), "server");
  assert.equal(storedRoute(mem("iphone")), "iphone");
  assert.equal(storedRoute({ getItem() { throw new Error("private"); } }), "server");
});

test("This iPhone: paired and LocalDevVPN on, else the server with an alert", () => {
  assert.deepEqual(decideRoute("iphone", { paired: "rp", localDevVPN: true, otherVPN: false }), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", { paired: null, localDevVPN: true }), { route: "server", alert: "notPaired" });
  assert.deepEqual(decideRoute("iphone", { paired: "lockdown", localDevVPN: false, otherVPN: true }), { route: "server", alert: "otherVPN" });
  assert.deepEqual(decideRoute("iphone", { paired: "rp", localDevVPN: false, otherVPN: false }), { route: "server", alert: "vpnOff" });
  assert.deepEqual(decideRoute("iphone", null), { route: "server", alert: "noStatus" });
  assert.deepEqual(routeParams({ route: "idevice" }), { route: "idevice" });
  assert.deepEqual(routeParams({ route: "server", alert: "vpnOff" }), {});
});

test("Another VPN Is On offers the server first and Open LocalDevVPN", () => {
  const a = ALERTS.otherVPN;
  assert.equal(a.title, "Another VPN Is On");
  assert.equal(a.buttons[0], "Use Server");
  assert.equal(a.buttons[a.open], "Open LocalDevVPN");
  assert.match(ALERTS.vpnOff.message, /Signing Server/);
});

test("the This iPhone option names the VPN apps from one list, ready for another", () => {
  assert.deepEqual(VPNS, ["LocalDevVPN"]);
  const o = ROUTE_OPTIONS.find((x) => x.value === "iphone");
  assert.equal(o.subtitle.split("\n")[0], "LocalDevVPN");
  assert.equal(vpnList(["LocalDevVPN", "Tailscale"]), "LocalDevVPN or Tailscale");
  assert.equal(ROUTE_OPTIONS[0].label, "Signing Server");
  const d = SETTINGS.find((x) => x.key === "installRoute");
  assert.equal(d.default, "server");
  assert.deepEqual(d.modes, ["sideload"]);
  assert.match(IPHONE_INTRO, /^Installs straight onto this iPhone: no server, and .+ can update itself\.$/);
});

test("This iPhone's page: the VPN first, then pairing by itself; Paired and older iOS as before", () => {
  assert.equal(setupState({ paired: null, pairOnPhone: true, localDevVPN: false }), "connect");
  assert.equal(setupState({ paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: true }), "connect");
  assert.equal(setupState(null), "file");
  assert.equal(setupState({ paired: null, pairOnPhone: true, localDevVPN: true }), "pairing");
  assert.equal(setupState(null, { pin: "1" }), "pairing"); // pairing under way draws without idevice.status
  assert.equal(setupState({ paired: "rp", localDevVPN: false }), "paired");
  assert.equal(setupState({ paired: null, pairOnPhone: false }), "file");
  assert.equal(vpnOn({ localDevVPN: true }), true);
  assert.equal(CONNECT_ALERT.title, "Turn On LocalDevVPN");
  assert.deepEqual(CONNECT_ALERT.buttons, ["Cancel", "Open LocalDevVPN"]);
  assert.equal(CONNECT_ALERT.buttons[CONNECT_ALERT.open], "Open LocalDevVPN");
});

test("the pairing guide: a short line a step, screenshots for the three Settings rows, all in the app", () => {
  assert.deepEqual(PAIR_GUIDE.map((s) => s.text), ["Open Settings", "Privacy & Security", "Developer Mode", "Pair with iFizBox", "Type the code above"]);
  const shots = PAIR_GUIDE.filter((s) => s.img).map((s) => s.img);
  assert.equal(shots.length, 3);
  for (const s of shots) {
    assert.match(s, /^img\/pair\/.+\.jpg$/);
    assert.ok(existsSync(new URL(`../${s}`, import.meta.url)), s);
  }
});

test("pairing: on the phone from iOS 27, a file before; Pair Again unless the VPN is just off", () => {
  assert.equal(pairState({ paired: null, pairOnPhone: true }), "phone");
  assert.equal(pairState({ paired: null, pairOnPhone: false }), "file");
  assert.equal(pairState({ paired: "rp" }), "paired");
  assert.equal(verifyFailure(Object.assign(new Error("no route"), { code: "connect_failed" })).again, false);
  assert.equal(verifyFailure(Object.assign(new Error("rejected"), { code: "bad_pairing" })).again, true);
  assert.equal(verifyFailure(new Error("not_paired: none")).again, true);
});

test("pairing page: the code first, then the native steps and a failed try; the code stays", () => {
  let p = { pin: "" };
  assert.equal(pairFooter(p), "Starting…");
  p = pairEvent(p, [{ pin: "042917" }]);
  assert.equal(p.pin, "042917");
  assert.equal(pinText(p.pin), "042 917");
  p = pairEvent(p, [{ step: "advertised", text: "Waiting for the iPhone to connect (port 5)." }]);
  assert.equal(pairFooter(p), "Waiting for the iPhone to connect (port 5).");
  p = pairEvent(p, [{ step: "failed", failedAt: "pairing", error: "bad proof (3)" }]);
  assert.match(pairFooter(p), /bad proof \(3\).*try again/);
  assert.equal(p.pin, "042917");
  p = pairEvent(p, [{ step: "connected", text: "The iPhone connected. Pairing…" }]);
  assert.equal(pairFooter(p), "The iPhone connected. Pairing…");
  assert.equal(p.pin, "042917");
  assert.equal(pairEvent(p, []), p);
});

test("pairing page: the state read back from native after the background", () => {
  assert.equal(pairFromNative(null), null);
  assert.equal(pairFromNative({ active: false }), null);
  assert.deepEqual(pairFromNative({ active: true, pin: "123456", step: "failed", text: "Listening on port 1.", error: "bad proof" }),
    { pin: "123456", text: "Listening on port 1.", error: "bad proof" });
  assert.equal(pinText("12345"), "12345");
  assert.equal(pinText(undefined), "");
});
