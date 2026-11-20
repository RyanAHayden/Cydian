// B186: the Add Tweaks page scrolls like the other pages (its body is the scroller, with the grouped pinstripes) and
// is pushed with a back arrow labelled with the app's name ("Back" when that's long).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAddTweaks, backLabel } from "./tweaks.js";
import { memoryIpaStore } from "../core/myipas.js";

import { withDocument } from "../fakes.test-helper.js";

test("Add Tweaks: the body is a grouped page scroller, pushed with the app's name on the back arrow", async () => {
  await withDocument(async () => {
    const mem = memoryIpaStore();
    let opened = null;
    openAddTweaks({ bundleId: "com.x.app", name: "YouTube", store: async () => mem, rows: async () => [],
      show: (o) => { opened = o; return () => {}; } });
    assert.equal(opened.title, "Add Tweaks");
    assert.equal(opened.back, "YouTube");
    for (const c of ["sheet-scroll", "page-body", "grouped"]) assert.ok(opened.body.classList.contains(c), c);
    for (let i = 0; i < 20 && !opened.body.children.some((g) => g.classList?.contains("group")); i++) await new Promise((r) => setTimeout(r, 0));
    assert.ok(opened.body.children.some((g) => g.classList?.contains("group")), "drawn into the scroller");
  });
  assert.equal(backLabel("YouTube"), "YouTube");
  assert.equal(backLabel("A Very Long App Name"), "Back");
  assert.equal(backLabel(""), "Back");
});
