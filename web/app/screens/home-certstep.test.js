// B245: the sideload app with a Signing Server set and no certificate: Home's red tile names the step left instead of
// "Nothing can be installed yet", which read as a contradiction of Installation & Signing's "Ready to Install".
import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP_TILE } from "../core/signing.js";
import { signingSlot, slotTile, httpsServer, CERT_STEP_LEFT } from "./home.js";

test("httpsServer: only an https Signing Server counts", () => {
  assert.equal(httpsServer("https://sign.example.com"), "https://sign.example.com");
  assert.equal(httpsServer("sign.example.com"), "https://sign.example.com");
  assert.equal(httpsServer("http://sign.example.com"), null);
  assert.equal(httpsServer(""), null);
  assert.equal(httpsServer(null), null);
});

test("sideload, server set, no certificate: Signing Needs Setup names the certificate", async () => {
  let pinged = 0;
  const slot = await signingSlot("sideload", { setUp: async () => false, server: () => "https://sign.example.com",
    reachable: async () => { pinged++; return true; }, identity: async () => null });
  assert.equal(pinged, 0); // not set up: the server isn't asked
  assert.equal(slot.server, "https://sign.example.com");
  const t = slotTile("sideload", slot, { certShown: true });
  assert.equal(t.title, "Signing Needs Setup");
  assert.equal(t.subtitle, CERT_STEP_LEFT);
  assert.doesNotMatch(t.subtitle, /Nothing can be installed/);
});

test("no Signing Server, or the website: the plain setup tile stays", async () => {
  const none = await signingSlot("sideload", { setUp: async () => false, server: () => "" });
  assert.deepEqual(slotTile("sideload", none, { certShown: true }), { ...SETUP_TILE });
  const plain = await signingSlot("sideload", { setUp: async () => false, server: () => "http://lan.example" });
  assert.deepEqual(slotTile("sideload", plain, { certShown: true }), { ...SETUP_TILE });
  const site = await signingSlot("site", { setUp: async () => false });
  assert.deepEqual(slotTile("site", site), { ...SETUP_TILE });
});
