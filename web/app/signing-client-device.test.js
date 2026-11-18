// F58: signing-client.js in the sideload build, against a fake cydianNative: status and import calls, the picks
// kept in memory, Install's HUD following signing.install's phases, and its errors by code.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  localSigning, signingAvailable, signingReady, deviceStatus, importToDevice, removeFromDevice,
  installOnDevice, loadIdentity, saveIdentity, clearIdentity, firstInstallCheck, importFromSafari, finishSafariImport, exportToApp,
} from "./signing-client.js";
import { walkOpen } from "./screens/signing.js";

// A fake bridge: `answers[method]` is a value, an Error (rejects) or fn(params, onEvent).
function fakeNative(answers = {}) {
  const calls = [];
  return {
    mode: "sideload",
    calls,
    async call(method, params, onEvent) {
      calls.push({ method, params });
      const a = answers[method];
      if (a instanceof Error) throw a;
      return typeof a === "function" ? a(params, onEvent) : a ?? null;
    },
  };
}
const coded = (code, message) => Object.assign(new Error(message), { code });
function fakeUI() {
  const ui = { labels: [], hidden: 0, alerts: [], went: [], later: [] };
  ui.deps = {
    hud: (t) => { ui.labels.push(t); return { set: (x) => ui.labels.push(x), hide: () => { ui.hidden++; } }; },
    alert: async (a) => { ui.alerts.push(a); return { index: 0 }; },
    go: (path) => ui.went.push(path),
    later: (f, ms) => ui.later.push([f, ms]),
  };
  return ui;
}

let saved;
beforeEach(() => { saved = globalThis.cydianNative; });
afterEach(async () => { await clearIdentity().catch(() => {}); globalThis.cydianNative = saved; });

test("the sideload build signs locally, not through the server", () => {
  globalThis.cydianNative = fakeNative();
  assert.equal(localSigning(), true);
  assert.equal(signingAvailable(), false);
  delete globalThis.cydianNative;
  assert.equal(localSigning(), false);
});

test("ready once the Keychain holds an identity", async () => {
  globalThis.cydianNative = fakeNative({ "signing.status": { identity: null } });
  assert.equal(await signingReady(), false);
  globalThis.cydianNative = fakeNative({ "signing.status": { identity: { name: "X" } } });
  assert.equal(await signingReady(), true);
  globalThis.cydianNative = fakeNative({ "signing.status": coded("internal", "boom") });
  assert.equal(await signingReady(), false);
});

test("the picks stay in memory in the sideload build", async () => {
  globalThis.cydianNative = fakeNative();
  await saveIdentity({ p12: new Uint8Array([0x30, 1]), p12Name: "me.p12" });
  await saveIdentity({ password: "pw" });
  const id = await loadIdentity();
  assert.equal(id.p12Name, "me.p12");
  assert.equal(id.password, "pw");
  await clearIdentity();
  assert.equal(await loadIdentity(), null);
});

test("status, import (base64) and remove go to their bridge calls", async () => {
  const st = { identity: { name: "X" } };
  const n = fakeNative({ "signing.status": st, "signing.import": st, "signing.remove": { identity: null } });
  assert.equal(await deviceStatus(n), st);
  await importToDevice({ p12: new Uint8Array([1, 2, 3]), profile: new Uint8Array([4, 5]), password: "pw" }, n);
  await importToDevice({ p12: new Uint8Array([1]), profile: new Uint8Array([2]) }, n);
  await removeFromDevice(n);
  assert.deepEqual(n.calls.map((c) => c.method), ["signing.status", "signing.import", "signing.import", "signing.remove"]);
  assert.deepEqual(n.calls[1].params, { p12: "AQID", profile: "BAU=", password: "pw" });
  assert.equal(n.calls[2].params.password, "");
});

// F75 (1): the first Install with no certificate (or no server) opens the walkthrough at that step, no alert.
test("first install: no certificate opens Settings > Signing at the certificate step", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: null } });
  assert.equal(await firstInstallCheck({ native: n, server: "https://cydian.dev", go: (p) => went.push(p), wait: async () => {} }), "certificate");
  assert.deepEqual(went, [["signing"]]);
  assert.deepEqual(walkOpen, { certificate: true, server: false });
});

test("first install: a certificate but no usable server opens the server step", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: { name: "X" } } });
  for (const server of [null, "http://plain.example"]) {
    assert.equal(await firstInstallCheck({ native: n, server, go: (p) => went.push(p), wait: async () => {} }), "server");
  }
  assert.deepEqual(walkOpen, { certificate: false, server: true });
  assert.equal(went.length, 2);
});

test("first install: certificate and server there, Install goes on (no wait for anything else)", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: { name: "X" } } });
  assert.equal(await firstInstallCheck({ native: n, server: "https://cydian.dev", go: (p) => went.push(p) }), null);
  assert.deepEqual(went, []);
  assert.deepEqual(n.calls.map((c) => c.method), ["signing.status"]);
});

test("first install: a signer that doesn't answer counts as no certificate", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": coded("internal", "boom") });
  assert.equal(await firstInstallCheck({ native: n, server: "https://cydian.dev", go: (p) => went.push(p), wait: async () => {} }), "certificate");
});

