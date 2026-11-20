// F304: GitHub repos as sources: a repo page's releases become a Tweak Source (.deb/.dylib), an app source (.ipa only),
// or Add Source says it has neither, in those words.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  githubRepoPage, githubAccountPage, tagVersion, githubPackageId, githubAssets, githubPackagesText, githubToAlt,
  detectGithub, readGithubRepo, forgetGithubRepo, refreshGithubSource, githubApiRepo, NEITHER_MESSAGE, releasesApiUrl, repoApiUrl,
} from "./github.js";
import { parseControl } from "./apt.js";
import { injectableFromFields, countInjectable } from "./tweaks.js";
import { detectSource } from "./sources/add.js";
import { parseSource } from "./altstore.js";
import { githubRepo, sourceIcons, sourceSubtitle, displayName, refreshSource } from "./sources.js";
import { sourceLinks, addLink } from "./handoff.js";

const asset = (name, size = 1000) => ({ name, size, browser_download_url: `https://github.com/o/r/releases/download/x/${name}` });
const rel = (tag, assets, extra = {}) => ({ tag_name: tag, name: tag, html_url: `https://github.com/dayanch96/YTLite/releases/tag/${tag}`,
  published_at: "2026-11-01T00:00:00Z", body: "Fixes\n\n- one\n- two", assets, ...extra });
const INFO = { name: "YTLite", description: "A flexible enhancer for YouTube", owner: { login: "dayanch96" } };
const GH = { user: "dayanch96", repo: "YTLite" };

// A backend whose text() answers the GitHub API URLs from `repos` ({ "owner/repo": { info, releases } }).
function fakeBackend(repos) {
  const asked = [];
  return {
    asked,
    async text(url) {
      asked.push(url);
      const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?]+)(\/releases)?/.exec(url);
      const r = m && repos[`${m[1]}/${m[2]}`];
      if (!r) throw Object.assign(new Error("upstream answered HTTP 404"), { code: "upstream", status: 404 });
      return JSON.stringify(m[3] ? r.releases : r.info);
    },
    async fetch(url) { throw Object.assign(new Error(`not fetched: ${url}`), { code: "upstream", status: 404 }); },
    async packages() { throw Object.assign(new Error("no"), { code: "not_found" }); },
  };
}

test("githubRepoPage: a repo's page and its releases pages, never a file in it", () => {
  assert.deepEqual(githubRepoPage("https://github.com/dayanch96/YTLite"), GH);
  assert.deepEqual(githubRepoPage("github.com/arichornlover/uYouEnhanced"), { user: "arichornlover", repo: "uYouEnhanced" });
  assert.deepEqual(githubRepoPage("https://github.com/BandarHL/BHTwitter/releases"), { user: "BandarHL", repo: "BHTwitter" });
  assert.deepEqual(githubRepoPage("https://github.com/BandarHL/BHTwitter/releases/latest"), { user: "BandarHL", repo: "BHTwitter" });
  assert.deepEqual(githubRepoPage("https://github.com/a/b/releases/tag/v1.0"), { user: "a", repo: "b" });
  assert.deepEqual(githubRepoPage("https://www.github.com/a/b.git"), { user: "a", repo: "b" });
  assert.deepEqual(githubRepoPage("https://github.com/a/b/tree/main"), { user: "a", repo: "b" });
  assert.equal(githubRepoPage("https://github.com/a/b/raw/main/source.json"), null);
  assert.equal(githubRepoPage("https://github.com/a/b/releases/download/v1/source.json"), null);
  assert.equal(githubRepoPage("https://github.com/a/b/releases/latest/download/source.json"), null);
  assert.equal(githubRepoPage("https://github.com/a/b/blob/main/x.json"), null);
  assert.equal(githubRepoPage("https://raw.githubusercontent.com/a/b/main/x.json"), null);
  assert.equal(githubRepoPage("https://github.com/orgs/foo"), null);
  assert.equal(githubRepoPage("https://github.com/a"), null);
  assert.equal(githubRepoPage("https://evil.com/a/b"), null);
  assert.equal(githubAccountPage("https://github.com/dayanch96"), "dayanch96");
  assert.equal(githubAccountPage("https://github.com/dayanch96/YTLite"), null);
  assert.equal(githubAccountPage("https://github.com/settings"), null);
});

