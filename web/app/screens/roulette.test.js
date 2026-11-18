// F154: Tweak Roulette's day streak (counted across days, no spin limit), the wheels' landing, and Browse's row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSpins, saveSpins, recordSpin, currentStreak, nextPos, rouletteRow, rouletteTitle, ROULETTE_KEY, ROULETTE_SUBTITLE } from "./roulette.js";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test("streak: the first spin starts it, one a day grows it, a missed day starts it over", () => {
  let s = readSpins(memStorage());
  assert.deepEqual(s, { last: null, streak: 0, best: 0, spins: 0 });
  s = recordSpin(s, "2026-11-16");
  assert.equal(s.streak, 1);
  s = recordSpin(s, "2026-11-16");
  s = recordSpin(s, "2026-11-16");
  assert.equal(s.streak, 1, "more spins the same day don't count twice");
  assert.equal(s.spins, 3);
  s = recordSpin(s, "2026-11-17");
  s = recordSpin(s, "2026-11-18");
  assert.equal(s.streak, 3);
  assert.equal(currentStreak(s, "2026-11-18"), 3);
  assert.equal(currentStreak(s, "2026-11-19"), 3, "still alive the next day, before its spin");
  assert.equal(currentStreak(s, "2026-11-20"), 0, "a missed day ends it");
  s = recordSpin(s, "2026-11-20");
  assert.equal(s.streak, 1);
  assert.equal(s.best, 3, "the best streak stays");
  // across a month and a year end
  let t = recordSpin({}, "2026-12-31");
  t = recordSpin(t, "2027-01-01");
  assert.equal(t.streak, 2);
  assert.equal(recordSpin(recordSpin({}, "2026-02-28"), "2026-03-01").streak, 2);
  assert.equal(currentStreak(null), 0);
});

test("no spin limit: spins count up without end and nothing says Back Tomorrow or spins left", () => {
  let s = {};
  for (let i = 0; i < 50; i++) s = recordSpin(s, "2026-11-18");
  assert.equal(s.spins, 50);
  assert.equal(s.streak, 1);
  const src = readFileSync(new URL("./roulette.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Back Tomorrow|spins left|Deck|badge/i);
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.doesNotMatch(browse.slice(browse.indexOf("// ---- Browse (F154)")), /Back Tomorrow|spins left/i);
});

test("the record is kept in storage beside the settings, and a broken one reads as new", () => {
  const st = memStorage();
  saveSpins(recordSpin(readSpins(st), "2026-11-18"), st);
  assert.deepEqual(readSpins(st), { last: "2026-11-18", streak: 1, best: 1, spins: 1 });
  assert.match(ROULETTE_KEY, /^ifizbox\./);
  assert.deepEqual(readSpins(memStorage({ [ROULETTE_KEY]: "{oops" })), { last: null, streak: 0, best: 0, spins: 0 });
  assert.deepEqual(readSpins(memStorage({ [ROULETTE_KEY]: '{"last":"x","streak":-3}' })), { last: null, streak: 0, best: 0, spins: 0 });
  const throwing = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  assert.deepEqual(readSpins(throwing).streak, 0);
  assert.doesNotThrow(() => saveSpins({ last: null }, throwing));
});

test("nextPos: a wheel turns whole turns forward and rests on its target", () => {
  for (const [pos, len, target, turns] of [[4, 4, 2, 3], [7, 6, 0, 4], [13, 6, 5, 5], [0, 4, 3, 3]]) {
    const p = nextPos(pos, len, target, turns);
    assert.equal(p % len, target);
    assert.ok(p - pos >= len * (turns - 1), "spins several turns");
    assert.ok(p > pos);
  }
});

test("Browse's Roulette row: Spin for something new, then the day streak once there is one", () => {
  const row = rouletteRow({ streak: 0, href: "#/home/browse/roulette" }).rows[0];
  assert.equal(row.label, "Tweak Roulette");
  assert.equal(row.subtitle, ROULETTE_SUBTITLE);
  assert.equal(row.subtitle, "Spin for something new");
  assert.equal(row.href, "#/home/browse/roulette");
  assert.equal(rouletteRow({ streak: 4 }).rows[0].subtitle, "Spin for something new · 4-day streak");
  assert.equal(rouletteTitle(false), "App Roulette", "the apps builds spin apps");
});
