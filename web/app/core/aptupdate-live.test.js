// F233: apt-get update's lines, fed one at a time as the helper streams them, drive the Sources rows: a row spins at
// apt's first line naming its source and goes red at its Err (with the reason from the indented line after it), or at
// stderr's "E: Failed to fetch". The fixture is the iPhone 7's real update (fixtures/apt-update-525.*, as B23's test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveUpdate } from "./aptupdate.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const SOURCES = [
  { key: "dead", uri: "https://dead.example/repo/", dist: "./" },
  { key: "mineek", uri: "https://mineek.github.io/tweaks/", dist: "./" },
  { key: "kitty", uri: "https://kittymaxine.com/repo/", dist: "./" },
  { key: "bigboss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] },
  { key: "palera", uri: "https://repo.palera.in/", dist: "./" },
];

function run(sources, events) {
  const seen = [];
  const live = liveUpdate(sources, (key, state, reason) => seen.push(reason ? [key, state, reason] : [key, state]));
  for (const ev of events) live.feed(ev);
  live.end();
  return { seen, live };
}

const out = (text) => text.split(/\r?\n/).filter(Boolean).map((line) => ({ fd: "out", line }));
const err = (text) => text.split(/\r?\n/).filter(Boolean).map((line) => ({ fd: "err", line }));

test("F233: the iPhone 7's update, line by line: the 525 source goes red, the rest only spin", () => {
  const { seen, live } = run(SOURCES, [...out(fx("apt-update-525.stdout")), ...err(fx("apt-update-525.stderr"))]);
  const failed = seen.filter((e) => e[1] === "failed");
  assert.deepEqual(failed.map((e) => e[0]), ["dead"]);
  assert.equal(failed[0][2], "apt-get update couldn't fetch Packages (525)");
  // every source apt named spun first, once; mineek's Translation-en 404 never turns it red
  for (const s of SOURCES) {
    const mine = seen.filter((e) => e[0] === s.key);
    if (!mine.length) continue;
    assert.deepEqual(mine[0], [s.key, "loading"], s.key);
    assert.equal(mine.filter((e) => e[1] === "loading").length, 1, s.key);
  }
  assert.equal(live.states.get("mineek"), "loading");
  assert.equal(live.states.get("dead"), "failed");
});

test("F233: each line maps to its source by URI and suite as it comes", () => {
  const events = out([
    "Hit:1 https://ok.test ./ InRelease",
    "Get:2 https://flat.test/sub ./ Release [1234 B]",
    "Err:3 https://flat.test/sub ./ Packages",
    "  404  Not Found [IP: 192.0.2.1 443]",
    "Ign:4 https://ok.test ./ Translation-en",
    "Err:5 https://ok.test ./ Translation-en",
    "  404  Not Found",
    "Get:6 https://apt.procurs.us 1800 InRelease [12 kB]",
    "Hit:7 https://elsewhere.test ./ InRelease",
    "Reading package lists...",
  ].join("\n"));
  const sources = [
    { key: "ok", uri: "https://ok.test/", dist: "./" },
    { key: "flat", uri: "https://flat.test/sub/", dist: "./" },
    { key: "procursus", uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] },
    { key: "idle", uri: "https://idle.test/", dist: "./" },
  ];
  const { seen } = run(sources, events);
  assert.deepEqual(seen, [
    ["ok", "loading"],
    ["flat", "loading"],
    ["flat", "failed", "apt-get update couldn't fetch Packages (404 Not Found)"],
    ["procursus", "loading"],
  ]);
});

test("F233: an Err line's reason may be the next line, or there may be none; nothing comes back from red", () => {
  const sources = [{ key: "a", uri: "https://a.test/", dist: "./" }, { key: "b", uri: "https://b.test/", dist: "./" }];
  // no reason line: the next Get flushes it without one
  let r = run(sources, out("Err:1 https://a.test ./ InRelease\nGet:2 https://b.test ./ InRelease"));
  assert.deepEqual(r.seen, [["a", "loading"], ["a", "failed", "apt-get update couldn't fetch InRelease"], ["b", "loading"]]);
  // the last line of the run: end() flushes it
  r = run(sources, out("Err:1 https://a.test ./ InRelease"));
  assert.deepEqual(r.seen.at(-1), ["a", "failed", "apt-get update couldn't fetch InRelease"]);
  // a Hit after the Err (another of its files) doesn't turn it back
  r = run(sources, out("Err:1 https://a.test ./ Packages\n  Could not resolve 'a.test'\nHit:2 https://a.test ./ InRelease"));
  assert.deepEqual(r.seen, [["a", "loading"], ["a", "failed", "apt-get update couldn't fetch Packages (Could not resolve 'a.test')"]]);
});

test("F233: stderr's Failed to fetch and The repository lines turn their sources red; warnings and status lines don't", () => {
  const sources = [
    { key: "dist", uri: "https://d.test/deb/", dist: "stable", components: ["main"] },
    { key: "flat", uri: "https://f.test/", dist: "./" },
    { key: "other", uri: "https://o.test/", dist: "./" },
  ];
  const { seen } = run(sources, [
    { fd: "status", line: "dlstatus:1:10:Retrieving file 1 of 3" },
    ...err([
      "W: The repository 'https://o.test ./ Release' is not signed.",
      "E: Failed to fetch https://d.test/deb/dists/stable/main/binary-iphoneos-arm64/Packages  404  Not Found [IP: 192.0.2.9 443]",
      "E: Failed to fetch https://o.test/./Translation-en  404  Not Found",
      "E: The repository 'https://f.test ./ Release' does not have a Release file.",
      "E: Some index files failed to download. They have been ignored, or old ones used instead.",
    ].join("\n")),
  ]);
  assert.deepEqual(seen, [
    ["dist", "failed", "apt-get update couldn't fetch Packages (404 Not Found)"],
    ["flat", "failed", "apt-get update: does not have a Release file"],
  ]);
});

test("F233: lines for sources outside the list (a filtered refresh) change nothing", () => {
  const { seen } = run([{ key: "a", uri: "https://a.test/", dist: "./" }],
    out("Err:1 https://b.test ./ Packages\n  404  Not Found\nHit:2 https://a.test ./ InRelease"));
  assert.deepEqual(seen, [["a", "loading"]]);
  assert.deepEqual(run([], out("Hit:1 https://a.test ./ InRelease")).seen, []);
});
