// F302: the sideload build's APT sources are Tweak Sources: kept on the device (no apt), seeded with
// tweak-sources.json's "inject" repos, refreshed through the shell's net.packages and counted by injectable tweaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB as memoryIndexedDB } from "./fakes.test-helper.js";
import { createNativeBackend } from "./backend-native.js";
import { injectSourcesFrom, tweakSourcesFor, tweakSourcesOn, sourceFilter } from "./core/sources.js";


const PACKAGES = [
  "Package: com.x.yt\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDepends: mobilesubstrate\n",
  "Package: com.x.theme\nArchitecture: iphoneos-arm64\nSection: Themes\n",
  "Package: com.x.cli\nArchitecture: iphoneos-arm64\nSection: Terminal_Support\n",
  "Package: com.x.ig\nArchitecture: iphoneos-arm\nSection: Tweaks\n",
].join("\n");

function fakeNative() {
  const calls = [];
  return {
    calls,
    mode: "sideload",
    async call(method, params) {
      calls.push({ method, params });
      if (method === "apt.list") return null; // no apt in the sideload build
      if (method === "app.info") return {};
      if (method === "net.packages") return { text: PACKAGES, source: params.dir };
      if (method === "net.fetch") {
        if (/Release$/.test(params.url)) return { status: 404, headers: {}, body: "" };
        return { status: 404, headers: {}, body: "" };
      }
      if (method === "helper.run") throw Object.assign(new Error("helper: none"), { code: "helper" });
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("the sideload build keeps Tweak Sources, seeded from the inject defaults, counted by injectable tweaks", async () => {
  const native = fakeNative();
  const defaults = injectSourcesFrom([
    { name: "Havoc", uri: "https://havoc.app/", dist: "./", inject: true },
    { name: "Procursus", uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] },
  ]);
  assert.deepEqual(defaults.map((s) => s.name), ["Havoc"]);
  const backend = createNativeBackend({ native, sourceOptions: { mode: "sideload", indexedDB: memoryIndexedDB(), injectDefaults: defaults, altDefaults: [] } });
  const before = await backend.sources();
  assert.ok(before.some((s) => s.key === "deb:https://havoc.app/:./"), "an APT source is listed, not dropped");
  await backend.refreshSources(() => {}, { filter: sourceFilter("none", { tweaks: true }) ?? undefined });
  const havoc = (await backend.sources()).find((s) => s.key === "deb:https://havoc.app/:./");
  assert.equal(havoc.count, 2, "the theme and the CLI tool aren't counted");
  assert.ok(native.calls.some((c) => c.method === "net.packages"));
  assert.ok(!native.calls.some((c) => c.method === "helper.run" && c.params.words[0] === "update"), "no apt-get update");
});

test("Tweak Sources show only in the sideload app on a phone without a jailbreak", () => {
  const list = [{ key: "alt:https://a/" }, { key: "deb:https://havoc.app/:./" }];
  assert.equal(tweakSourcesOn("none", "sideload"), true);
  assert.equal(tweakSourcesOn("none", "site"), false);
  assert.equal(tweakSourcesOn("rootless", "sideload"), false);
  assert.deepEqual(tweakSourcesFor(list, "none", "sideload").map((s) => s.key), ["deb:https://havoc.app/:./"]);
  assert.deepEqual(tweakSourcesFor(list, "none", "site"), []);
  assert.equal(sourceFilter("none", { tweaks: true }), null);
  assert.equal(typeof sourceFilter("none"), "function");
});
