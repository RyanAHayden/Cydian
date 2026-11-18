// F57: the shell's paid-package calls (native/Sources/Paid.swift) against the fake bridge, the fake helper and a fake
// Sileo Payment Provider vendor (native/fake/fake-vendor.mjs): sign in through auth.session, the payment secret in
// keychain.*, buy, authorize_download and paid.install of the one-time .deb, the way screens/extras.js drives them
// (its shellRequest, device and keychain wiring is copied here). The real helper's install-paid is
// native/helper/test_helper.py's InstallPaid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { createFakeVendor } from "../../native/fake/fake-vendor.mjs";
import { createPaymentClient, createCredentialStore } from "./core/payment.js";

const ID = "com.example.paid";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function setup(t, { vendor: vopts = {}, env = {}, mode, device } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const vendor = createFakeVendor({ packages: { [ID]: { price: "$1.99", version: "1.0-1" } }, ...vopts });
  const paidDir = join(fx.dir, "paid-cache");
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, env, mode, vendors: [vendor], paidDir,
    ...(device !== undefined ? { device } : {}) });
  // extras.js's wiring of core/payment.js to the shell
  const shell = (method, params) => native.call(method, params);
  const request = async (req) => {
    const r = await shell("net.request", req);
    let json = null;
    try { json = JSON.parse(Buffer.from(r.body, "base64").toString("utf8")); } catch { json = null; }
    return { status: r.status, json };
  };
  const keychain = {
    get: (key) => shell("keychain.get", { key }),
    set: (key, value) => shell("keychain.set", { key, value }),
    remove: (key) => shell("keychain.remove", { key }),
  };
  const storage = memoryStorage();
  const client = createPaymentClient({ base: vendor.base, request, device: () => shell("device.info"),
    credentials: createCredentialStore({ storage, secure: keychain }) });
  const status = () => readFileSync(join(fx.prefix, "var/lib/dpkg/status"), "utf8");
  return { fx, vendor, native, client, shell, storage, status, paidDir };
}

async function signIn({ client, shell }) {
  const cb = await shell("auth.session", { url: await client.authenticateUrl(), callbackScheme: "sileo" });
  return client.finishSignIn(cb);
}

test("net.request sends the vendor's GET and POST and answers base64 like net.fetch", async (t) => {
  const { native, vendor } = setup(t);
  const r = await native.call("net.request", { method: "GET", url: vendor.base + "info", headers: { Accept: "application/json" } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(Buffer.from(r.body, "base64").toString()).name, "Fake Vendor");
  const p = await native.call("net.request", { method: "POST", url: vendor.base + `package/${ID}/info`,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ udid: "x" }) });
  assert.deepEqual(JSON.parse(Buffer.from(p.body, "base64").toString()), { price: "$1.99", purchased: false, available: true });
  assert.deepEqual(vendor.log.at(-1), { method: "POST", path: `package/${ID}/info`, body: { udid: "x" } });
  await assert.rejects(native.call("net.request", { url: "http://vendor.test/api/sileo/info" }), /^Error: bad_url: not an https URL/);
  await assert.rejects(native.call("net.request", { method: "DELETE", url: vendor.base + "info" }), /bad_url: method DELETE/);
});

test("device.info gives the UDID and model, and says when the UDID can't be read", async (t) => {
  const { native } = setup(t);
  assert.deepEqual(await native.call("device.info"), { udid: "00008110-000A1B2C3D4E5F60", model: "iPhone14,2" });
  const none = setup(t, { device: null });
  await assert.rejects(none.native.call("device.info"), /^Error: device: /);
});

