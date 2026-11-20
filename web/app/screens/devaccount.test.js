// Check Account's line about this iPhone (screens/devaccount.js deviceLine), with a fake App Store Connect request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLine, PAIR_HINT } from "./devaccount.js";

const A = "00008110-000A1B2C3D4E5F01", B = "00008101-000123456789ABCD", C = "00008030-0011223344556677";

function fakeRequest(devices) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path.startsWith("/devices")) {
      const m = /filter%5Budid%5D=([^&]+)|filter\[udid\]=([^&]+)/.exec(path);
      const want = m ? decodeURIComponent(m[1] ?? m[2]) : null;
      return { data: devices.filter((d) => !want || d.udid === want).map((d, i) => ({ id: `D${i}`, attributes: { udid: d.udid, status: d.status ?? "ENABLED" } })) };
    }
    if (method === "POST" && path === "/devices") return { data: { id: "NEW" } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { request, calls };
}

test("candidates, all registered and enabled: this iPhone is in the account, nothing is posted", async () => {
  const f = fakeRequest([{ udid: A }, { udid: B }, { udid: C }]);
  const line = await deviceLine(f.request, { candidates: [A, B.toLowerCase(), C] });
  assert.equal(line, "This iPhone is in the account (one of the 3 iPhones in this app's profile).");
  assert.ok(!line.includes("isn't known"));
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"]);
});

test("candidates, some missing or disabled: names them and the real Pairing path", async () => {
  const f = fakeRequest([{ udid: A }, { udid: C, status: "DISABLED" }]);
  const line = await deviceLine(f.request, { candidates: [A, B, C] });
  assert.match(line, /one of the 3 iPhones in this app's profile/);
  assert.match(line, new RegExp(`not in the account: ${B}`));
  assert.match(line, new RegExp(`disabled: ${C}`));
  assert.ok(!line.includes(A), "a registered one isn't named");
  assert.match(line, /Install Apps With: This iPhone, then This iPhone > Pairing/);
  assert.ok(!f.calls.some((c) => c.method === "POST"), "nothing is registered without a known UDID");
});

test("a known UDID is registered when missing, and reported when there", async () => {
  const f = fakeRequest([]);
  assert.equal(await deviceLine(f.request, { udid: A.toLowerCase(), candidates: [A] }), `This iPhone (${A}) was added to the account.`);
  assert.equal(f.calls.at(-1).method, "POST");
  assert.equal(await deviceLine(fakeRequest([{ udid: A }]).request, { udid: A }), "This iPhone is in the account.");
});

test("no UDID and no candidates: the app names Install Apps With: This iPhone > Pairing, the site its own finder", async () => {
  const f = fakeRequest([]);
  assert.equal(await deviceLine(f.request, { app: true }), PAIR_HINT);
  assert.match(PAIR_HINT, /Settings > Installation & Signing.*Install Apps With: This iPhone.*This iPhone > Pairing/);
  assert.match(await deviceLine(f.request, { app: false }), /Find This iPhone's UDID/);
  assert.equal(f.calls.length, 0);
});
