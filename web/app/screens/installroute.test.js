// Settings > Installation's page (screens/installroute.js): the choice with short subtitles, This iPhone's state rows
// once it is chosen, and This iPhone's one page in each state.
import test from "node:test";
import assert from "node:assert/strict";
import { installationGroups, vpnDetail, SUB_TITLES, setupGroups } from "./installroute.js";
import { IPHONE_INTRO } from "../core/installroute.js";

test("Install Apps With: Signing Server and This iPhone, the chosen one checked, a point per subtitle line", () => {
  const [g, more] = installationGroups("server", null);
  assert.equal(g.header, "Install Apps With");
  assert.deepEqual(g.rows.map((r) => [r.label, r.checked]), [["Signing Server", true], ["This iPhone", false]]);
  assert.deepEqual(g.rows[0].subtitle.split("\n"), ["Default", "Uses ifizbox.com"]);
  assert.deepEqual(g.rows[1].subtitle.split("\n"), ["LocalDevVPN or Tailscale", "No server, no install popup", "Updates itself"]);
  assert.ok(g.rows.every((r) => r.cls === "route-row"));
  assert.equal(more, undefined);
});

test("This iPhone chosen: Pairing and the VPN's state, and a tap picks", () => {
  const picked = [];
  const gs = installationGroups("iphone", { paired: "rp", localDevVPN: false, otherVPN: true }, { pick: (v) => picked.push(v) });
  assert.equal(gs.length, 4);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Pairing", "Paired"], ["LocalDevVPN", "Another VPN"], ["Open LocalDevVPN", undefined]]);
  assert.match(gs[1].rows[0].href, /installation\/pair$/);
  gs[0].rows[0].onClick();
  assert.deepEqual(picked, ["server"]);
  assert.equal(vpnDetail({ localDevVPN: true }), "On");
  assert.equal(vpnDetail(null), "Unknown");
  assert.equal(SUB_TITLES.pair, "This iPhone");
});

test("This iPhone's page: one sentence under the title, no list of benefits", () => {
  for (const s of ["connect", "pairing", "paired", "file"]) {
    const [intro] = setupGroups(s, null, null);
    assert.equal(intro.header, "Install on This iPhone");
    assert.equal(intro.footer, IPHONE_INTRO);
    assert.equal(intro.rows, undefined);
  }
});

test("VPN off: its state and Open LocalDevVPN, nothing to pair yet", () => {
  let opened = 0;
  const gs = setupGroups("connect", { paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: false }, null, { openVPN: () => opened++ });
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["LocalDevVPN", "Off"], ["Open LocalDevVPN", undefined]]);
  gs[1].rows[1].onClick();
  assert.equal(opened, 1);
  assert.match(gs[1].footer, /by itself/);
  assert.ok(!gs.some((g) => g.pin || g.guide));
});

test("pairing: the code group, then the guide with the step or error line; Try Again only after it stopped", () => {
  const on = setupGroups("pairing", null, { pin: "123456", text: "Waiting for the iPhone to connect (port 5).", error: "" });
  assert.deepEqual(on[1].rows.map((r) => [r.label, r.detail]), [["LocalDevVPN", "On"]]);
  assert.ok(on[2].pin);
  assert.ok(on[3].guide);
  assert.equal(on[3].footer, "Waiting for the iPhone to connect (port 5).");
  assert.equal(on.length, 4);
  assert.match(setupGroups("pairing", null, { pin: "123456", text: "", error: "bad proof" })[3].footer, /bad proof.*try again/);
  let tries = 0;
  const off = setupGroups("pairing", null, null, { failed: true, retry: () => tries++ });
  assert.equal(off[3].footer, "Pairing stopped.");
  off[4].rows[0].onClick();
  assert.equal(tries, 1);
});

test("paired: Paired with a check, then Check Connection and Forget Pairing", () => {
  const gs = setupGroups("paired", { paired: "rp" }, null);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.checked]), [["Paired", true]]);
  assert.equal(gs[2].rows[0].label, "Check Connection");
  assert.equal(gs[3].rows[0].label, "Forget Pairing");
});

test("This iPhone: Connect With and Tailscale (Sign In, or the device with Test Connection and Sign Out)", () => {
  const chosen = [];
  let gs = installationGroups("iphone", { paired: "rp", tailscale: { connect: "tailscale", signedIn: false } }, { connect: (v) => chosen.push(v) });
  assert.equal(gs[2].header, "Connect With");
  assert.deepEqual(gs[2].rows.map((r) => [r.label, r.checked]), [["Automatic", false], ["LocalDevVPN", false], ["Tailscale", true]]);
  gs[2].rows[0].onClick();
  assert.deepEqual(chosen, ["auto"]);
  assert.equal(gs[3].header, "Tailscale");
  assert.deepEqual(gs[3].rows.map((r) => r.label), ["Sign In"]);
  gs = installationGroups("iphone", { paired: "rp", tailscale: { connect: "auto", signedIn: true, name: "ifizbox-on-iphone" } });
  assert.deepEqual(gs[3].rows.map((r) => [r.label, r.detail]), [["Device", "ifizbox-on-iphone"], ["Test Connection", undefined], ["Sign Out", undefined]]);
  assert.equal(gs[2].rows[0].checked, true);
  gs = installationGroups("iphone", null, { busy: "Log in on the page" });
  assert.deepEqual(gs[3].rows.map((r) => [r.label, r.detail]), [["Signing In…", "Log in on the page"]]);
});
