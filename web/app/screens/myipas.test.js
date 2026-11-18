// F77: My IPAs' routes (screens/myipas.js) and the link another app's .ipa opens (incoming.js).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pageOf, nav } from "./myipas.js";
import { myIpasPath, handleIncoming } from "../incoming.js";

const r = (...path) => ({ tab: "installed", path });
const saved = globalThis.cydianNative;
afterEach(() => { if (saved === undefined) delete globalThis.cydianNative; else globalThis.cydianNative = saved; });

test("My IPAs' pages", () => {
  globalThis.cydianNative = { mode: "sideload", call: async () => null };
  assert.equal(pageOf(r()), null);
  assert.equal(pageOf(r("package:x")), null);
  assert.deepEqual(pageOf(r("myipas")), { page: "list" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A b.ipa")), { page: "ipa", file: "A b.ipa" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "options", file: "A.ipa" });
  assert.deepEqual(pageOf(r("myipas", "junk")), { page: "missing" });
  assert.equal(nav(r("myipas")).right.label, "Add");
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).title, "A b");
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).right.label, "Install");
  assert.equal(nav(r("myipas", "ipa:A.ipa", "options")).title, "Sign Options");
});

test("the website has no Sign Options page (the Signing Server signs as the IPA is)", () => {
  delete globalThis.cydianNative;
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "missing" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
});

test("an .ipa another app sent opens its page in My IPAs", async () => {
  assert.deepEqual(myIpasPath("cydian://myipas?file=My%20App.ipa"), ["myipas", "ipa:My App.ipa"]);
  assert.deepEqual(myIpasPath("cydian://myipas?file=..%2Fx.ipa"), ["myipas"]);
  assert.deepEqual(myIpasPath("cydian://myipas?file=notes.txt"), ["myipas"]);
  assert.deepEqual(myIpasPath("cydian://myipas"), ["myipas"]);
  assert.equal(await handleIncoming("cydian://myipas?file=A.ipa"), "myipas");
});