test("tags as versions, and the package id", () => {
  assert.equal(tagVersion("v5.2.1"), "5.2.1");
  assert.equal(tagVersion("5.0b2"), "5.0b2");
  assert.equal(tagVersion("release-3.1"), "3.1");
  assert.equal(tagVersion("nightly"), "0~nightly");
  assert.equal(tagVersion("v 2 (test)"), "2.test");
  assert.equal(githubPackageId(GH), "com.github.dayanch96.ytlite");
  assert.equal(githubPackageId({ user: "a", repo: "B_C.d" }), "com.github.a.b-c-d");
});

test("each release's tweak file is one version of one tweak: a rootless .deb first, a .dylib only when there's no .deb", () => {
  const releases = [
    rel("v5.2", [asset("YTLite_5.2_iphoneos-arm.deb"), asset("YTLite_5.2_iphoneos-arm64.deb"), asset("YouTube.ipa")]),
    rel("v5.1", [asset("YTLite.dylib")]),
    rel("v5.0", [asset("notes.txt")]),
    { ...rel("v4", [asset("Old.deb")]), draft: true }, // the worker drops drafts; the app does too
  ];
  const { tweaks, apps } = githubAssets(releases.filter((r) => !r.draft));
  assert.deepEqual(tweaks.map((t) => t.asset.name), ["YTLite_5.2_iphoneos-arm64.deb", "YTLite.dylib"]);
  assert.deepEqual(apps.map((a) => a.asset.name), ["YouTube.ipa"]);
  const text = githubPackagesText({ info: INFO, releases: releases.filter((r) => !r.draft) }, GH);
  const st = parseControl(text);
  assert.equal(st.length, 2);
  assert.deepEqual(st.map((s) => s.version), ["5.2", "5.1"]);
  for (const s of st) {
    assert.equal(s.package, "com.github.dayanch96.ytlite");
    assert.equal(s.name, "YTLite");
    assert.match(s.description, /^A flexible enhancer for YouTube/);
    assert.equal(s.icon, "https://github.com/dayanch96.png?size=120");
    assert.ok(injectableFromFields(s).ok, "the catalog's Tweak Source filter keeps it");
  }
  assert.equal(st[0].filename, "https://github.com/o/r/releases/download/x/YTLite_5.2_iphoneos-arm64.deb");
  assert.equal(st[0]["x-github-asset"], "deb");
  assert.equal(st[1]["x-github-asset"], "dylib");
  assert.equal(countInjectable(text), 1, "one tweak, two versions");
  assert.equal(githubPackagesText({ info: INFO, releases: [rel("v1", [asset("App.ipa")])] }, GH), "");
});

test("a repo with only .ipa files reads as an app source (format github)", () => {
  const releases = [rel("v20.1", [asset("uYouEnhanced_20.1.ipa", 123)]), rel("v20.0", [asset("uYouEnhanced_20.0.ipa")])];
  const alt = githubToAlt(releases);
  assert.equal(alt.name, "YTLite"); // from the releases' own URLs
  assert.equal(alt.apps.length, 1);
  assert.deepEqual(alt.apps[0].versions.map((v) => v.version), ["20.1", "20.0"]);
  const parsed = parseSource("github", JSON.stringify(releases));
  assert.equal(parsed.apps.length, 1);
  assert.equal(parsed.apps[0].versions[0].downloadURL, "https://github.com/o/r/releases/download/x/uYouEnhanced_20.1.ipa");
  assert.throws(() => parseSource("github", "{}"), /not a list of releases/);
});

