// Settings > Installation's route rules (core/installroute.js) and how an install picks its route (signing-client.js
// chooseRoute): This iPhone only with a pairing and LocalDevVPN on; otherwise the Signing Server, said in an alert.
import test from "node:test";
import assert from "node:assert/strict";
import { decideRoute, routeParams, tailscaleTestResult, tailscaleFooter, connectFooter, keyDaysLeft, aclRule, CONNECT_OPTIONS, storedRoute, pairState, pairEvent, pairFooter, pairFromNative, pinText, verifyFailure, ROUTE_OPTIONS, ALERTS, VPNS, vpnList, STORAGE_KEY, IPHONE_INTRO, setupState, vpnOn, CONNECT_ALERT, PAIR_GUIDE } from "./installroute.js";
import { existsSync, readFileSync } from "node:fs";
import { ringStyle } from "./installroute.js";
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

test("the This iPhone option names the VPN apps from one list: LocalDevVPN and Tailscale", () => {
  assert.deepEqual(VPNS, ["LocalDevVPN", "Tailscale"]);
  const o = ROUTE_OPTIONS.find((x) => x.value === "iphone");
  assert.equal(o.subtitle.split("\n")[0], "LocalDevVPN or Tailscale");
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
  assert.equal(vpnOn({ localDevVPN: false, tailscale: { use: true } }), true); // Tailscale on and signed in
  assert.equal(setupState({ paired: null, pairOnPhone: true, localDevVPN: false, tailscale: { use: true } }), "pairing");
  assert.equal(CONNECT_ALERT.title, "Turn On LocalDevVPN or Tailscale");
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

// A JPEG's [width, height], from its start-of-frame marker.
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test("the pairing guide: every screenshot has its real size and a row box inside it", () => {
  for (const s of PAIR_GUIDE.filter((g) => g.img)) {
    assert.deepEqual(jpegSize(readFileSync(new URL(`../${s.img}`, import.meta.url))), s.size, s.img);
    const { x, y, w, h } = s.box;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100 && y + h <= 100, `${s.img} box inside`);
    // A Settings row is wide and short: a box that is not is measuring something else.
    const px = { w: (w / 100) * s.size[0], h: (h / 100) * s.size[1] };
    assert.ok(px.h > 120 && px.h < 170 && px.w > 900, `${s.img} box is one row (${px.w}x${px.h} px)`);
    // Room for the ring outside the row (3 CSS px at a 300 px wide image is 12 image px).
    const room = Math.min(x * s.size[0], (100 - x - w) * s.size[0], y * s.size[1], (100 - y - h) * s.size[1]) / 100;
    assert.ok(room >= 12, `${s.img} leaves ${room} px around the row`);
  }
  assert.deepEqual(ringStyle({ x: 4, y: 50, w: 92, h: 25 }), {
    left: "calc(4% - 3px)", top: "calc(50% - 3px)", width: "calc(92% + 6px)", height: "calc(25% + 6px)" });
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

test("Tailscale: used when the shell says so (no LocalDevVPN alert); chosen but off or signed out says why", () => {
  const ts = (o) => ({ paired: "rp", localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, address: "100.1.2.3", use: true, ...o } });
  assert.deepEqual(decideRoute("iphone", ts({})), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", ts({ use: false })), { route: "server", alert: "otherVPN" }); // Automatic, not usable: as before
  assert.deepEqual(decideRoute("iphone", ts({ use: false, connect: "tailscale" })), { route: "server", alert: "tailscaleOff" });
  assert.deepEqual(decideRoute("iphone", ts({ use: false, connect: "tailscale", signedIn: false })), { route: "server", alert: "tailscaleSignIn" });
  assert.deepEqual(decideRoute("iphone", { ...ts({ use: true }), paired: null }), { route: "server", alert: "notPaired" });
  assert.equal(ALERTS.tailscaleOff.open, undefined);
  assert.deepEqual(CONNECT_OPTIONS.map((o) => o.label), ["Automatic", "LocalDevVPN", "Tailscale"]);
  assert.match(connectFooter("auto"), /Tailscale when its VPN is on/);
});

test("Tailscale's test answer: a check, or the exact fix", () => {
  assert.equal(tailscaleTestResult({ ok: true, ms: 80 }).title, "Connected");
  const acl = tailscaleTestResult({ ok: false, code: "acl", name: "ifizbox-on-iphone.tail1.ts.net", address: "100.1.2.3" });
  assert.equal(acl.title, "Blocked by Your Tailnet");
  assert.deepEqual(JSON.parse(acl.copy), { action: "accept", src: ["ifizbox-on-iphone.tail1.ts.net"], dst: ["100.1.2.3:*"] });
  assert.ok(acl.message.includes(acl.copy));
  assert.equal(tailscaleTestResult({ code: "needs_approval" }).title, "Approve This Device");
  assert.match(tailscaleTestResult({ code: "expired" }).message, /key expiry/);
  assert.equal(tailscaleTestResult({ code: "no_interface" }).title, "Tailscale Is Off");
  assert.equal(tailscaleTestResult(null).title, "Couldn't Connect");
  assert.match(aclRule(), /<this device>/);
});

test("Tailscale's footer warns ahead of key expiry", () => {
  const now = Date.parse("2026-11-19T00:00:00Z");
  assert.equal(keyDaysLeft("2026-11-29T12:00:00Z", now), 10);
  assert.equal(keyDaysLeft("", now), null);
  assert.match(tailscaleFooter({ signedIn: true, keyExpiry: "2026-11-29T12:00:00Z", address: "100.1.2.3" }, now), /expires in 10 days/);
  assert.match(tailscaleFooter({ signedIn: true, keyExpiry: "2026-11-01T00:00:00Z" }, now), /expired/);
  assert.match(tailscaleFooter({ signedIn: true, keyExpiry: "2027-05-01T00:00:00Z", address: "100.1.2.3" }, now), /100\.1\.2\.3/);
  assert.match(tailscaleFooter({ signedIn: false }, now), /joins your tailnet/);
});
