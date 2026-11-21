// B264: Changes counts its badge (and through it the icon's) again the moment an app's re-sign ends, and an older
// count that answers late never puts its number back. User 2026-11-21, Lite: re-signed everything from Changes, the
// runs finished, the home screen badge kept its count until the app was opened again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "../fakes.test-helper.js";

globalThis.indexedDB = fakeIndexedDB(); // the sources and Installed's records live there
globalThis.fetch = async () => { throw new Error("offline"); }; // no source loads: the re-signs are the whole count

const day = 86400000;
const signed = (id, expiresIn) => ({ bundleId: id, name: id, version: "1.0", expires: new Date(Date.now() + expiresIn).toISOString() });

test("recountBadge: a re-signed app leaves the count at once; the latest count wins over an older one answering late", async () => {
  let answer = { apps: [signed("a", -day), signed("b", -day)] };
  let slow = null; // a signing.installed answer held back until released
  globalThis.ifizboxNative = { mode: "sideload", call: async (m) => {
    if (m !== "signing.installed") return {};
    const now = answer;
    if (slow) { const gate = slow; slow = null; await gate; }
    return now;
  } };
  try {
    const m = await import("./changes.js");
    const badges = [];
    m.init({ setBadge: (tab, n) => { if (tab === "changes") badges.push(n); } });
    await new Promise((f) => setTimeout(f, 50)); // init's own count at launch
    await m.recountBadge();
    assert.equal(badges.at(-1), 2, "two apps need a re-sign");

    answer = { apps: [signed("a", 300 * day), signed("b", -day)] }; // Alpha's re-sign ended
    await m.recountBadge();
    assert.equal(badges.at(-1), 1, "counted again as the re-sign ended");

    // an older count (both still needing a re-sign) answers after a newer one (both re-signed): the newer stands
    answer = { apps: [signed("a", -day), signed("b", -day)] };
    let release;
    slow = new Promise((f) => { release = f; });
    const older = m.recountBadge();
    await new Promise((f) => setTimeout(f, 5));
    answer = { apps: [signed("a", 300 * day), signed("b", 300 * day)] };
    await m.recountBadge();
    assert.equal(badges.at(-1), 0);
    release();
    await older;
    assert.equal(badges.at(-1), 0, "the late, older count never puts 2 back");
  } finally {
    delete globalThis.ifizboxNative;
  }
});
