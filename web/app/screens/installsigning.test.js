// F271: Settings > Installation & Signing, the sideload build's one page for Install Apps With and the certificate.
import test from "node:test";
import assert from "node:assert/strict";
import { opensMerged, mergedLayout, signingLayout, nav, MERGED_TITLE } from "./settings.js";
import { PAGE } from "./installroute.js";

test("installation and signing both open the merged page; their sub-pages stay their own", () => {
  assert.equal(PAGE, "installation");
  assert.equal(opensMerged(["signing"]), true);
  assert.equal(opensMerged(["installation"]), true);
  assert.equal(opensMerged(["installation", "pair"]), false); // This iPhone's pairing page
  assert.equal(opensMerged(["signing", "help"]), false); // How Signing Works
  assert.equal(opensMerged(["signing", "showExpiry"]), false); // a list page
  assert.equal(opensMerged(["general"]), false);
  assert.equal(opensMerged([]), false);
  // not the sideload build: nothing is merged
  assert.equal(opensMerged(["signing"], false), false);
  assert.equal(opensMerged(["installation"], false), false);
});

test("Install Apps With and This iPhone's groups come first, then the Certificate and Provisioning Profile", () => {
  const layout = mergedLayout(signingLayout({ mode: "sideload", certificate: true, profile: true, options: true }));
  assert.deepEqual(layout, ["install", "certificate", "profile", "options", "server", "status", "remove", "help"]);
  // off (the website, the jailbreak app): the Signing page as before
  assert.deepEqual(mergedLayout(["certificate", "help"], false), ["certificate", "help"]);
});

test("outside the sideload build the page keeps its old title", () => {
  // these tests run as the website (no native bridge), where Settings > Signing stays Signing
  assert.equal(MERGED_TITLE, "Installation & Signing");
  assert.equal(nav({ path: ["signing"] }).title, "Signing");
  assert.equal(nav({ path: ["installation", "pair"] }).title, "This iPhone");
});
