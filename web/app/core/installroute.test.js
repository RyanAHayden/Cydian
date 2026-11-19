// Settings > Installation's route rules (core/installroute.js) and how an install picks its route (signing-client.js
// chooseRoute): This iPhone only with a pairing and LocalDevVPN on; otherwise the Signing Server, said in an alert.
import test from "node:test";
import assert from "node:assert/strict";
import { decideRoute, routeParams, storedRoute, pairState, pairEvent, pairFooter, verifyFailure, ROUTE_OPTIONS, ALERTS, VPNS, vpnList, STORAGE_KEY, BENEFITS } from "./installroute.js";
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
  assert.match(o.subtitle, /^With LocalDevVPN\. No server, updates .+ itself\.$/);
  assert.equal(vpnList(["LocalDevVPN", "Tailscale"]), "LocalDevVPN or Tailscale");
  assert.equal(ROUTE_OPTIONS[0].label, "Signing Server");
  const d = SETTINGS.find((x) => x.key === "installRoute");
  assert.equal(d.default, "server");
  assert.deepEqual(d.modes, ["sideload"]);
  assert.equal(BENEFITS.length, 4);
});

test("pairing: on the phone from iOS 27, a file before; Pair Again unless the VPN is just off", () => {
  assert.equal(pairState({ paired: null, pairOnPhone: true }), "phone");
  assert.equal(pairState({ paired: null, pairOnPhone: false }), "file");
  assert.equal(pairState({ paired: "rp" }), "paired");
  assert.equal(verifyFailure(Object.assign(new Error("no route"), { code: "connect_failed" })).again, false);
  assert.equal(verifyFailure(Object.assign(new Error("rejected"), { code: "bad_pairing" })).again, true);
  assert.equal(verifyFailure(new Error("not_paired: none")).again, true);
});

test("pairing page: the native steps, a failed try and the code", () => {
  let p = { pin: "" };
  assert.match(pairFooter(p), /Pair button/);
  p = pairEvent(p, [{ step: "advertised", text: "Waiting for the iPhone to connect (port 5)." }]);
  assert.equal(pairFooter(p), "Waiting for the iPhone to connect (port 5).");
  p = pairEvent(p, [{ step: "failed", failedAt: "pairing", error: "bad proof (3)" }]);
  assert.match(pairFooter(p), /bad proof \(3\).*try again/);
  p = pairEvent(p, [{ step: "connected", text: "The iPhone connected. Pairing…" }]);
  assert.equal(pairFooter(p), "The iPhone connected. Pairing…");
  p = pairEvent(p, [{ pin: "123456" }]);
  assert.equal(p.pin, "123456");
  assert.match(pairFooter(p), /Enter this code/);
  assert.equal(pairEvent(p, []), p);
});
