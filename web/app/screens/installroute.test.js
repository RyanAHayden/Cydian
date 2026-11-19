// Settings > Installation's page (screens/installroute.js): the choice with This iPhone's subtitle, and This iPhone's
// state rows once it is chosen.
import test from "node:test";
import assert from "node:assert/strict";
import { installationGroups, vpnDetail, SUB_TITLES, pairGroups } from "./installroute.js";

test("Install Apps With: Signing Server and This iPhone, the chosen one checked", () => {
  const [g, more] = installationGroups("server", null);
  assert.equal(g.header, "Install Apps With");
  assert.deepEqual(g.rows.map((r) => [r.label, r.checked]), [["Signing Server", true], ["This iPhone", false]]);
  assert.match(g.rows[1].subtitle, /LocalDevVPN/);
  assert.equal(more, undefined);
});

test("This iPhone chosen: Pairing and the VPN's state, and a tap picks", () => {
  const picked = [];
  const gs = installationGroups("iphone", { paired: "rp", localDevVPN: false, otherVPN: true }, { pick: (v) => picked.push(v) });
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Pairing", "Paired"], ["LocalDevVPN", "Another VPN"], ["Open LocalDevVPN", undefined]]);
  assert.match(gs[1].rows[0].href, /installation\/pair$/);
  gs[0].rows[0].onClick();
  assert.deepEqual(picked, ["server"]);
  assert.equal(vpnDetail({ localDevVPN: true }), "On");
  assert.equal(vpnDetail(null), "Unknown");
  assert.equal(SUB_TITLES.pair, "Pair This iPhone");
});

test("Pair This iPhone: the Developer Mode steps; in pairing mode Cancel with the step or error line", () => {
  const off = pairGroups(null);
  assert.match(off[0].footer, /Settings > Privacy & Security > Developer Mode.*type this code/);
  assert.equal(off[1].rows[0].label, "Start Pairing");
  assert.equal(off[1].footer, "");
  let canceled = 0;
  const on = pairGroups({ pin: "123456", text: "Waiting for the iPhone to connect (port 5).", error: "" }, { cancel: () => canceled++ });
  assert.equal(on[1].rows[0].label, "Cancel");
  on[1].rows[0].onClick();
  assert.equal(canceled, 1);
  assert.equal(on[1].footer, "Waiting for the iPhone to connect (port 5).");
  assert.match(pairGroups({ pin: "123456", text: "", error: "bad proof" })[1].footer, /bad proof.*try again/);
});