test("sign in, buy and install: the secret only in the Keychain, the .deb installed through install-paid", async (t) => {
  const s = setup(t);
  const { client, native, vendor, storage, status, paidDir } = s;
  assert.equal(await client.signedIn(), false);
  assert.equal((await client.packageInfo(ID)).purchased, false);
  assert.equal(await signIn(s), true);
  assert.equal(await client.signedIn(), true);
  // the token beside the page, the payment secret only in the shell's Keychain
  const key = "cydian.payment:" + vendor.base;
  assert.equal(native.keychain.size, 1);
  assert.ok(native.keychain.get(key));
  assert.ok(!storage.getItem(key).includes(native.keychain.get(key)));
  // the sign-in page gets the device's UDID and model
  assert.match(await client.authenticateUrl(), /authenticate\?udid=00008110-000A1B2C3D4E5F60&model=iPhone14%2C2$/);
  assert.deepEqual((await client.purchase(ID)), { status: "done" });
  assert.equal((await client.packageInfo(ID)).purchased, true);
  assert.deepEqual(vendor.log.find((l) => l.path.endsWith("/purchase")).body.payment_secret, native.keychain.get(key));

  const url = await client.authorizeDownload(ID, { version: "1.0-1", repo: "https://repo.vendor.test/" });
  const events = [];
  const r = await native.call("paid.install", { url, package: ID, version: "1.0-1", stream: true }, (e) => events.push(e));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Setting up com\.example\.paid \(1\.0-1\)/);
  assert.match(status(), /Package: com\.example\.paid\nStatus: install ok installed\nVersion: 1\.0-1/);
  assert.deepEqual(events[0], { fd: "status", line: `dlstatus:${ID}:0:Downloading` });
  assert.ok(events.some((e) => e.line === `pmstatus:${ID}:100:Installed ${ID}`));
  assert.deepEqual(readdirSync(paidDir), []); // the download is gone
  const helperCall = native.calls.find((c) => c.method === "helper.run");
  assert.deepEqual(helperCall.params.words.slice(2), [ID, "1.0-1"]);
  assert.match(helperCall.params.words[1], /paid-cache\/[0-9A-F-]{36}\.deb$/);
  // the URL was one-time
  await assert.rejects(native.call("paid.install", { url, package: ID, version: "1.0-1" }), /^Error: not_found: HTTP 404/);

  await client.signOut();
  assert.equal(native.keychain.size, 0);
  assert.equal(await client.signedIn(), false);
});

test("a purchase that needs the browser finishes through auth.session at sileo://payment_completed", async (t) => {
  const s = setup(t, { vendor: { purchaseNeedsAction: true } });
  await signIn(s);
  const r = await s.client.purchase(ID);
  assert.equal(r.status, "action");
  assert.equal(await s.shell("auth.session", { url: r.url, callbackScheme: "sileo" }), "sileo://payment_completed");
  assert.equal((await s.client.packageInfo(ID)).purchased, true);
});

test("closing the sign-in sheet answers null, and nothing is kept", async (t) => {
  const s = setup(t, { vendor: { cancelSignIn: true } });
  assert.equal(await s.shell("auth.session", { url: await s.client.authenticateUrl(), callbackScheme: "sileo" }), null);
  assert.equal(await s.client.finishSignIn(null), false);
  assert.equal(s.native.keychain.size, 0);
  await assert.rejects(s.shell("auth.session", { url: s.vendor.base, callbackScheme: "https" }), /bad callback scheme/);
});

test("paid.install refuses a .deb that isn't the package and version asked, and reports apt's failure", async (t) => {
  const s = setup(t, { vendor: { packages: { [ID]: { price: "$1", version: "1.0", control: { Package: "com.example.evil" } } } } });
  await signIn(s);
  await s.client.purchase(ID);
  let r = await s.native.call("paid.install", { url: await s.client.authorizeDownload(ID), package: ID, version: "1.0" });
  assert.equal(r.code, 64);
  assert.match(r.stderr, /isn't that package and version/);
  assert.doesNotMatch(s.status(), /com\.example\.evil/);

  const f = setup(t, { env: { FAKE_FAIL: "install-paid" } });
  await signIn(f);
  await f.client.purchase(ID);
  r = await f.native.call("paid.install", { url: await f.client.authorizeDownload(ID), package: ID, version: "1.0-1" });
  assert.equal(r.code, 100);
  assert.match(r.stderr, /^E: /m);
  assert.deepEqual(readdirSync(f.paidDir), []);
});

test("paid.install is jailbreak only and https only", async (t) => {
  const s = setup(t, { mode: "sideload" });
  await assert.rejects(s.native.call("paid.install", { url: "https://vendor.test/dl/x.deb", package: ID, version: "1" }), /^Error: sideload: /);
  const j = setup(t);
  await assert.rejects(j.native.call("paid.install", { url: "http://vendor.test/dl/x.deb", package: ID, version: "1" }), /bad_url/);
  await assert.rejects(j.native.call("paid.install", { url: "https://vendor.test/dl/missing.deb", package: ID, version: "1" }), /not_found: HTTP 404/);
});