// F75 (3): Import from Safari end to end: the app's key in the fragment, the website seals, the app opens and imports.
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("Import from Safari: key out in the fragment, ciphertext back, into the Keychain", async () => {
  const storage = memStorage();
  let opened = null;
  const key = await importFromSafari({ server: "https://test.example.ts.net", open: (u) => { opened = u; }, storage });
  assert.equal(opened, `https://test.example.ts.net/#/settings/signing-export.${key}`);
  // the website's export page (its own storage: the staged picks here)
  globalThis.cydianNative = fakeNative();
  await saveIdentity({ p12: new Uint8Array([0x30, 1, 2]), profile: new Uint8Array([7, 8]), password: "pass word", p12Name: "me.p12" });
  const link = await exportToApp(key);
  assert.match(link, /^cydian:\/\/signing-import#[A-Za-z0-9_-]+$/);
  assert.equal(link.includes("pass word"), false); // a space: never in base64url by chance
  const n = fakeNative({ "signing.import": { identity: { name: "Me" } } });
  const st = await finishSafariImport(link, { native: n, storage });
  assert.deepEqual(st, { identity: { name: "Me" } });
  assert.deepEqual(n.calls[0], { method: "signing.import", params: { p12: "MAEC", profile: "Bwg=", password: "pass word" } });
  // one use: the same link again finds no key
  await assert.rejects(finishSafariImport(link, { native: n, storage }), /Start again/);
});

test("Import from Safari: nothing on the website, a stale or foreign link", async () => {
  globalThis.cydianNative = fakeNative();
  assert.equal(await exportToApp("A".repeat(43)), null); // no certificate in this origin's storage
  const storage = memStorage();
  const n = fakeNative({ "signing.import": { identity: { name: "Me" } } });
  await assert.rejects(finishSafariImport("cydian://import?d=x", { native: n, storage }), /no certificate/);
  let t = 0;
  const key = await importFromSafari({ open: () => {}, storage, now: () => t });
  await saveIdentity({ p12: new Uint8Array([0x30]), profile: new Uint8Array([7]) });
  const link = await exportToApp(key);
  t = 31 * 60 * 1000;
  await assert.rejects(finishSafariImport(link, { native: n, storage, now: () => t }), /Start again/);
  t = 0;
  await importFromSafari({ open: () => {}, storage, now: () => t }); // a new key: the old link doesn't open
  await assert.rejects(finishSafariImport(link, { native: n, storage, now: () => t }), /couldn't be read/);
  assert.equal(n.calls.length, 0);
});

test("Install: the HUD follows the phases, then Installing, and records the app", async () => {
  const done = { bundleId: "com.x", name: "X", version: "1.0", removed: [] };
  const n = fakeNative({
    "signing.install": async (params, onEvent) => {
      for (const ev of [{ phase: "downloading", progress: 0.5 }, { phase: "downloading", progress: 1 }, { phase: "reading", progress: 0 },
        { phase: "signing", progress: 0.25 }, { phase: "installing", progress: 0 }]) onEvent(ev);
      return done;
    },
  });
  const ui = fakeUI();
  let recorded = null;
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X", onInstalled: (r) => { recorded = r; } }, { native: n, ...ui.deps }), true);
  assert.deepEqual(n.calls[0], { method: "signing.install", params: { url: "https://e.example/x.ipa", manifestServer: "https://cydian.dev" } }); // the manifest from the signing server
  assert.deepEqual(ui.labels, ["Downloading", "Downloading 50%", "Downloading", "Reading", "Signing 25%", "Installing", "Installing"]);
  assert.equal(recorded, done);
  assert.equal(ui.alerts.length, 0);
  assert.equal(ui.hidden, 0);
  assert.equal(ui.later[0][1], 1200); // then the checkmark, which fades on its own
  ui.later[0][0]();
  assert.equal(ui.hidden, 1);
});

for (const code of ["no_server", "no_identity"]) {
  test(`Install: ${code} explains and opens Settings > Signing`, async () => {
    const n = fakeNative({ "signing.install": coded(code, "no") });
    const ui = fakeUI();
    let recorded = false;
    assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", onInstalled: () => { recorded = true; } }, { native: n, ...ui.deps }), false);
    assert.equal(ui.hidden, 1);
    assert.equal(ui.alerts.length, 1);
    assert.deepEqual(ui.went, [["signing"]]);
    assert.equal(recorded, false);
  });
}

test("Install: other errors show the signer's message and stay put", async () => {
  const n = fakeNative({ "signing.install": async (p, onEvent) => { onEvent({ phase: "downloading", progress: 0.1 }); throw coded("too_large", "the IPA is bigger than 4 GB"); } });
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "Big" }, { native: n, ...ui.deps }), false);
  assert.deepEqual(ui.alerts[0], { title: "Couldn't Install Big", message: "The IPA is bigger than 4 GB", buttons: ["OK"] });
  assert.deepEqual(ui.went, []);
  assert.equal(ui.hidden, 1);
});

test("Install without a bridge fails with an alert, not a throw", async () => {
  delete globalThis.cydianNative;
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa" }, ui.deps), false);
  assert.equal(ui.alerts.length, 1);
});
