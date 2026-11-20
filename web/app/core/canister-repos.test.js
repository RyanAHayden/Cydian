// F305: Canister's repository index (Find More Sources), its trust label and the per-repo cache. Fixtures fetched live
// from api.canister.me on 2026-11-20 (fixtures/f305).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  repoSearchUrl, rankingUrl, repoUrl, repoPackagesUrl, repoFrom, mapRepos, popularRepos, canisterSafe, repoLabel, repoMatch,
  trustQuery, mapResults, mapRepoPackages, injectableWith, loadInjectable, createRepoCache, createCanister, CANISTER_SAFE_LABEL,
  REPO_TTL,
} from "./canister.js";
import { injectableFromFields } from "./tweaks.js";
import { sourceWarning } from "./warnings.js";
import { PIRACY_HOSTS } from "./piracy-list.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/f305/${n}.json`, import.meta.url), "utf8"));
const rank1 = fx("ranking-1"), rank2 = fx("ranking-2"), procursus = fx("search-procursus"), dislike = fx("package-dislike");
const blocked = (u) => Boolean(sourceWarning(u));

test("repository URLs", () => {
  assert.equal(repoSearchUrl("chariz"), "https://api.canister.me/v2/jailbreak/repository/search?q=chariz&limit=50");
  assert.equal(repoSearchUrl("c"), null);
  assert.equal(rankingUrl(1), "https://api.canister.me/v2/jailbreak/repository/ranking?rank=1");
  assert.equal(rankingUrl(0), null);
  assert.equal(rankingUrl(9), null);
  assert.equal(repoUrl("chariz"), "https://api.canister.me/v2/jailbreak/repository/chariz");
  assert.equal(repoUrl("../x"), null);
  assert.equal(repoPackagesUrl("havoc"), "https://api.canister.me/v2/jailbreak/repository/havoc/packages");
});

test("a repo row carries its count, tier, bootstrap and the HTTPS / signed facts", () => {
  const chariz = mapRepos(rank1).find((r) => r.slug === "chariz");
  assert.equal(chariz.name, "Chariz");
  assert.equal(chariz.uri, "https://repo.chariz.com/");
  assert.equal(chariz.key, "deb:https://repo.chariz.com/:./");
  assert.equal(chariz.tier, 1, "the ranking's quality is the tier");
  assert.equal(chariz.https, true);
  assert.equal(chariz.gpg, true);
  assert.ok(chariz.count > 100);
  const bb = mapRepos(rank2).find((r) => r.slug === "bigboss");
  assert.equal(bb.https, false, "BigBoss is served over http");
  assert.equal(bb.flat, false);
  assert.equal(bb.tier, 2);
  assert.equal(repoFrom({ uri: "https://x.example/", visible: false }), null, "hidden repos are left out");
  assert.equal(repoFrom({ uri: "file:///x" }), null);
});

test("Popular: tiers 1 and 2, empty repos out, most packages first, added ones marked", () => {
  const list = popularRepos([rank1, rank2], { have: ["https://havoc.app"] });
  assert.ok(list.length >= 10);
  assert.ok(list.every((r) => r.count > 0));
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].count >= list[i].count);
  assert.equal(list.find((r) => r.slug === "havoc").added, true);
  assert.equal(list.find((r) => r.slug === "chariz").added, false);
  assert.ok(!list.some((r) => r.slug === "zebra"), "Zebra's repo has 0 packages");
});

test("piracy-listed repos are never offered", () => {
  const host = PIRACY_HOSTS[0];
  const json = { data: [{ id: "bad", slug: "bad", uri: `https://${host}/`, name: "Bad", package_count: 9, quality: 1 },
    { id: "ok", slug: "ok", uri: "https://ok.example/", name: "OK", package_count: 3, quality: 3 }] };
  assert.deepEqual(mapRepos(json, { blocked }).map((r) => r.slug), ["ok"]);
  assert.equal(repoLabel({ uri: `https://${host}/`, tier: 1 }, { blocked }).kind, "blocked");
});

test("tier 1 or bootstrap is Known Safe · Canister, with the reason; others stay Unknown", () => {
  const procs = repoMatch(procursus, "https://apt.procurs.us/");
  assert.equal(procs.tier, 1, "of Procursus' two entries the safest is kept");
  assert.equal(canisterSafe(procs).safe, true);
  const ellekit = mapRepos(rank2).find((r) => r.slug === "ellekit");
  assert.equal(ellekit.bootstrap, true);
  assert.deepEqual(repoLabel(ellekit), { kind: "canister", label: CANISTER_SAFE_LABEL, why: canisterSafe(ellekit).why });
  assert.match(canisterSafe(ellekit).why, /bootstrap/);
  assert.match(canisterSafe({ tier: 1 }).why, /Tier 1/);
  const poom = mapRepos(rank2).find((r) => r.slug === "poomsmart");
  assert.equal(repoLabel(poom).kind, "unknown");
  assert.match(repoLabel(poom).why, /Tier 2/);
});

