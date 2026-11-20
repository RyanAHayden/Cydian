import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../test-fakes.js";
import { readFileSync } from "node:fs";
import { parseFeatured, parseSize, featuredUrl, createFeaturedStore, DEFAULT_ITEM_SIZE } from "./featured.js";

const fixture = (n) => readFileSync(new URL(`./fixtures/f20/${n}`, import.meta.url), "utf8");

test("Chariz's and Havoc's real sileo-featured.json parse", () => {
  const c = parseFeatured(fixture("chariz-featured.json"), "https://chariz.com/api/sileo/featured.json");
  assert.deepEqual(c.itemSize, { width: 263, height: 148 });
  assert.equal(c.radius, 10);
  assert.equal(c.banners.length, 2);
  assert.deepEqual(c.banners[1], { url: "https://cdn.chariz.cloud/sileo-banner/zinnia.jpg", title: "Zinnia",
    package: "me.aspenuwu.zinnia", hideShadow: false, displayText: false });
  assert.equal(c.banners[0].package, "com.sreerag.duoFree"); // capitals: dpkg allows them in practice
  const h = parseFeatured(fixture("havoc-featured.json"));
  assert.equal(h.banners[0].title, "Peek Dark");
  assert.equal(h.banners[0].displayText, true);
});

test("item sizes: CGSize strings, arrays, objects; nonsense falls back", () => {
  assert.deepEqual(parseSize("{263, 148}"), { width: 263, height: 148 });
  assert.deepEqual(parseSize(" {300.5,170} "), { width: 300.5, height: 170 });
  assert.deepEqual(parseSize([200, 100]), { width: 200, height: 100 });
  assert.deepEqual(parseSize({ width: 10, height: 5 }), { width: 10, height: 5 });
  for (const bad of ["263x148", "{0, 0}", "{99999, 1}", null, 3]) assert.deepEqual(parseSize(bad), DEFAULT_ITEM_SIZE);
});

test("hostile or broken entries are dropped, not drawn", () => {
  const f = parseFeatured({
    class: "FeaturedBannersView",
    itemCornerRadius: -4,
    banners: [
      { url: "javascript:alert(1)", package: "a.b", title: "x" },
      { url: "file:///etc/passwd", package: "a.b" },
      { url: "https://ok.example/1.png", package: "../../etc", title: "bad id" },
      { url: "https://ok.example/2.png", package: "com.ok", title: "  <b>Bold</b>\n title  " },
      { url: "img/3.png", package: "com.rel" },
      "nope", null,
    ],
  }, "https://repo.example.com/sileo-featured.json");
  assert.equal(f.radius, 10);
  assert.deepEqual(f.banners.map((b) => b.package), ["com.ok", "com.rel"]);
  assert.equal(f.banners[0].title, "<b>Bold</b> title"); // plain text; screens use textContent
  assert.equal(f.banners[1].url, "https://repo.example.com/img/3.png");
  assert.equal(f.banners[1].title, "com.rel");
});

test("not a banner list: null", () => {
  for (const x of ["", "not json", "[]", "{}", '{"class":"DepictionTabView","banners":[]}', "null"]) {
    assert.equal(parseFeatured(x), null, x);
  }
  const many = { banners: Array.from({ length: 50 }, (_, i) => ({ url: `https://x/${i}`, package: `p${i}` })) };
  assert.equal(parseFeatured(many).banners.length, 20);
});

test("featuredUrl sits at the repo's URI", () => {
  assert.equal(featuredUrl({ uri: "https://havoc.app/" }), "https://havoc.app/sileo-featured.json");
  assert.equal(featuredUrl({ uri: "https://repo.chariz.com" }), "https://repo.chariz.com/sileo-featured.json");
  assert.equal(featuredUrl({ key: "alt:https://x" }), null);
});

test("the store caches hits and misses, and Home takes a few from each source in turn", async () => {
  const asked = [];
  const files = {
    "https://havoc.app/sileo-featured.json": fixture("havoc-featured.json"),
    "https://repo.chariz.com/sileo-featured.json": fixture("chariz-featured.json"),
  };
  let t = 1000;
  const storage = memStorage();
  const getText = async (url) => { asked.push(url); if (!files[url]) throw new Error("404"); return files[url]; };
  const store = createFeaturedStore({ getText, storage, now: () => t, ttl: 100 });
  const sources = [{ key: "h", uri: "https://havoc.app/" }, { key: "none", uri: "https://empty.example/" },
    { key: "c", uri: "https://repo.chariz.com/" }, { key: "alt:x", kind: "altstore", uri: "https://alt.example/" },
    { key: "bad", uri: "https://broken.example/", error: "down" }];
  const home = await store.forHome(sources, 2);
  assert.deepEqual(home.map((b) => `${b.key}:${b.package}`),
    ["h:com.theprestigext.peekdark", "c:com.sreerag.duoFree", "h:me.tomt000.stageduo", "c:me.aspenuwu.zinnia"]);
  assert.equal(asked.length, 3); // AltStore and failed sources aren't asked
  await Promise.all([store.forHome(sources), store.get(sources[0])]);
  assert.equal(asked.length, 3, "cached, misses too");
  // A new store (next launch) reads storage; once stale it asks again.
  const again = createFeaturedStore({ getText, storage, now: () => t, ttl: 100 });
  assert.equal((await again.get(sources[0])).banners.length, 2);
  assert.equal(asked.length, 3);
  t += 101;
  await again.get(sources[0]);
  assert.equal(asked.length, 4);
  assert.deepEqual((await store.forHome(sources, 1, 1)).length, 1);
});

test("one request per file even when asked twice at once", async () => {
  let n = 0;
  const store = createFeaturedStore({ getText: async () => { n++; await new Promise((r) => setTimeout(r, 5)); return fixture("havoc-featured.json"); }, storage: null });
  const s = { uri: "https://havoc.app/" };
  await Promise.all([store.get(s), store.get(s), store.get(s)]);
  assert.equal(n, 1);
});
