// F253: the website's This iPhone through a configuration profile (screens/signing.js): the visit it starts at the
// Worker, the poll that saves the UDID, and the Find This iPhone's UDID row while the check is unknown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { storedUdid, saveUdid, forgetUdid, udidPending, startUdid, pollUdid, udidFindRows, canFindUdid, FIND_UDID,
  udidFindText, UDID_KEY } from "./signing.js";
import { UDID_KEY as WORKER_KEY } from "../../../worker/src/udid.js";
import { deviceCheck } from "../core/signing.js";

const UDID = "00008030-0011223344556677";
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });

test("the Worker's done page writes the key the website reads", () => assert.equal(UDID_KEY, WORKER_KEY));

test("start keeps the visit, the poll saves the UDID once iOS answered", async () => {
  const store = memory();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init?.method ?? "GET"]);
    if (url === "https://site.example/sign/udid") return answer(200, { challenge: "c", profile: "https://site.example/sign/udid/c/udid.mobileconfig", poll: "https://site.example/sign/udid/c", expiresIn: 600 });
    return answer(200, calls.length < 3 ? { state: "waiting" } : { state: "done", udid: UDID, product: "iPhone9,3", version: "19H410" });
  };
  const url = await startUdid({ origin: "https://site.example", fetcher, store, now: 1000 });
  assert.equal(url, "https://site.example/sign/udid/c/udid.mobileconfig");
  assert.deepEqual(calls[0], ["https://site.example/sign/udid", "POST"]);
  assert.equal(udidPending(store, 2000).poll, "https://site.example/sign/udid/c");
  assert.equal(udidPending(store, 1000 + 601_000), null); // expired
  assert.equal(await pollUdid({ fetcher, store, now: 2000 }), "waiting");
  assert.equal(storedUdid(store), null);
  assert.equal(await pollUdid({ fetcher, store, now: 3000 }), "done");
  assert.deepEqual(storedUdid(store), { udid: UDID, product: "iPhone9,3", version: "19H410" });
  assert.equal(udidPending(store, 3000), null);
  assert.equal(await pollUdid({ fetcher, store, now: 4000 }), null); // nothing pending any more
});

test("an expired visit is forgotten; a failed start throws the server's words", async () => {
  const store = memory();
  store.setItem("ifizbox.udid.pending", JSON.stringify({ poll: "https://s/sign/udid/c", expires: 10_000 }));
  assert.equal(await pollUdid({ fetcher: async () => answer(404, { code: "expired" }), store, now: 5000 }), "expired");
  assert.equal(udidPending(store, 5000), null);
  await assert.rejects(startUdid({ origin: "https://s", store, fetcher: async () => answer(501, { error: "No KV." }) }), /No KV\./);
  store.setItem("ifizbox.udid.pending", JSON.stringify({ poll: "https://s/sign/udid/c", expires: 10_000 }));
  assert.equal(await pollUdid({ fetcher: async () => { throw new Error("offline"); }, store, now: 5000 }), "waiting");
});

test("stored UDIDs are checked, and can be forgotten", () => {
  const store = memory();
  store.setItem(UDID_KEY, JSON.stringify({ udid: "<b>" }));
  assert.equal(storedUdid(store), null);
  saveUdid({ udid: UDID }, store);
  assert.deepEqual(storedUdid(store), { udid: UDID, product: null, version: null });
  forgetUdid(store);
  assert.equal(storedUdid(store), null);
  assert.equal(storedUdid(null), null); // storage blocked
});

test("Find This iPhone's UDID shows only while an iPhone's check is unknown", () => {
  const profile = { udids: [UDID, "00008030-AAAA"] };
  const unknown = deviceCheck(profile, null);
  assert.deepEqual(udidFindRows(unknown), { rows: [{ label: FIND_UDID, find: true }], footer: udidFindText });
  assert.deepEqual(udidFindRows(unknown, { pending: true }).rows, [{ label: FIND_UDID, detail: "Waiting" }]);
  assert.equal(udidFindRows(unknown, { can: false }), null);
  assert.equal(udidFindRows(deviceCheck(profile, { udid: UDID })), null); // known: In Profile
  assert.equal(udidFindRows(deviceCheck({ udids: [] }, null)), null);    // no device list
  assert.match(udidFindText, /Not Verified/);
});

test("an iPhone or iPad can take the profile, a computer can't", () => {
  assert.ok(canFindUdid({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X)" }));
  assert.ok(canFindUdid({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })); // iPadOS
  assert.ok(!canFindUdid({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }));
  assert.ok(!canFindUdid({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }));
});
