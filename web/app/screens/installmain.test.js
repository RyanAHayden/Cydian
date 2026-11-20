// F284: Installation & Signing's main page links to sub-pages: Install Apps With and This iPhone under installation/,
// Certificate, Signing Server and Signed Apps under signing/ (How Signing Works stays signing/help).
import test from "node:test";
import assert from "node:assert/strict";
import { opensSigningSub, opensMerged, SIGNING_SUBS } from "./settings.js";
import { subGroups, installationGroups, MAIN_ROWS } from "./installroute.js";

test("the Signing rows open their own pages, only in the sideload build", () => {
  assert.deepEqual(Object.values(SIGNING_SUBS), ["Certificate", "Signing Server", "Signed Apps"]);
  for (const s of ["certificate", "server", "apps"]) {
    assert.equal(opensSigningSub(["signing", s]), true);
    assert.equal(opensSigningSub(["signing", s], false), false);
    assert.equal(opensMerged(["signing", s]), false);
  }
  assert.equal(opensSigningSub(["signing", "help"]), false);
  assert.equal(opensSigningSub(["signing", "showExpiry"]), false); // a list page
  assert.equal(opensSigningSub(["signing"]), false);
});

test("Install Apps With's page holds the choice; This iPhone's holds its groups whatever the choice", () => {
  const all = installationGroups("iphone", { paired: "rp", localDevVPN: true });
  assert.deepEqual(subGroups(all, "with").map((g) => g.header), ["Install Apps With"]);
  assert.deepEqual(subGroups(all, "iphone").map((g) => g.header), ["This iPhone", "Connect With", "Tailscale"]);
  assert.equal(subGroups(all, null), all);
});

test("the main page's rows are fixed: status, its action, two Installation rows, three Signing rows, How Signing Works", () => {
  assert.deepEqual(MAIN_ROWS, ["status", "action", "with", "iphone", "certificate", "server", "apps", "help"]);
});
