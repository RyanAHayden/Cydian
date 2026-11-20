// F284: Installation & Signing's top cell (core/installroute.js installStatus) and the main page's row details.
import test from "node:test";
import assert from "node:assert/strict";
import { installStatus, STATUS_ACTIONS, CHECKING, serverDetail, certificateDetail, tailscaleVPNOn, ALERTS, decideRoute } from "./installroute.js";

const paired = (o = {}) => ({ paired: "rp", localDevVPN: false, otherVPN: false, ...o, tailscale: { connect: "auto", signedIn: false, address: null, use: false, ...(o.tailscale || {}) } });

test("still checking: Checking… with Check Connection (dimmed by the page)", () => {
  assert.equal(installStatus("iphone", undefined), CHECKING);
  assert.equal(CHECKING.title, "Checking…");
  assert.equal(STATUS_ACTIONS[CHECKING.action], "Check Connection");
});

test("ready through LocalDevVPN or Tailscale, Check Connection, installs here", () => {
  const l = installStatus("iphone", paired({ localDevVPN: true }));
  assert.deepEqual([l.title, l.subtitle, STATUS_ACTIONS[l.action], l.local], ["Ready to Install", "Straight onto this iPhone, through LocalDevVPN.", "Check Connection", true]);
  const t = installStatus("iphone", paired({ otherVPN: true, tailscale: { signedIn: true, address: "100.1.2.3", use: true } }));
  assert.equal(t.subtitle, "Straight onto this iPhone, through Tailscale.");
  assert.equal(serverDetail(t, "ifizbox.com"), "This iPhone");
});

test("another VPN, only when it isn't Tailscale's: red, Open LocalDevVPN, the server meanwhile", () => {
  const o = installStatus("iphone", paired({ otherVPN: true }));
  assert.deepEqual([o.title, o.red, STATUS_ACTIONS[o.action], o.local], ["Another VPN Is On", true, "Open LocalDevVPN", false]);
  assert.equal(serverDetail(o, "ifizbox.com"), "ifizbox.com");
  // Tailscale's VPN is on, iFizBox not signed in: sign in, never a conflict
  const s = installStatus("iphone", paired({ otherVPN: true, tailscale: { address: "100.1.2.3" } }));
  assert.deepEqual([s.state, s.title, STATUS_ACTIONS[s.action]], ["signIn", "Sign In to Tailscale", "Sign In to Tailscale"]);
  assert.ok(!s.red);
  // signed in, but Connect With is LocalDevVPN
  const c = installStatus("iphone", paired({ otherVPN: true, tailscale: { address: "100.1.2.3", signedIn: true, connect: "localdevvpn" } }));
  assert.equal(c.state, "tailscaleConnect");
  assert.equal(STATUS_ACTIONS[c.action], "Use Tailscale");
  assert.ok(ALERTS.tailscaleConnect.title);
  assert.equal(tailscaleVPNOn(paired({ tailscale: { address: "100.1.2.3" } })), true);
  assert.equal(tailscaleVPNOn(paired()), false);
});

// User, 2026-11-20: the VPN follows what the user set up, never which apps are installed.
test("another VPN opens the VPN the user set up: Tailscale, LocalDevVPN, or LocalDevVPN when nothing was chosen", () => {
  const other = (tailscale) => installStatus("iphone", paired({ otherVPN: true, tailscale }));
  const tsConnect = other({ connect: "tailscale", signedIn: true });
  const tsSignedIn = other({ connect: "auto", signedIn: true }); // signed in through setup
  const ldv = other({ connect: "localdevvpn", signedIn: true });
  const none = other({ connect: "auto", signedIn: false });
  for (const s of [tsConnect, tsSignedIn, ldv, none]) assert.deepEqual([s.title, s.red], ["Another VPN Is On", true]);
  assert.equal(STATUS_ACTIONS[tsConnect.action], "Open Tailscale");
  assert.equal(STATUS_ACTIONS[tsSignedIn.action], "Open Tailscale");
  assert.equal(STATUS_ACTIONS[ldv.action], "Open LocalDevVPN");
  assert.equal(STATUS_ACTIONS[none.action], "Open LocalDevVPN");
  // decideRoute's alert says the same: no Open LocalDevVPN for a Tailscale setup
  assert.equal(decideRoute("iphone", paired({ otherVPN: true, tailscale: { signedIn: true } })).alert, "otherVPNTailscale");
  assert.equal(ALERTS.otherVPNTailscale.open, undefined);
  assert.equal(decideRoute("iphone", paired({ otherVPN: true })).alert, "otherVPN");
  assert.equal(decideRoute("iphone", paired({ otherVPN: true, tailscale: { connect: "localdevvpn", signedIn: true } })).alert, "otherVPN");
});

test("not paired: Pair This iPhone with Start Pairing; nothing on: the VPN the user set up", () => {
  const p = installStatus("iphone", { paired: null, localDevVPN: true });
  assert.deepEqual([p.title, STATUS_ACTIONS[p.action]], ["Pair This iPhone", "Start Pairing"]);
  assert.equal(installStatus("iphone", paired()).state, "vpnOff"); // nothing chosen: LocalDevVPN
  assert.equal(installStatus("iphone", paired({ tailscale: { signedIn: true } })).action, "openTailscale");
  assert.equal(installStatus("iphone", paired({ tailscale: { connect: "tailscale" } })).state, "signIn");
  assert.equal(installStatus("iphone", null).state, "noStatus");
});

test("Signing Server chosen: ready through the server, Check Server", () => {
  const s = installStatus("server", undefined, { host: "sign.example.com" });
  assert.deepEqual([s.title, s.subtitle, STATUS_ACTIONS[s.action], s.local], ["Ready to Install", "Through the Signing Server, sign.example.com.", "Check Server", false]);
});

test("every subtitle stays short enough for the cell's two lines at 320pt", () => {
  const all = [CHECKING, installStatus("iphone", null), installStatus("iphone", { paired: null }), installStatus("iphone", paired({ otherVPN: true })),
    installStatus("iphone", paired({ tailscale: { address: "1", signedIn: true, connect: "localdevvpn" } })),
    installStatus("iphone", paired({ tailscale: { connect: "tailscale", signedIn: true } })), installStatus("iphone", paired()),
    installStatus("server", undefined)];
  for (const s of all) assert.ok(s.subtitle.length <= 70, s.subtitle);
});

test("the Certificate row: days left, Expired in red, None or Incomplete", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.deepEqual(certificateDetail({ expires: "2027-09-05T12:00:00Z" }, { now }), { text: "289 days left", red: false });
  assert.deepEqual(certificateDetail({ expires: "2026-11-21T13:00:00Z" }, { now }), { text: "1 day left", red: true });
  assert.deepEqual(certificateDetail({ expires: "2026-11-01T00:00:00Z" }, { now }), { text: "Expired", red: true });
  assert.deepEqual(certificateDetail(null), { text: "None" });
  assert.deepEqual(certificateDetail(null, { staged: true }), { text: "Incomplete" });
});
