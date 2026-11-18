// An IPA page redrawn after Install or Save: only when it's on screen (own tab or mounted on Home), and only in the
// active tab's stack; Home's root got the IPA's page when the first .is-top in the document was taken (user 2026-11-18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shownBody } from "./myipas.js";

test("shownBody: the active stack's top, for the IPA's route only", () => {
  const route = { tab: "installed", path: ["myipas", "ipa:A.ipa"] };
  const asked = [];
  globalThis.document = { querySelector: (s) => { asked.push(s); return "body"; } };
  for (const hash of ["#/installed/myipas/ipa%3AA.ipa", "#/home/~installed/myipas/ipa%3AA.ipa"]) {
    globalThis.location = { hash };
    assert.equal(shownBody(route), "body", hash);
  }
  assert.ok(asked.every((s) => s.startsWith(".tab-stack.is-active > ")));
  for (const hash of ["#/home", "#/installed/myipas", "#/home/~installed/myipas/ipa%3AB.ipa"]) {
    globalThis.location = { hash };
    assert.equal(shownBody(route), null, hash);
  }
});
