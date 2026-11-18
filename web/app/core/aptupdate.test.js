// B23: which sources apt-get update failed on, from its own output. The fixture is the iPhone 7's real update of
// 2026-11-18 (fixtures/apt-update-525.*): the old https://cydian.dev/repo answering 525, with mineek's Translation-en
// 404 (Err, then Ign: apt gave up on it) and the usual unsigned-repo warnings beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { updateFailures, failureFor, failedBanner } from "./aptupdate.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const STDOUT = fx("apt-update-525.stdout");
const STDERR = fx("apt-update-525.stderr");

test("B23: the iPhone 7's update names only the 525 source, not the warnings or an ignored Translation-en", () => {
  const f = updateFailures(STDOUT, STDERR);
  assert.ok(f.length >= 1);
  for (const x of f) assert.match(x.uri, /^https:\/\/cydian\.dev\/repo/, JSON.stringify(x));
  assert.equal(f[0].message, "apt-get update couldn't fetch Packages (525)");
  const sources = [
    { uri: "https://cydian.dev/repo/", dist: "./" },
    { uri: "https://mineek.github.io/tweaks/", dist: "./" },
    { uri: "https://kittymaxine.com/repo/", dist: "./" },
    { uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] },
    { uri: "https://repo.palera.in/", dist: "./" },
  ];
  assert.deepEqual(sources.map((s) => Boolean(failureFor(s, f))), [true, false, false, false, false]);
  assert.deepEqual(updateFailures(STDOUT.replace(/^Err:21[^\n]*\n[^\n]*\n/m, ""), ""), [], "no Err left, no E: lines: nothing failed");
});

test("B23: Err lines and E: lines map to sources by URI and suite", () => {
  const out = [
    "Hit:1 https://ok.test ./ InRelease",
    "Err:2 https://apt.procurs.us 1800 InRelease",
    "  Could not resolve 'apt.procurs.us'",
    "Err:3 https://flat.test/sub ./ Packages",
    "  404  Not Found [IP: 192.0.2.1 443]",
    "Err:4 https://ok.test ./ Translation-en",
    "  404  Not Found",
  ].join("\n");
  const err = [
    "W: The repository 'https://ok.test ./ Release' is not signed.",
    "W: GPG error: https://ok.test ./ InRelease: NO_PUBKEY 1234",
    "E: The repository 'https://norelease.test ./ Release' does not have a Release file.",
    "W: Failed to fetch http://old.test/dists/stable/main/binary-iphoneos-arm/Packages  Connection failed",
    "E: Some index files failed to download. They have been ignored, or old ones used instead.",
  ].join("\n");
  const f = updateFailures(out, err);
  const of = (s) => failureFor(s, f)?.message ?? null;
  assert.equal(of({ uri: "https://apt.procurs.us/", dist: "1800" }), "apt-get update couldn't fetch InRelease (Could not resolve 'apt.procurs.us')");
  assert.equal(of({ uri: "https://APT.procurs.us", dist: "1800" }), of({ uri: "https://apt.procurs.us/", dist: "1800" }), "host case, trailing slash");
  assert.equal(of({ uri: "https://apt.procurs.us/", dist: "1900" }), null, "another suite of the same repo");
  assert.equal(of({ uri: "https://flat.test/sub/", dist: "./" }), "apt-get update couldn't fetch Packages (404 Not Found)");
  assert.equal(of({ uri: "https://flat.test/", dist: "./" }), null, "a repo above it isn't named by an Err line");
  assert.equal(of({ uri: "https://flat.test/subway/", dist: "./" }), null);
  assert.equal(of({ uri: "https://ok.test/", dist: "./" }), null, "unsigned and an optional Translation-en: fine");
  assert.equal(of({ uri: "https://norelease.test/", dist: "./" }), "apt-get update: does not have a Release file");
  assert.equal(of({ uri: "http://old.test/", dist: "stable" }), "apt-get update couldn't fetch Packages (Connection failed)");
  assert.equal(of({ uri: "http://old.test/", dist: "unstable" }), null, "a URL under another suite");
  assert.equal(failureFor({ uri: "https://x.test/" }, null), null);
  assert.deepEqual(updateFailures(undefined, undefined), []);
});

test("B23: the banner names the failed sources and opens Sources", () => {
  assert.equal(failedBanner([]), null);
  assert.equal(failedBanner(undefined), null);
  assert.deepEqual(failedBanner([{ name: null, uri: "https://cydian.dev/repo/" }]),
    { title: "Source Failed to Refresh", message: "cydian.dev/repo: tap to see Sources." });
  assert.equal(failedBanner([{ name: "A" }, { name: "B" }]).message, "A and B: tap to see Sources.");
  assert.equal(failedBanner([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]).message, "A, B and 2 more: tap to see Sources.");
  assert.equal(failedBanner([{ name: "A" }, { name: "B" }]).title, "Sources Failed to Refresh");
});

test("B23: the built-ins wrapper (backend.js) passes `failed` on, the built-in by its name", async () => {
  const { withBuiltins } = await import("./essential.js");
  const { NAME } = await import("../brand.js");
  const B = { key: "deb:https://self.test/repo/:./", uri: "https://self.test/repo/", name: NAME, builtin: true };
  const calls = {
    sources: async () => [B],
    addSource: async () => B,
    removeSource: async () => {},
    refreshSources: async () => Object.assign([{ key: B.key }], {
      failed: [{ key: B.key, uri: B.uri, name: null, message: "m" }, { key: null, uri: "https://x.test/", name: null, message: "n" }],
    }),
  };
  const out = await withBuiltins(calls, [B]).refreshSources();
  assert.equal(out[0].builtin, true);
  assert.deepEqual(out.failed.map((f) => f.name), [NAME, null]);
  assert.equal(failedBanner(out.failed).message, `${NAME} and x.test: tap to see Sources.`);
});
