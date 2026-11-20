// B202: Search > a tweak from a repo not added > View Repo, through the real action sheet and the real navigation
// (findmore.test.js stubs the sheet, so C26's broken close, which froze the app on the phone, went unseen): the
// sheet answers and goes, the link pushes Find More's repo page on the Search tab, and that page draws from the row
// it was opened with (count: null) without waiting on Canister.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, fakePage, tick } from "../nav/fakedom.test-helper.js";
import { setNavigator } from "../nav/go.js";
import { parse, mountLink, mounted } from "../router.js";
import { discoveryGroup, VIEW_REPO } from "./extras.js";
import { renderRepo, nav, isFind } from "./findmore.js";

const dislike = JSON.parse(readFileSync(new URL("../core/fixtures/f305/package-dislike.json", import.meta.url), "utf8"));

let saved;
const went = [];
beforeEach(() => {
  saved = globalThis.document;
  globalThis.document = fakeDocument();
  went.length = 0;
  setNavigator({ go: (hash) => went.push(hash), back: () => {} });
});
afterEach(() => { globalThis.document = saved; setNavigator(null); });

// Fails instead of hanging the run when `p` never settles (the frozen sheet never answered).
const within = (p, what, ms = 2000) => {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(timer));
};

test("Search > a tweak from a repo not added > View Repo: the sheet goes and the repo's page is pushed on Search", async () => {
  const g = discoveryGroup(null, { search: async () => dislike, sources: async () => [], wait: 0, tweaks: () => true,
    label: () => ({ kind: "unknown", label: "Unknown" }) });
  await g.search("dislike");
  const row = g.el.querySelectorAll(".cell").find((c) => c.textContent.includes("Keycap's Repo"));
  assert.ok(row, "Other Sources · Canister lists the tweak from Keycap's Repo");
  const offered = row.querySelector(".cell-inner").click(); // the row's onClick: offerTweak with the real sheet
  await tick();
  const sheet = document.body.querySelector(".action-sheet");
  assert.ok(sheet, "the tweak's sheet opens");
  const view = sheet.querySelectorAll(".action-button").find((b) => b.textContent === VIEW_REPO);
  assert.ok(view, "it offers View Repo");
  view.click();
  assert.deepEqual(await within(offered, "offerTweak"), ["view"]);
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(document.body.querySelector(".action-scrim"), null, "the sheet is gone, nothing left over the screen");
  assert.deepEqual(went, ["#/sources/manage/find/keycap"]);

  // The router mounts it on the Search tab's own stack, so Back returns to the results.
  const route = mountLink({ tab: "search", path: [] }, parse(went[0]));
  assert.deepEqual(route, { tab: "search", path: ["~sources", "manage", "find", "keycap"] });
  const screen = mounted(route);
  assert.ok(isFind(screen));
  assert.equal(nav(screen, null).title, "Keycap's Repo", "the title comes from the row at once");

  // The page draws from the kept row (count: null) and asks Canister only for the tweak count.
  const asked = [];
  const api = { repo: async (s) => { asked.push(`repo ${s}`); return { data: null }; }, packages: async (s) => { asked.push(`packages ${s}`); return { data: [] }; } };
  const page = fakePage();
  const r = await within(renderRepo(page, "keycap", null, { api, sources: async () => [], sideload: () => true }), "renderRepo");
  assert.equal(r.name, "Keycap's Repo");
  assert.equal(r.count, null);
  assert.match(page.textContent, /All Packages—/);
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(asked, ["packages keycap"]);
  assert.equal(page.querySelector(".find-tweaks").querySelector(".cell-detail").textContent, "0");
});
