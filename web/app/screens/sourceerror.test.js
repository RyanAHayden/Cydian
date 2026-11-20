// B177: a source whose refresh failed shows the whole error on its page, with Refresh, Edit, Copy, Share and Remove;
// a tap on its row on Sources opens that page (no more tap-to-retry that did nothing visible).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "../nav/fakedom.test-helper.js";

globalThis.document ??= fakeDocument();
const { sourceErrors, errorReport, sourceErrorGroup, setSourceErrorHooks } = await import("./sourceerror.js");

const BIGBOSS = { key: "deb:http://apt.thebigboss.org/repofiles/cydia/:stable", name: "BigBoss",
  uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"],
  error: "no Packages index in http://apt.thebigboss.org/repofiles/cydia/dists/stable/main/binary-iphoneos-arm/", updated: 1 };

const labels = (node) => {
  const out = [];
  const walk = (n) => { for (const c of n.children ?? []) { if (c.classList?.contains("cell-label")) out.push(c.textContent); walk(c); } };
  walk(node);
  return out;
};

test("every distinct error once, the live one first; a coded copy of the same text counts as the same", () => {
  assert.deepEqual(sourceErrors({ error: "x failed" }, { error: "x failed" }, "not_found: x failed"), ["not_found: x failed"]);
  assert.deepEqual(sourceErrors({ error: "a", aptError: "E: Failed to fetch b" }), ["a", "E: Failed to fetch b"]);
  assert.deepEqual(sourceErrors({ error: null }, null, null), []);
});

test("the report names the source, its URL with suite and components, and the whole error", () => {
  const r = errorReport(BIGBOSS, [BIGBOSS.error]);
  assert.match(r, /^BigBoss couldn't be refreshed\.\n/);
  assert.match(r, /http:\/\/apt\.thebigboss\.org\/repofiles\/cydia\/ stable main/);
  assert.ok(r.includes(BIGBOSS.error), "not cut short");
});

test("a failed source's page gets the error in full and every action; a healthy one gets nothing", () => {
  setSourceErrorHooks({ edit: async () => null, refresh: async () => true });
  const g = sourceErrorGroup(BIGBOSS);
  assert.ok(g, "drawn");
  assert.ok(g.textContent.includes(BIGBOSS.error), "the whole error is on the page");
  assert.ok(g.querySelector(".source-error-text"));
  assert.deepEqual(labels(g), ["Refresh Source", "Edit Source", "Copy Error", "Share Error", "Remove Source"]);
  assert.equal(sourceErrorGroup({ ...BIGBOSS, error: null }), null);
});

test("the live reason from this session's refresh shows even before the record is saved", () => {
  setSourceErrorHooks({ reason: (key) => (key === "k" ? "Not responding (no answer in 20 s)" : null) });
  const g = sourceErrorGroup({ key: "k", uri: "https://k.example/" });
  assert.ok(g.textContent.includes("Not responding (no answer in 20 s)"));
  setSourceErrorHooks({ reason: () => null });
});

test("Sources: a failed row opens its page (its chevron kept); the hold menu keeps Refresh", () => {
  const src = readFileSync(new URL("./sources.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /closest\("\.source-row\.is-failed"\)/, "no click interception for failed rows");
  assert.match(src, /label: "Refresh", onClick: \(\) => \{ if \(!state\.busy\) retrySource/);
  assert.match(src, /setSourceErrorHooks\(/);
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.source-row\.is-failed \.cell-inner\.chevron::after \{ display: none/);
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.match(browse, /sourceErrorGroup\(source, \{ status, ctx: page\.ctx/);
  const alt = readFileSync(new URL("./altstore.js", import.meta.url), "utf8");
  assert.match(alt, /sourceErrorGroup\(source, \{ status, ctx/);
});
