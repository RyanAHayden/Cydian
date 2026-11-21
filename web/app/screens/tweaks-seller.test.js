// B268: Add Tweaks in the sideload build said "This paid tweak's source names no seller" for Havoc's and Chariz's paid
// tweaks, whose repos do publish a payment_endpoint: the seller was looked up in All Sources ("*"), which leaves the
// Tweak Sources out, so it never found the tweak's source. Real Packages stanzas from Chariz, Havoc and BigBoss
// (core/fixtures/paid/, cut from the live files on 2026-11-21) in a catalog shaped like the phone's: free tweaks
// download straight from the repo, paid ones reach their seller (Sign In), and only a paid tweak whose repo sells
// nothing (BigBoss's old Cydia Store packages, which it answers 403 for) gets the "no seller" message.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePackages, compareVersions } from "../core/apt.js";
import { isCommercial, PaidNeeded } from "../core/payment.js";
import { tweakDeb, createPaidTweaks, findSeller } from "./tweaks.js";

const REPOS = {
  bigboss: { key: "deb:http://apt.thebigboss.org/repofiles/cydia/:stable", uri: "http://apt.thebigboss.org/repofiles/cydia/", root: "http://apt.thebigboss.org/repofiles/cydia/" },
  chariz: { key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", root: "https://repo.chariz.com/", endpoint: "https://chariz.com/api/sileo/" },
  havoc: { key: "deb:https://havoc.app/:./", uri: "https://havoc.app/", root: "https://havoc.app/", endpoint: "https://havoc.app/api/sileo/" },
};
const SOURCES = [{ key: "alt:https://ifizbox.com/repo/source.json", uri: "https://ifizbox.com/repo/source.json" },
  ...Object.values(REPOS).map(({ key, uri }) => ({ key, uri }))];

// per source: id -> its stanzas, newest first
const bySource = new Map();
for (const [name, r] of Object.entries(REPOS)) {
  const text = readFileSync(new URL(`../core/fixtures/paid/${name}-Packages`, import.meta.url), "latin1");
  const ids = new Map();
  for (const st of parsePackages(text, r.root)) (ids.get(st.package) ?? ids.set(st.package, []).get(st.package)).push(st);
  for (const list of ids.values()) list.sort((a, b) => compareVersions(b.version, a.version));
  bySource.set(r.key, ids);
}

// The phone's catalog in the sideload build: All Sources answers null for a Tweak Source's package (seen on the
// iPhone 15 Pro), a source's own key answers { stanza, key, others }.
function phoneCatalog({ all = false } = {}) {
  const one = (id, key) => {
    const list = bySource.get(key)?.get(id);
    return list ? { stanza: list[0], key, others: list.map((s) => ({ key, version: s.version })) } : null;
  };
  return {
    async package(id, key) {
      if (key !== "*") return one(id, key);
      if (!all) return null;
      for (const k of bySource.keys()) { const p = one(id, k); if (p) return p; }
      return null;
    },
  };
}
const stanza = (repo, id) => bySource.get(REPOS[repo].key).get(id)[0];
const endpointText = async (url) => {
  const r = Object.values(REPOS).find((x) => url === `${x.uri}payment_endpoint`);
  if (!r?.endpoint) throw new Error("The source answered HTTP 404.");
  return `${r.endpoint}\n`;
};
const seller = (st, o = {}) => findSeller(st, { catalog: phoneCatalog(o), sources: SOURCES, text: endpointText, cache: new Map() });

// a shell that answers the vendors' Sileo calls: signed out, the package not bought
function vendorShell() {
  const asked = [];
  const json = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  return {
    asked,
    async call(method, params) {
      if (method === "keychain.get") return null;
      if (method === "device.info") return { udid: "00008130-0000000000000000", model: "iPhone16,1" };
      if (method === "net.request") {
        asked.push(params.url);
        if (params.url.endsWith("/info") && !params.url.includes("/package/")) return { status: 200, body: json({ name: new URL(params.url).hostname }) };
        if (params.url.includes("/package/")) return { status: 200, body: json({ price: "$1.99", purchased: false, available: true }) };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
const FREE = [["chariz", "com.amywhile.aemulotrial"], ["chariz", "com.icraze.artemis"], ["havoc", "com.nahtedetihw.airpodscompanion"],
  ["havoc", "com.mtac.ampere"], ["bigboss", "com.pear.gameoflife"], ["bigboss", "org.thebigboss.playme"]];
const PAID = [["chariz", "com.amywhile.aemulo"], ["chariz", "com.serena.antoine"], ["havoc", "jp.uzra.aerial"], ["havoc", "com.polytweaks.aerial2"]];
const UNSOLD = [["bigboss", "org.thebigboss.2x2foldericons"], ["bigboss", "com.tweakysbylogan.3dapplock"]];

test("free tweaks from Chariz, Havoc and BigBoss download from their repo's Filename, never through a seller", async () => {
  const noPaid = { deb: async () => { throw new Error("asked the seller for a free tweak"); } };
  for (const [repo, id] of FREE) {
    const st = stanza(repo, id);
    assert.equal(isCommercial(st), false, id);
    assert.ok(st.debUrl?.startsWith(REPOS[repo].root), `${id} has a .deb URL on its repo`);
    let url = null;
    const data = await tweakDeb(st, { paid: noPaid, fetchDeb: async (u) => { url = u; return new Uint8Array([1, 2, 3]); } });
    assert.equal(url, st.debUrl, id);
    assert.equal(data.length, 3);
  }
});

test("a paid Havoc or Chariz tweak finds its repo's seller though All Sources doesn't list it", async () => {
  for (const [repo, id] of PAID) {
    const st = stanza(repo, id);
    assert.equal(isCommercial(st), true, id);
    const found = await seller(st);
    assert.equal(found?.base, REPOS[repo].endpoint, id);
    assert.equal(found.source.key, REPOS[repo].key);
  }
  // where All Sources does list it (the jailbreak build), the same answer
  assert.equal((await seller(stanza("havoc", "jp.uzra.aerial"), { all: true }))?.base, REPOS.havoc.endpoint);
});

test("Add Tweaks on a paid Havoc tweak asks to Sign In to Havoc, not 'names no seller'", async () => {
  const shell = vendorShell();
  const vendorFor = (st) => seller(st);
  const paid = createPaidTweaks({ call: shell.call, vendorFor, storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const st = stanza("havoc", "jp.uzra.aerial");
  await assert.rejects(tweakDeb(st, { paid, fetchDeb: async () => { throw new Error("fetched a paid .deb from the repo"); } }),
    (e) => e instanceof PaidNeeded && e.need === "signin" && e.price === "$1.99");
  assert.ok(shell.asked.some((u) => u === "https://havoc.app/api/sileo/package/jp.uzra.aerial/info"), shell.asked.join(" "));
  assert.deepEqual(await paid.seller(st), { name: "havoc.app" });
});

test("only a paid tweak whose repo sells nothing (BigBoss's Cydia Store packages) says it has no seller", async () => {
  const paid = createPaidTweaks({ call: vendorShell().call, vendorFor: (st) => seller(st) });
  for (const [repo, id] of UNSOLD) {
    const st = stanza(repo, id);
    assert.equal(isCommercial(st), true, id);
    assert.equal(await seller(st), null, id);
    await assert.rejects(tweakDeb(st, { paid, fetchDeb: async () => new Uint8Array(1) }), /names no seller/);
  }
});

test("a payment_endpoint fetch that failed is asked again, not kept as no seller", async () => {
  const cache = new Map();
  let fail = true;
  const text = async (url) => { if (fail) throw new Error("offline"); return endpointText(url); };
  const st = stanza("chariz", "com.amywhile.aemulo");
  const ask = () => findSeller(st, { catalog: phoneCatalog(), sources: SOURCES, text, cache });
  assert.equal(await ask(), null);
  fail = false;
  assert.equal((await ask())?.base, REPOS.chariz.endpoint);
});

test("a free tweak whose download fails says it couldn't be downloaded, never that it's paid", async () => {
  const st = stanza("havoc", "com.mtac.ampere");
  const noPaid = { deb: async () => { throw new Error("asked the seller for a free tweak"); } };
  await assert.rejects(tweakDeb({ ...st, version: `${st.version}-down` }, { paid: noPaid, fetchDeb: async () => { throw new Error("The source answered HTTP 503."); } }),
    (e) => /couldn't be downloaded/.test(e.message) && /HTTP 503/.test(e.message) && !/paid|seller/.test(e.message));
});

test("a source that answers it has no payment_endpoint is kept, not asked on every lookup", async () => {
  const cache = new Map();
  let asked = 0;
  const text = async () => { asked++; throw Object.assign(new Error("The source answered HTTP 404."), { code: "not_found" }); };
  const st = stanza("bigboss", "org.thebigboss.2x2foldericons");
  for (let i = 0; i < 3; i++) assert.equal(await findSeller(st, { catalog: phoneCatalog(), sources: SOURCES, text, cache }), null);
  assert.equal(asked, 1);
});

test("All Sources listing another source's copy (other version, no seller) still finds the seller of this one", async () => {
  const st = stanza("havoc", "jp.uzra.aerial");
  const other = { ...st, version: "0.9" };
  const catalog = { package: async (id, key) => (key === "*" ? { stanza: other, key: REPOS.bigboss.key, others: [{ key: REPOS.bigboss.key, version: "0.9" }] }
    : phoneCatalog().package(id, key)) };
  assert.equal((await findSeller(st, { catalog, sources: SOURCES, text: endpointText, cache: new Map() }))?.base, REPOS.havoc.endpoint);
});