test("our own lists win: known-safe first, then Canister, then the user's Trusted", () => {
  const bb = mapRepos(rank2).find((r) => r.slug === "bigboss");
  const safe = (u) => (/thebigboss/.test(u) ? { reason: "The oldest tweak repo." } : null);
  assert.deepEqual(repoLabel(bb, { safe }), { kind: "safe", label: "Known Safe", why: "The oldest tweak repo." });
  const chariz = { uri: "https://repo.chariz.com/", tier: 1 };
  assert.equal(repoLabel(chariz, { trusted: () => true }).kind, "canister");
  assert.equal(repoLabel({ uri: "https://x.example/", tier: 3 }, { trusted: () => true }).kind, "trusted");
});

test("a repo is looked up by its host", () => {
  assert.equal(trustQuery("https://www.Repo.Chariz.com/x/"), "repo.chariz.com");
  assert.equal(trustQuery("nope"), null);
  assert.equal(repoMatch(procursus, "https://example.com/"), null);
});

test("package results keep tags and their repo's tier; the injectable filter runs on Architecture, Section, tags", async () => {
  const rows = mapResults(dislike, { have: [] });
  const ryd = rows.find((r) => r.id === "weeb.lillie.youtubedislikesreturn" && /chariz/.test(r.repo.uri));
  assert.equal(ryd.repo.tier, 1);
  assert.equal(injectableWith(injectableFromFields, ryd).ok, true);
  assert.equal(injectableWith(injectableFromFields, { ...ryd, section: "Themes" }).ok, false);
  assert.equal(injectableWith(injectableFromFields, { ...ryd, arch: "iphoneos-arm64e-macos" }).ok, false);
  assert.equal(injectableWith(injectableFromFields, { ...ryd, tag: "purpose::console" }).ok, false);
  const check = await loadInjectable();
  assert.equal(check(ryd).ok, true);
});

test("a repo's package list maps to rows of that repo, one per package", () => {
  const repo = mapRepos(rank1).find((r) => r.slug === "chariz");
  const json = { data: [
    { package_id: "com.a.tweak", name: "A", version: "1.0", architecture: "iphoneos-arm", section: "Tweaks", latest_version: false, repository_id: "chariz" },
    { package_id: "com.a.tweak", name: "A", version: "1.1", architecture: "iphoneos-arm64", section: "Tweaks", latest_version: true, repository_id: "chariz" },
    { package_id: "com.b.theme", name: "B", version: "2", architecture: "iphoneos-arm64", section: "Themes", repository_id: "chariz" },
  ] };
  const rows = mapRepoPackages(json, repo);
  assert.deepEqual(rows.map((r) => `${r.id}@${r.version}`), ["com.a.tweak@1.1", "com.b.theme@2"]);
  assert.equal(rows[0].repo.uri, "https://repo.chariz.com/");
  assert.equal(rows[0].repo.tier, 1);
  assert.deepEqual(mapRepoPackages(json, null), []);
});

test("the repo cache keeps facts a week and a miss a day, in storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let t = 1000;
  const c = createRepoCache({ storage, now: () => t });
  assert.equal(c.get("https://repo.chariz.com"), undefined);
  c.put("https://repo.chariz.com/", { slug: "chariz", tier: 1, bootstrap: false, https: true, gpg: true, junk: "x" });
  c.put("https://nobody.example/", null);
  const again = createRepoCache({ storage, now: () => t });
  assert.deepEqual(again.get("http://repo.chariz.com"), { slug: "chariz", name: null, uri: null, tier: 1, bootstrap: false, https: true, gpg: true, count: null });
  assert.equal(again.get("https://nobody.example"), null);
  t += 2 * 24 * 3600 * 1000;
  assert.equal(again.get("https://nobody.example"), undefined, "a miss is asked again after a day");
  assert.ok(again.get("https://repo.chariz.com"));
  t += REPO_TTL;
  assert.equal(again.get("https://repo.chariz.com"), undefined);
  const broken = createRepoCache({ storage: { getItem: () => "{bad", setItem: () => { throw new Error("full"); } } });
  broken.put("https://a.example/", { tier: 1 });
  assert.equal(broken.get("https://a.example/").tier, 1, "kept for the session when storage refuses");
});

test("createCanister asks the repository endpoints once per URL", async () => {
  const asked = [];
  const c = createCanister({ getJson: async (u) => { asked.push(u); return { data: [] }; } });
  await Promise.all([c.repos("chariz"), c.repos("chariz"), c.ranking(1), c.repo("havoc"), c.packages("havoc")]);
  assert.equal(asked.length, 4);
  assert.equal(await c.repos("x"), null, "one character asks nothing");
});