test("Add Source of a GitHub repo: tweaks, apps, neither, missing, an account page", async () => {
  forgetGithubRepo();
  const backend = fakeBackend({
    "dayanch96/YTLite": { info: INFO, releases: [rel("v5.2", [asset("YTLite_5.2.deb")])] },
    "arichornlover/uYouEnhanced": { info: { name: "uYouEnhanced" }, releases: [rel("v20", [asset("uYouEnhanced.ipa")])] },
    "BandarHL/BHTwitter": { info: { name: "BHTwitter", description: "X tweak" }, releases: [rel("v4", [asset("BHTwitter.deb"), asset("BHX.ipa")])] },
    "a/empty": { info: { name: "empty" }, releases: [rel("v1", [asset("source.zip")])] },
  });
  const yt = await detectSource(backend, "https://github.com/dayanch96/YTLite");
  assert.equal(yt.kind, "github");
  assert.equal(yt.app, null);
  assert.equal(yt.source.key, "deb:https://github.com/dayanch96/YTLite/:./");
  assert.deepEqual(yt.source.github, GH);
  assert.equal(yt.source.name, "YTLite");
  assert.equal(yt.source.count, 1);
  assert.ok(!backend.asked.some((u) => /^https:\/\/github\.com/.test(u)), "the repo's web page is never fetched");

  const uy = await detectSource(backend, "github.com/arichornlover/uYouEnhanced/releases");
  assert.equal(uy.source, null);
  assert.equal(uy.app.format, "github");
  assert.equal(uy.app.uri, "https://api.github.com/repos/arichornlover/uYouEnhanced/releases?per_page=30");
  assert.equal(uy.app.count, 1);

  const bh = await detectSource(backend, "https://github.com/BandarHL/BHTwitter");
  assert.ok(bh.source && bh.app, "both: the caller picks (Tweak Source where kept)");

  await assert.rejects(detectSource(backend, "https://github.com/a/empty"), (e) => {
    assert.equal(e.title, "Did Not Find Source");
    assert.equal(e.message, NEITHER_MESSAGE({ user: "a", repo: "empty" }));
    assert.match(e.message, /has no tweaks \(\.deb or \.dylib files\) and no apps \(\.ipa files\)/);
    assert.doesNotMatch(e.message, /web page/);
    return true;
  });
  await assert.rejects(detectSource(backend, "https://github.com/a/missing"), /github\.com\/a\/missing was not found on GitHub/);
  await assert.rejects(detectSource(backend, "https://github.com/dayanch96"), /is a GitHub account, not a repository/);
});

test("GitHub's answers are kept ten minutes; Refresh asks again", async () => {
  forgetGithubRepo();
  const backend = fakeBackend({ "dayanch96/YTLite": { info: INFO, releases: [rel("v5.2", [asset("a.deb")])] } });
  await readGithubRepo(backend, GH, { now: 1000 });
  await readGithubRepo(backend, GH, { now: 2000 });
  assert.equal(backend.asked.length, 2, "one repo call and one releases call");
  assert.deepEqual(backend.asked, [repoApiUrl(GH), releasesApiUrl(GH)]);
  await readGithubRepo(backend, GH, { now: 1000 + 11 * 60 * 1000 });
  assert.equal(backend.asked.length, 4);
  const rec = { key: "deb:https://github.com/dayanch96/YTLite/:./", uri: "https://github.com/dayanch96/YTLite/", dist: "./", github: GH };
  const fields = await refreshSource(backend, rec, { count: async (t) => countInjectable(t) });
  assert.equal(fields.error, null);
  assert.equal(fields.count, 1);
  assert.equal(backend.asked.length, 6, "refresh is fresh");
  const gone = await refreshGithubSource(fakeBackend({}), rec);
  assert.match(gone.error, /404/);
});

test("rows: the repo's name, github.com/<owner>/<repo>, the owner's avatar, no other app's links", () => {
  const tweak = { key: "deb:https://github.com/dayanch96/YTLite/:./", uri: "https://github.com/dayanch96/YTLite/", dist: "./", github: GH, name: "YTLite" };
  assert.deepEqual(sourceIcons(tweak), ["https://github.com/dayanch96.png?size=120"]);
  assert.equal(sourceSubtitle(tweak), "github.com/dayanch96/YTLite");
  assert.equal(displayName(tweak), "YTLite");
  assert.deepEqual(sourceLinks(tweak), []);
  assert.equal(addLink(tweak, "https://x.test"), "https://x.test/add?url=https%3A%2F%2Fgithub.com%2Fdayanch96%2FYTLite");
  const app = { key: "alt:https://api.github.com/repos/a/b/releases?per_page=30", kind: "altstore", format: "github",
    uri: "https://api.github.com/repos/a/b/releases?per_page=30", name: null, iconURL: null };
  assert.deepEqual(githubApiRepo(app.uri), { user: "a", repo: "b" });
  assert.deepEqual(githubRepo(app.uri), { user: "a", repo: "b" });
  assert.equal(sourceSubtitle(app), "github.com/a/b");
  assert.equal(displayName(app), "a");
  assert.deepEqual(sourceIcons(app), ["https://github.com/a.png?size=120"]);
  assert.deepEqual(sourceLinks(app), []);
  assert.equal(addLink(app, "https://x.test"), "https://x.test/add?url=https%3A%2F%2Fgithub.com%2Fa%2Fb");
});
