// N11: after a run changes what's installed (catalog.onChange), an APT package page still on screen updates its nav
// bar button (Install <-> Modify) and the history Modify's sheet reads, without being opened again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshPackagePages } from "./browse.js";

const apt = (id, connected = true) => ({ body: { isConnected: connected }, id, key: "k", pkg: { stanza: { kind: "deb", package: id } },
  history: { name: id, versions: [{ version: "1", installed: false, keys: ["k"] }] } });
const hist = (installed) => ({ name: "x", versions: [{ version: "2", installed, keys: ["k"] }] });

test("installed now: the page's button becomes Modify and its history is the new one", async () => {
  const page = apt("tree");
  const pages = new Map([["#/search/package:tree", page]]);
  const labels = [];
  const asked = [];
  await refreshPackagePages(pages, { history: async (id, key) => { asked.push([id, key]); return hist(true); },
    label: (body, l) => labels.push([body, l]) });
  assert.deepEqual(asked, [["tree", "k"]]);
  assert.deepEqual(labels, [[page.body, "Modify"]]);
  assert.equal(page.history.versions[0].installed, true);
});

test("removed now: back to Install", async () => {
  const pages = new Map([["a", apt("tree")]]);
  const labels = [];
  await refreshPackagePages(pages, { history: async () => hist(false), label: (_, l) => labels.push(l) });
  assert.deepEqual(labels, ["Install"]);
});

test("pages no longer on screen are dropped; AltStore pages and failed lookups are left alone", async () => {
  const gone = apt("gone", false);
  const ipa = { ...apt("app"), pkg: { stanza: { kind: "ipa", ipa: {} } } };
  const broken = apt("broken");
  const before = broken.history;
  const pages = new Map([["g", gone], ["i", ipa], ["b", broken]]);
  const labels = [];
  await refreshPackagePages(pages, { history: async (id) => { if (id === "broken") throw new Error("worker"); return assert.fail(id); },
    label: (_, l) => labels.push(l) });
  assert.deepEqual([...pages.keys()], ["i", "b"]);
  assert.deepEqual(labels, []);
  assert.equal(broken.history, before);
});
