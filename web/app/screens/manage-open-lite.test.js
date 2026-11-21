// Sources > Manage in the sideload app (Lite): Find More Sources shows there too (Tweak Sources), and its row icon
// once threw "no row icon globe", leaving Manage blank. Its own file: the app's mode is read when modules load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakePage, fakeNative, memStorage, tick } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage();
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.ifizboxNative = fakeNative({ "sources.list": [] }, { mode: "sideload" });
const sources = await import("./sources.js");
const { format } = await import("../router.js");

test("Lite: Manage opens #/sources/manage with its rows, More Sources among them", async () => {
  const went = [];
  const ctx = { go: (r) => went.push(r), setBadge() {}, setTitle() {} };
  const button = [sources.nav({ tab: "sources", path: [] }, ctx).right].flat().find((b) => b.label === "Manage");
  assert.ok(button, "the Sources nav bar has Manage");
  button.onClick({ currentTarget: null });
  assert.equal(format(went[0]), "#/sources/manage");
  const body = fakePage();
  sources.render(body, went[0], ctx);
  await tick();
  const rows = body.querySelectorAll(".cell-label").map((n) => n.textContent);
  for (const l of ["Sources", "Import & Export", "Hidden", "More Sources"]) {
    assert.ok(rows.some((r) => r.startsWith(l)), `Manage lists ${l} (got ${rows.join(", ")})`);
  }
});
