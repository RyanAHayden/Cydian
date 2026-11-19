// The build line under the version footer (Home and Settings' root): "Version 0.9.9 (1900) · 1a2b3c4", from the
// app's Info.plist (Bridge app.info) and build.json in the apps, from build.json alone on the website.
import { test } from "node:test";
import assert from "node:assert/strict";

// A small fake DOM: what version-foot.js draws, and what the modules it imports touch when they load.
globalThis.document ??= { createElement: (tag) => ({ tag, className: "", textContent: "" }), head: { append() {} },
  documentElement: { dataset: {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const { buildLine, versionLines } = await import("./version-foot.js");

test("buildLine: version, build number and short commit; missing parts are left out", () => {
  assert.equal(buildLine({ version: "0.9.9", build: "1900", commit: "1a2b3c4" }), "Version 0.9.9 (1900) · 1a2b3c4");
  assert.equal(buildLine({ version: "0.9.9", build: 1900, commit: "1a2b3c4d5e6f" }), "Version 0.9.9 (1900) · 1a2b3c4");
  assert.equal(buildLine({ version: "0.9.9", commit: "1a2b3c4" }), "Version 0.9.9 · 1a2b3c4");
  assert.equal(buildLine({ version: "0.9.9", build: "1900" }), "Version 0.9.9 (1900)");
  assert.equal(buildLine({ build: "1900", commit: "1a2b3c4" }), "Build 1900 · 1a2b3c4");
  assert.equal(buildLine({ commit: "1a2b3c4" }), "1a2b3c4");
  assert.equal(buildLine({ version: " ", build: null, commit: undefined }), "");
  assert.equal(buildLine(), "");
});

const settle = () => new Promise((r) => setTimeout(r, 0));

test("the website: the build line comes from build.json", async () => {
  const [foot, line] = versionLines({ native: null, ios: () => "26.1",
    info: async () => ({ version: "0.9.9", build: "1900", commit: "1a2b3c4" }) });
  await settle();
  assert.equal(line.className, "home-version home-commit");
  assert.equal(line.textContent, "Version 0.9.9 (1900) · 1a2b3c4");
  assert.match(foot.textContent, /iFizBox Web 0\.9\.9/);
});

test("the app: version and build from app.info (CFBundleVersion), the commit from the bundled build.json", async () => {
  const native = { call: async (m) => (m === "app.info" ? { version: "0.9.9", build: "1901", machine: "iPhone9,3", ios: "15.8.8" } : null) };
  const [foot, line] = versionLines({ native, ios: () => "15.8.8",
    info: async () => ({ version: "0.9.8", build: "1800", commit: "abcdef0" }) });
  await settle();
  assert.equal(line.textContent, "Version 0.9.9 (1901) · abcdef0");
  assert.match(foot.textContent, /^iPhone9,3, iOS 15\.8\.8, iFizBox 0\.9\.9 /);
});

test("the app: before app.info answers (or when it fails) the line still shows build.json's version and commit", async () => {
  const native = { call: () => Promise.reject(new Error("no bridge")) };
  const [, line] = versionLines({ native, ios: () => "", info: async () => ({ version: "0.9.9", build: "1900", commit: "abcdef0" }) });
  await settle();
  assert.equal(line.textContent, "Version 0.9.9 · abcdef0");
});

test("no build.json (a local checkout) on the website: the line stays empty and hidden", async () => {
  const [, line] = versionLines({ native: null, ios: () => "", info: async () => null });
  await settle();
  assert.equal(line.textContent, "");
});
