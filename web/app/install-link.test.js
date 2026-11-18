// F184: ifizbox.com/?install (a site's Add to iFizBox button, when the app isn't installed) opens Home without the
// param and asks Install iFizBox First once, on the website only, whatever the first-visit state is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { takeInstallParam, askFromInstallLink, FIRST_KEY } from "./websign-gate.js";

function memory(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
// A window whose replaceState moves location, as a browser's does.
function fakeWin(url, extra = {}) {
  const win = { ...extra, replaced: [] };
  const set = (u) => { const x = new URL(u, "https://ifizbox.com"); win.location = { pathname: x.pathname, search: x.search, hash: x.hash }; };
  set(url);
  win.history = { replaceState: (_s, _t, u) => { win.replaced.push(u); set(u); } };
  return win;
}
// Runs a launch as app.js does: take the param before the router, ask after. -> number of popups shown
async function launch(win, mode, storage = memory(), answer = 2) {
  const shown = [];
  const took = takeInstallParam(win, { mode });
  await askFromInstallLink(took, { install: () => {}, storage, alert: async (a) => { shown.push(a); return { index: answer }; } });
  return shown;
}

test("?install on the website: Home, the URL cleaned, Install iFizBox First asked once", async () => {
  const win = fakeWin("/?install");
  const shown = await launch(win, "site");
  assert.equal(shown.length, 1);
  assert.match(shown[0].title, /First$/);
  assert.deepEqual(win.replaced, ["/#/home"]);
  assert.equal(win.location.search, "");
  assert.equal(win.location.hash, "#/home");
  // the same page again (a re-run, a reload of the cleaned URL) doesn't ask again
  assert.equal((await launch(win, "site")).length, 0);
});

test("?install keeps the other params and asks even after Browse Anyway (firstVisitState 'later')", async () => {
  const win = fakeWin("/?ref=fizl0&install=1#/sources");
  const shown = await launch(win, "site", memory({ [FIRST_KEY]: "later" }));
  assert.equal(shown.length, 1);
  assert.deepEqual(win.replaced, ["/?ref=fizl0#/home"]);
  const again = fakeWin("/?install");
  assert.equal((await launch(again, "site", memory({ [FIRST_KEY]: "installed" }))).length, 1);
});

test("?install never asks in the app or the native shells, and leaves their URL alone", async () => {
  for (const [mode, extra] of [["jailbreak", {}], ["sideload", {}], ["site", { cydianNative: {} }], ["site", { cydianApp: true }]]) {
    const win = fakeWin("/?install", extra);
    assert.equal((await launch(win, mode)).length, 0, mode);
    assert.deepEqual(win.replaced, [], mode);
    assert.equal(win.location.search, "?install", mode);
  }
});

test("no ?install: nothing asked, URL untouched", async () => {
  for (const u of ["/", "/?installed=1", "/#/home", "/?x=install"]) {
    const win = fakeWin(u);
    assert.equal((await launch(win, "site")).length, 0, u);
    assert.deepEqual(win.replaced, [], u);
  }
});

test("Install iFizBox in the popup runs the install flow it was given", async () => {
  let ran = 0;
  const took = takeInstallParam(fakeWin("/?install"), { mode: "site" });
  const r = await askFromInstallLink(took, { install: () => { ran++; }, storage: memory(), alert: async () => ({ index: 0 }) });
  assert.equal(r, "install");
  assert.equal(ran, 1);
});
