// N4: the install queue's model (core/queue.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue, modeOf, queueWords, parseSimulation, parseStatusLine, consoleText, finishOf, needsRestart,
  createRunLog, trimLog, runTitle, changeCount, queuedFor, LOG_KEY } from "./queue.js";

test("modeOf: install, reinstall, upgrade, downgrade, remove", () => {
  assert.equal(modeOf({ op: "install", version: "1.0" }), "install");
  assert.equal(modeOf({ op: "install", version: "1.0", installed: "1.0" }), "reinstall");
  assert.equal(modeOf({ op: "install", version: "1.1", installed: "1.0" }), "upgrade");
  assert.equal(modeOf({ op: "install", version: "1.0~b1", installed: "1.0" }), "downgrade");
  assert.equal(modeOf({ op: "install", installed: "1.0" }), "upgrade");
  assert.equal(modeOf({ op: "remove", installed: "1.0" }), "remove");
  assert.equal(queuedFor("downgrade"), "Queued for Downgrade");
});

test("a queue: one job per package, replaced when queued again, events for every change", () => {
  const q = createQueue();
  const seen = [];
  const off = q.subscribe((e) => seen.push(e.type));
  q.add({ op: "install", id: "a", version: "2", installed: "1" });
  q.add({ op: "install", id: "b", version: "1" });
  assert.equal(q.get("a").mode, "upgrade");
  q.add({ op: "remove", id: "a", installed: "1" });
  assert.deepEqual(q.list().map((j) => [j.id, j.mode, j.version]), [["a", "remove", null], ["b", "install", "1"]]);
  assert.equal(q.size, 2);
  q.name("b", "Bee");
  assert.equal(q.get("b").name, "Bee");
  q.clear("a");
  q.clear("nothing");
  assert.equal(q.get("a"), null);
  q.clearAll();
  q.clearAll();
  off();
  q.add({ op: "install", id: "c" });
  assert.deepEqual(seen, ["add", "add", "add", "name", "clear", "clearAll"]);
  assert.throws(() => q.add({ op: "purge", id: "x" }), /unknown queue op/);
  assert.throws(() => q.add({ op: "install" }), /no package id/);
});

test("a listener that throws doesn't stop the others", () => {
  const q = createQueue();
  let n = 0;
  q.subscribe(() => { throw new Error("bug"); });
  q.subscribe(() => n++);
  q.add({ op: "install", id: "a" });
  assert.equal(n, 1);
});

test("queueWords: the helper's items", () => {
  assert.deepEqual(queueWords([{ op: "install", id: "a", version: null }, { op: "install", id: "b", version: "1:2.0~b1" }, { op: "remove", id: "c" }]),
    ["a", "b=1:2.0~b1", "-c"]);
});

test("parseSimulation: apt-get -s's Inst/Remv lines become Cydia's five lists", () => {
  const plan = parseSimulation(`Reading package lists...
Building dependency tree...
NOTE: This is only a simulation!
      apt-get needs root privileges for real execution.
The following NEW packages will be installed:
  libnew
Need to get 1,024 kB/2,048 kB of archives.
Inst com.a.tweak [1.0] (1.1 Havoc:1.0/stable [iphoneos-arm64])
Inst libnew (2.0 Chariz:1.0 [iphoneos-arm64]) []
Inst com.b [1.0] (1.0 Havoc [iphoneos-arm64])
Inst com.c:iphoneos-arm64 [2.0] (1.0~b1 Havoc [iphoneos-arm64])
Remv com.d [3.0]
Purg com.e [1]
Conf com.a.tweak (1.1 Havoc:1.0/stable [iphoneos-arm64])
Conf libnew (2.0 Chariz:1.0 [iphoneos-arm64])`);
  assert.deepEqual(plan.upgrades, [{ id: "com.a.tweak", from: "1.0", to: "1.1" }]);
  assert.deepEqual(plan.installs, [{ id: "libnew", from: null, to: "2.0" }]);
  assert.deepEqual(plan.reinstalls, [{ id: "com.b", from: "1.0", to: "1.0" }]);
  assert.deepEqual(plan.downgrades, [{ id: "com.c", from: "2.0", to: "1.0~b1" }]);
  assert.deepEqual(plan.removes.map((r) => r.id), ["com.d", "com.e"]);
  assert.deepEqual(plan.essential, []);
  assert.equal(plan.download, "2,048 kB");
  assert.equal(changeCount(plan), 6);
});

test("parseSimulation: essential packages and the iOS stand-ins are issues", () => {
  const plan = parseSimulation(`WARNING: The following essential packages will be removed.
This should NOT be done unless you know exactly what you are doing!
  apt dpkg
Remv apt [2.6.0]
Remv firmware [16.0]
Remv cy+cpu.arm64 [1]`);
  assert.deepEqual(plan.essential, ["apt", "dpkg", "firmware", "cy+cpu.arm64"]);
  const warned = parseSimulation(`WARNING: The following essential packages will be removed.
This should NOT be done unless you know exactly what you are doing!
  apt dpkg (due to apt)
Remv apt [2.6.0]`);
  assert.deepEqual(warned.essential, ["apt", "dpkg"]);
});

