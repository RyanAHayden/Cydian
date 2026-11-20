// F305a: an added APT source's own page shows Canister's cached HTTPS and Signed Releases facts (browse.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { canisterFactsSlot, canisterFactsGroup } from "./browse.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const apt = { key: "deb:https://apt.procurs.us/:./", uri: "https://apt.procurs.us/" };

test("an APT source Canister knows: a Trust group with HTTPS and Signed Releases", async () => {
  const asked = [];
  const slot = canisterFactsSlot(apt, { trust: async (s) => { asked.push(s.uri); return { https: true, gpg: false, tier: 1 }; } });
  assert.ok(await slot.ready);
  assert.deepEqual(asked, ["https://apt.procurs.us/"]);
  assert.match(slot.textContent, /Trust/);
  assert.match(slot.textContent, /HTTPSYes/);
  assert.match(slot.textContent, /Signed ReleasesNo/);
  assert.match(slot.textContent, /From Canister/);
  assert.equal(slot.querySelectorAll(".find-warn").length, 0);
});

test("plain http is flagged; unknown facts say Unknown", async () => {
  const slot = canisterFactsSlot(apt, { trust: async () => ({ https: false, gpg: null }) });
  await slot.ready;
  assert.match(slot.textContent, /HTTPSNo/);
  assert.match(slot.textContent, /Signed ReleasesUnknown/);
  assert.equal(slot.querySelectorAll(".find-warn").length, 1);
});

test("nothing for AltStore sources, repos Canister doesn't list, or offline", async () => {
  let asked = 0;
  const trust = async () => { asked++; return { https: true, gpg: true }; };
  const alt = canisterFactsSlot({ key: "alt:https://x/s.json", uri: "https://x/s.json" }, { trust });
  assert.equal(await alt.ready, null);
  assert.equal(asked, 0);
  assert.equal(alt.children.length, 0);
  const miss = canisterFactsSlot(apt, { trust: async () => null });
  assert.equal(await miss.ready, null);
  assert.equal(miss.children.length, 0);
  const down = canisterFactsSlot(apt, { trust: async () => { throw new Error("offline"); } });
  assert.equal(await down.ready, null);
  assert.equal(down.children.length, 0);
  assert.equal(canisterFactsGroup({ tier: 2 }), null, "no facts, no group");
});
