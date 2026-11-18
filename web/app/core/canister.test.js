import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchUrl, lookupUrl, mapResults, priceFor, normalRepo, createCanister } from "./canister.js";

const live = JSON.parse(readFileSync(new URL("./fixtures/f20/canister-search.json", import.meta.url), "utf8"));

test("search and lookup URLs", () => {
  assert.equal(searchUrl("filza"), "https://api.canister.me/v2/jailbreak/package/search?q=filza&limit=50");
  assert.equal(searchUrl(" a b ", { limit: 999, page: 3 }), "https://api.canister.me/v2/jailbreak/package/search?q=a+b&limit=250&page=3");
  assert.equal(searchUrl("a"), null);
  assert.equal(searchUrl(""), null);
  assert.equal(lookupUrl("com.purdix.muze4"), "https://api.canister.me/v2/jailbreak/package/com.purdix.muze4");
  assert.equal(lookupUrl("../x"), null);
});

test("repo URIs compare without scheme, case or trailing slash", () => {
  assert.equal(normalRepo("https://Repo.Chariz.com/"), normalRepo("http://repo.chariz.com"));
  assert.notEqual(normalRepo("https://havoc.app/"), normalRepo("https://havoc.app/other/"));
});

test("live results map to rows with their source", () => {
  const rows = mapResults(live, { have: [], arch: "iphoneos-arm" });
  assert.equal(rows.length, 3);
  const z = rows.find((r) => r.id === "me.aspenuwu.zinnia");
  assert.deepEqual(z, {
    id: "me.aspenuwu.zinnia", name: "Zinnia", description: z.description, author: z.author, version: "1.1.5",
    section: "Tweaks", price: null, paid: false, icon: "https://img.chariz.cloud/icon/zinnia/icon@3x.png",
    depiction: z.depiction, arch: "iphoneos-arm", archOk: true,
    repo: { uri: "https://repo.chariz.com/", name: "Chariz", slug: "chariz", flat: true, dist: "./", components: [],
      added: false, key: "deb:https://repo.chariz.com/:./" },
  });
  assert.ok(!/</.test(z.author), "no e-mail in the author");
  const bb = rows.find((r) => r.repo.slug === "bigboss");
  assert.equal(bb.repo.flat, false);
  assert.equal(bb.repo.dist, "stable");
  assert.deepEqual(bb.repo.components, ["main"]);
  assert.equal(bb.icon, null, "file:// icons dropped");
});

test("added sources are marked; other architectures go last; copies collapse to the best", () => {
  const rows = mapResults(live, { have: ["https://repo.chariz.com/"], arch: "iphoneos-arm64" });
  assert.ok(rows.filter((r) => r.repo.slug === "chariz").every((r) => r.repo.added));
  assert.ok(rows.every((r) => !r.archOk)); // all three are iphoneos-arm builds
  const mk = (over) => ({ package_id: "com.x", name: "X", version: "1", architecture: "iphoneos-arm", latest_version: false, price: "$2.99",
    repository: { uri: "https://r.example", name: "R", suite: "./" }, ...over });
  const data = [mk({ version: "1.0" }), mk({ version: "2.0", latest_version: true, architecture: "iphoneos-arm64" }),
    mk({ version: "3.0", visible: false }), mk({ package_id: "com.y", architecture: "iphoneos-arm" }),
    mk({ package_id: "<script>" }), mk({ repository: { uri: "ftp://x" } }), null];
  const out = mapResults({ data }, { arch: "iphoneos-arm64" });
  assert.deepEqual(out.map((r) => `${r.id}@${r.version}:${r.archOk}`), ["com.x@2.0:true", "com.y@1:false"]);
  assert.equal(out[0].price, "$2.99");
  assert.equal(out[0].paid, true);
  const twice = mapResults({ data: [mk({ version: "1" }), mk({ version: "2", repository: { uri: "http://R.example/", name: "R", suite: "./" } })] });
  assert.equal(twice.length, 1, "http and https copies of one repo collapse");
  assert.deepEqual(mapResults(null), []);
  assert.deepEqual(mapResults({ data: "x" }), []);
});

test("price for one repo's copy", () => {
  const j = { data: [{ price: "$1.99", repository: { uri: "https://havoc.app" } }, { price: "Free", repository: { uri: "https://repo.chariz.com" } }] };
  assert.equal(priceFor(j, "https://havoc.app/"), "$1.99");
  assert.equal(priceFor(j, "https://repo.chariz.com/"), "Free");
  assert.equal(priceFor(j, "https://other.example/"), null);
  // Lookup answers without a repository URI (as Havoc's were): matched by id or name.
  const noUri = { data: [{ price: "$1.99", repository_id: "havoc", repository: { id: "havoc" } }, { price: "$5", repository_id: "elsewhere" }] };
  assert.equal(priceFor(noUri, "https://havoc.app/"), "$1.99");
  assert.equal(priceFor(noUri, "https://repo.example.com/", "Elsewhere"), "$5");
  assert.equal(priceFor(noUri, "https://nothing.example/"), null);
});

test("answers are cached for the TTL, one request per URL at a time", async () => {
  let t = 0;
  const asked = [];
  const c = createCanister({ getJson: async (u) => { asked.push(u); await new Promise((r) => setTimeout(r, 2)); return live; }, now: () => t, ttl: 50, max: 2 });
  await Promise.all([c.search("filza"), c.search("filza")]);
  assert.equal(asked.length, 1);
  await c.search("filza");
  assert.equal(asked.length, 1);
  assert.equal(await c.search("f"), null);
  assert.equal(asked.length, 1, "1-character queries never go out");
  t = 51;
  await c.search("filza");
  assert.equal(asked.length, 2);
  await c.search("aa"); await c.search("bb");
  assert.equal(c.size(), 2, "bounded");
  // A failure is not cached.
  const bad = createCanister({ getJson: async () => { throw new Error("down"); } });
  await assert.rejects(bad.search("zz"), /down/);
  assert.equal(bad.size(), 0);
});
