// B281: an install from an ifizbox://install link (or another sideloader's IPA link) writes no Installed record, so
// when its run ends incoming.js has Installed load the signed records again (reloadSigned): every live apps list
// loads again and every app page still on screen draws again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadSigned, openAppPage } from "./installed.js";
import { handleIncoming } from "../incoming.js";

const LINK = "ifizbox://install?url=" + encodeURIComponent("https://e.example/probe.ipa") + "&name=Probe";
const yes = async () => ({ index: 1 });

test("B281: the link's Install runs, then Installed reloads", async () => {
  const order = [];
  const install = async () => { order.push("install"); return true; };
  const reload = async () => { order.push("reload"); };
  assert.equal(await handleIncoming(LINK, { alert: yes, install, open: () => {}, reload }), "install");
  assert.deepEqual(order, ["install", "reload"]);
});

test("B281: a run that fails or throws still reloads; Cancel doesn't", async () => {
  let n = 0;
  const reload = async () => { n++; };
  await handleIncoming(LINK, { alert: yes, install: async () => false, open: () => {}, reload });
  await assert.rejects(handleIncoming(LINK, { alert: yes, install: async () => { throw new Error("boom"); }, open: () => {}, reload }));
  await handleIncoming(LINK, { alert: async () => ({ index: 0 }), install: async () => assert.fail("installed"), open: () => {}, reload });
  assert.equal(n, 2);
});

test("B281: another sideloader's IPA link reloads too", async () => {
  let n = 0;
  const r = await handleIncoming("feather://install/https://cdn.example.com/My.ipa", { alert: yes, on: () => true, open: () => {},
    install: async () => true, reload: async () => { n++; } });
  assert.equal(r, "other-install");
  assert.equal(n, 1);
});

test("B281: a reload that fails doesn't fail the link", async () => {
  const r = await handleIncoming(LINK, { alert: yes, install: async () => true, open: () => {}, reload: async () => { throw new Error("no page"); } });
  assert.equal(r, "install");
});

test("B281: reloadSigned loads the lists and draws every app page still on screen again, quietly", () => {
  const route = { tab: "installed", path: ["app:com.example.probe"] };
  const live = { isConnected: true };
  const gone = { isConnected: true };
  openAppPage(live, route, "ctx");
  openAppPage(gone, route);
  gone.isConnected = false; // popped
  let loads = 0;
  const drawn = [];
  const n = reloadSigned({ load: () => { loads++; }, draw: (body, r, ctx, opts) => drawn.push([body, r, ctx, opts]) });
  assert.equal(loads, 1);
  assert.equal(n, 1);
  assert.deepEqual(drawn, [[live, route, "ctx", { quiet: true }]]);
});
