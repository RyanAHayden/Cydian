// F236: Settings > Signing's "This iPhone" rows under the Provisioning Profile (screens/signing.js deviceRows), and
// the line an install adds when nobody could check this iPhone against the profile (signing-sheet.js followInstall,
// signing-client.js siteCause).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceRows } from "./signing.js";
import { deviceCheckText, notInProfileText, IN_PROFILE_TEXT, likelyCauseText, notLandedText } from "../core/signing.js";
import { siteCause } from "../signing-client.js";
import { followInstall } from "../signing-sheet.js";

const UDID = "00008030-0011223344556677";

test("in the profile: one row, the sentence as the footer", () => {
  const g = deviceRows(deviceCheckText({ state: "in", udid: UDID, count: 3 }));
  assert.deepEqual(g.rows, [{ label: "This iPhone", detail: "In Profile" }]);
  assert.equal(g.footer, IN_PROFILE_TEXT);
  assert.equal(g.warn, false);
});

test("not in the profile: red, with the UDID and Copy UDID", () => {
  const g = deviceRows(deviceCheckText({ state: "out", udid: UDID, count: 3 }));
  assert.deepEqual(g.rows.map((r) => r.label), ["This iPhone", "UDID", "Copy UDID"]);
  assert.equal(g.rows[0].detail, "Not in Profile");
  assert.equal(g.rows[1].subtitle, UDID);
  assert.equal(g.rows[2].copy, UDID);
  assert.equal(g.footer, notInProfileText(UDID));
  assert.equal(g.warn, true);
  const noUdid = deviceRows(deviceCheckText({ state: "out", count: 3 }));
  assert.deepEqual(noUdid.rows.map((r) => r.label), ["This iPhone"], "a set from the app's own profile: no UDID to copy");
  assert.equal(noUdid.warn, true);
});

test("unknown: the device count and how to find the UDID; skip: nothing", () => {
  const g = deviceRows(deviceCheckText({ state: "unknown", count: 5 }));
  assert.equal(g.rows[0].detail, "Unknown");
  assert.match(g.footer, /5 devices/);
  assert.match(g.footer, /idevice_id -l/);
  assert.equal(g.warn, false);
  assert.equal(deviceRows(deviceCheckText({ state: "skip", count: 0 })), null);
  assert.equal(deviceRows(null), null);
});

test("the website's install: the likely cause when the profile lists devices", () => {
  const profile = (extra) => new TextEncoder().encode(`xx<?xml version="1.0"?><plist version="1.0"><dict>${extra}</dict></plist>xx`);
  const listed = siteCause({ profile: profile("<key>ProvisionedDevices</key><array><string>a</string><string>b</string></array>") }, "Foo");
  assert.equal(listed, `If Foo doesn't appear on the Home Screen, or iOS says its integrity could not be verified: ${likelyCauseText({ count: 2 })}`);
  assert.equal(siteCause({ profile: profile("<key>ProvisionsAllDevices</key><true/>") }, "Foo"), null);
  assert.equal(siteCause({ profile: new Uint8Array([1, 2]) }, "Foo"), null, "an unreadable profile: no guess");
});

function hud() {
  const lines = [];
  return { lines, set() {}, finish() {}, page: { line: (kind, text) => lines.push([kind, text]) } };
}

test("the app's install: Done with the likely cause only when its check couldn't run", async () => {
  const h = hud();
  await followInstall(null, "com.example.app", h, { name: "Example", device: { state: "unknown", count: 2 } });
  assert.deepEqual(h.lines, [["warning", notLandedText("Example", { state: "unknown", count: 2 })]]);
  for (const device of [{ state: "in", count: 2 }, { state: "skip", count: 0 }, null]) {
    const ok = hud();
    await followInstall(null, "com.example.app", ok, { name: "Example", device });
    assert.deepEqual(ok.lines, [], JSON.stringify(device));
  }
});

test("the website's watch: the cause under the last step once iOS has the app, and when it gives up waiting", async () => {
  const { watchInstall } = await import("../signing-client.js");
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
  const run = async (status, upTo) => {
    let now = 0;
    const lines = [];
    const h = { set() {}, done() {}, hide() {}, page: { line: (k, t) => lines.push([k, t]) } };
    const end = await watchInstall("ab".repeat(24), h, { fetcher: async () => json(status), cause: "CAUSE", clock: () => now,
      sleep: async (ms) => { now += ms; }, askWithin: 10 ** 9, upTo }).end;
    return { end, lines };
  };
  assert.deepEqual(await run({ manifest: true, started: true, finished: true }, 60000), { end: "installed", lines: [["warning", "CAUSE"]] });
  assert.deepEqual(await run({ manifest: true, started: false, finished: false }, 5000), { end: "timeout", lines: [["warning", "CAUSE"]] });
});