test("parseStatusLine: apt's status fd, dpkg's lines and Cydia's finish words", () => {
  assert.deepEqual(parseStatusLine("pmstatus:com.a:42.5:Installing com.a"), { type: "status", pkg: "com.a", percent: 42.5, text: "Installing com.a" });
  assert.deepEqual(parseStatusLine("dlstatus:1:20:Retrieving file 1 of 3"), { type: "status", pkg: "1", percent: 20, text: "Retrieving file 1 of 3", download: true });
  assert.deepEqual(parseStatusLine("pmerror:com.a:60:subprocess failed: a: b"), { type: "error", pkg: "com.a", percent: 60, text: "subprocess failed: a: b" });
  assert.equal(parseStatusLine("pmconffile:/etc/x:50:'/etc/x' '/etc/x.dpkg-new' 1 1").type, "conffile");
  assert.deepEqual(parseStatusLine("finish:restart"), { type: "finish", finish: "restart" });
  assert.equal(parseStatusLine("finish:explode").type, "info");
  assert.deepEqual(parseStatusLine("status: com.a: half-configured"), { type: "status", pkg: "com.a", text: "com.a: half-configured" });
  assert.equal(parseStatusLine("status: /etc/x : conffile-prompt : 'a' 'b' 0 1").type, "conffile");
  assert.deepEqual(parseStatusLine("processing: configure: com.a"), { type: "status", pkg: "com.a", text: "configure com.a" });
  assert.deepEqual(parseStatusLine("pmstatus:x:250:over"), { type: "status", pkg: "x", percent: 100, text: "over" });
  assert.deepEqual(parseStatusLine("something else"), { type: "info", text: "something else" });
});

test("consoleText keeps what follows the last carriage return; finishOf the highest level", () => {
  assert.equal(consoleText("10%\r20%\r30% done"), "30% done");
  assert.equal(consoleText("line\r"), "line");
  assert.equal(finishOf(), "return");
  assert.equal(finishOf("return", "restart", "reopen"), "restart");
  assert.equal(finishOf("reboot", "restart"), "reboot");
  assert.equal(finishOf("nonsense"), "return");
});

test("needsRestart: a package (or its other version) depending on mobilesubstrate, as Cydia decides", () => {
  assert.equal(needsRestart([{ package: "a", depends: "firmware (>= 15.0), mobilesubstrate (>= 0.9)" }]), true);
  assert.equal(needsRestart([{ package: "a", depends: "ellekit | com.ex.substitute" }]), true);
  assert.equal(needsRestart([{ package: "a", "pre-depends": "mobilesubstrate" }]), true);
  assert.equal(needsRestart([null, { package: "a", depends: "bash" }]), false);
  assert.equal(needsRestart([{ package: "mobilesubstrate" }]), true);
  assert.equal(needsRestart([]), false);
});

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("the run log keeps the newest runs, trimmed, and survives a reload of the same storage", () => {
  const st = memStorage();
  let t = 1000;
  const log = createRunLog(st, { max: 3, chars: 100, now: () => t++ });
  for (let i = 0; i < 5; i++) log.add({ title: `run ${i}`, jobs: [], code: i === 4 ? 100 : 0, text: `out ${i}` });
  const again = createRunLog(st);
  const list = again.list();
  assert.deepEqual(list.map((e) => e.title), ["run 4", "run 3", "run 2"]);
  assert.equal(list[0].ok, false);
  assert.equal(list[1].ok, true);
  assert.equal(again.get(list[0].id).text, "out 4");
  const long = log.add({ title: "long", code: 0, text: Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") });
  assert.ok(long.text.length < 140 && /lines left out/.test(long.text) && long.text.startsWith("line 0") && long.text.endsWith("line 499"));
  log.clear();
  assert.deepEqual(createRunLog(st).list(), []);
  assert.equal(st.m.has(LOG_KEY), false);
});

test("the run log without storage, or with a full one, still works for the session", () => {
  const log = createRunLog(null);
  log.add({ title: "a", code: 0, text: "x" });
  assert.equal(log.list().length, 1);
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  const l2 = createRunLog(full);
  l2.add({ title: "b", code: 0, text: "y" });
  assert.equal(l2.list()[0].title, "b");
  assert.equal(trimLog("short", 10), "short");
});

test("runTitle names the jobs", () => {
  assert.equal(runTitle([{ op: "install", mode: "install", id: "a", name: "Alpha" }, { op: "remove", mode: "remove", id: "b" }]), "Install Alpha, Remove b");
  assert.equal(runTitle([1, 2, 3, 4].map((i) => ({ mode: "install", id: `p${i}` }))), "Install p1, Install p2 and 2 more");
});
