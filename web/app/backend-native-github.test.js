// F304: Add Source of a GitHub repo in the app: the sideload build keeps one with tweaks as a Tweak Source (refreshed
// through its releases, counted by its tweak); a jailbreak build or one with only .ipa files gets an app source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB as memoryIndexedDB } from "./fakes.test-helper.js";
import { createNativeBackend } from "./backend-native.js";
import { sourceFilter, tweakSourcesFor } from "./core/sources.js";
import { forgetGithubRepo } from "./core/github.js";


const dl = (repo, name) => ({ name, size: 10, browser_download_url: `https://github.com/${repo}/releases/download/v1/${name}` });
const REPOS = {
  "BandarHL/BHTwitter": {
    info: { name: "BHTwitter", description: "Awesome tweak for X" },
    releases: [
      { tag_name: "v4.3", html_url: "https://github.com/BandarHL/BHTwitter/releases/tag/v4.3", assets: [dl("BandarHL/BHTwitter", "BHTwitter_rootless.deb"), dl("BandarHL/BHTwitter", "BHTwitter.ipa")] },
      { tag_name: "v4.2", html_url: "https://github.com/BandarHL/BHTwitter/releases/tag/v4.2", assets: [dl("BandarHL/BHTwitter", "BHTwitter.deb")] },
    ],
  },
  "arichornlover/uYouEnhanced": {
    info: { name: "uYouEnhanced" },
    releases: [{ tag_name: "v20.0", html_url: "https://github.com/arichornlover/uYouEnhanced/releases/tag/v20.0", assets: [dl("arichornlover/uYouEnhanced", "uYouEnhanced.ipa")] }],
  },
};

function fakeNative(mode) {
  const calls = [];
  const json = (v) => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(v)).toString("base64") });
  return {
    calls,
    mode,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "apt.list") return null;
      if (method === "app.info") return {};
      if (method === "apt.sources") return [];
      if (method === "net.fetch") {
        const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?]+)(\/releases)?/.exec(params.url);
        const r = m && REPOS[`${m[1]}/${m[2]}`];
        if (r) return json(m[3] ? r.releases : r.info);
        return { status: 404, headers: {}, body: "" };
      }
      if (method === "helper.run") return { code: 0, stdout: "", stderr: "" };
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("the sideload app keeps a GitHub repo with tweaks as a Tweak Source, and Refresh reads its releases", async () => {
  forgetGithubRepo();
  const native = fakeNative("sideload");
  const backend = createNativeBackend({ native, sourceOptions: { mode: "sideload", indexedDB: memoryIndexedDB(), injectDefaults: [], altDefaults: [] } });
  const added = await backend.addSource("https://github.com/BandarHL/BHTwitter");
  assert.equal(added.key, "deb:https://github.com/BandarHL/BHTwitter/:./");
  assert.equal(added.name, "BHTwitter");
  assert.equal(added.count, 1);
  const list = await backend.sources();
  assert.deepEqual(tweakSourcesFor(list, "none", "sideload").map((s) => s.key), [added.key], "in the Tweak Sources group");
  assert.ok(!native.calls.some((c) => c.method === "net.fetch" && /^https:\/\/github\.com\/BandarHL\/BHTwitter\/?$/.test(c.params.url)));
  const before = native.calls.length;
  await backend.refreshSources(() => {}, { filter: sourceFilter("none", { tweaks: true }) ?? undefined });
  const after = native.calls.slice(before).filter((c) => c.method === "net.fetch").map((c) => c.params.url);
  assert.ok(after.some((u) => u.includes("/repos/BandarHL/BHTwitter/releases")), "refreshed through the releases API");
  assert.ok(!native.calls.some((c) => c.method === "net.packages"), "no Packages asked of github.com");
  const again = (await backend.sources()).find((s) => s.key === added.key);
  assert.equal(again.error, null);
  assert.equal(again.count, 1);

  // A repo with only .ipa files: an app source, even here.
  const app = await backend.addSource("github.com/arichornlover/uYouEnhanced");
  assert.equal(app.format, "github");
  assert.match(app.key, /^alt:https:\/\/api\.github\.com\/repos\/arichornlover\/uYouEnhanced\/releases/);
});

test("a jailbreak build takes a GitHub repo's apps, and says why it can't take tweaks alone", async () => {
  forgetGithubRepo();
  const native = fakeNative("jailbreak");
  const backend = createNativeBackend({ native, sourceOptions: { mode: "jailbreak", indexedDB: memoryIndexedDB(), altDefaults: [] } });
  const app = await backend.addSource("https://github.com/BandarHL/BHTwitter");
  assert.equal(app.format, "github", "tweaks and an .ipa: the app source");
  REPOS["a/tweakonly"] = { info: { name: "t" }, releases: [{ tag_name: "1", html_url: "https://github.com/a/tweakonly/releases/tag/1", assets: [dl("a/tweakonly", "t.deb")] }] };
  await assert.rejects(backend.addSource("https://github.com/a/tweakonly"), /has tweaks \(\.deb files\) in its GitHub releases but no apps/);
  assert.ok(!native.calls.some((c) => c.method === "helper.run" && /github/.test(JSON.stringify(c.params))), "nothing written into apt's sources");
});
