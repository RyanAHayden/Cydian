// N9: core/share.js, the page's half of the share sheet and Open in Cydian.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShared, sharedRecord } from "./share.js";

test("parseShared: each route", () => {
  assert.deepEqual(parseShared("cydian://shared?route=helper-ipa&file=ABC-1.ipa&name=Demo.ipa"),
    { route: "helper-ipa", file: "ABC-1.ipa", url: null, name: "Demo.ipa", title: "", message: "" });
  assert.deepEqual(parseShared("cydian://shared?route=sign-ipa&url=https%3A%2F%2Fe.x%2FMy%2520App.ipa"),
    { route: "sign-ipa", file: null, url: "https://e.x/My%20App.ipa", name: "My App.ipa", title: "", message: "" });
  assert.equal(parseShared("cydian://shared?route=sign-ipa&file=Demo%202.1.ipa").file, "Demo 2.1.ipa"); // My IPAs' names
  assert.equal(parseShared("cydian://shared?route=deb&file=X.deb&name=tweak.deb").file, "X.deb");
  const r = parseShared("cydian://shared?route=refuse&title=Needs%20a%20Jailbreak&message=A%20.deb%20is%E2%80%A6");
  assert.equal(r.title, "Needs a Jailbreak");
  assert.equal(r.message, "A .deb is…");
});

test("parseShared: refuses what the shell wouldn't send", () => {
  for (const u of ["cydian://add?url=https://x/", "cydian://shared?route=boom&file=a.ipa", "https://shared?route=deb&file=a.deb",
    "cydian://shared?route=deb&file=../a.deb", "cydian://shared?route=deb&file=a.ipa", "cydian://shared?route=helper-ipa&file=a.deb",
    "cydian://shared?route=deb&file=sub/a.deb", "cydian://shared?route=deb&url=javascript:alert(1)", "cydian://shared?route=deb",
    "not a url", null]) {
    assert.equal(parseShared(u), null, String(u));
  }
});

test("sharedRecord: what I3 remembers", () => {
  assert.deepEqual(sharedRecord({ bundleId: "dev.demo", name: "Demo", version: "2.1" }),
    { id: "dev.demo", name: "Demo", version: "2.1", source: null, sourceName: "Shared" });
  assert.equal(sharedRecord({ bundleId: "dev.demo" }, "Demo.ipa").name, "Demo");
  assert.equal(sharedRecord({ code: 0 }), null);
});
