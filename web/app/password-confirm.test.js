// F260: the website's .p12 password checked by zsign itself in the Web Worker (websign-job.js runPasswordCheck), and
// saved (signing-client.js confirmPassword) so Install's tap finds passwordOk true and opens iOS's prompt at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runPasswordCheck, passwordVerdict } from "./websign-job.js";
import { confirmPassword, checkPasswordInWorker, needsConfirm, expectedBundleId } from "./signing-client.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const PROFILE = fx("test.mobileprovision");
const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);

test("zsign's output on the empty folder: loaded (true), a MAC that doesn't verify (false), anything else unknown", () => {
  assert.equal(passwordVerdict(["\x1b[31m>>> Can't find app folder! /w/none", ">>> Signed Failed!"]), true);
  assert.equal(passwordVerdict(["...:PKCS12_parse:mac verify failure:...", "\x1b[31m>>> Can't load p12 or private key file. Please input the correct file and password!"]), false);
  assert.equal(passwordVerdict([">>> Can't load p12 or private key file."]), null, "a damaged file isn't a wrong password");
  assert.equal(passwordVerdict([">>> Can't find TeamId!"]), null);
  assert.equal(passwordVerdict([]), null);
});

test("runPasswordCheck runs zsign on the certificate and profile alone; a crash is unknown", async () => {
  let seen = null;
  const fake = (lines, { throws } = {}) => async ({ print }) => {
    const files = new Map();
    return {
      FS: { mkdir() {}, writeFile: (p, d) => files.set(p, d) },
      callMain: (args) => { seen = { args, files }; if (throws) throw throws; for (const l of lines) print(l); return 255; },
    };
  };
  assert.equal(await runPasswordCheck(fake([">>> Can't find app folder! /w/none"]), { p12: new Uint8Array([0x30]), password: "pw", profile: PROFILE }), true);
  assert.deepEqual(seen.args, ["-k", "/w/key.p12", "-p", "pw", "-m", "/w/app.mobileprovision", "-t", "/w/tmp", "/w/none"]);
  assert.equal(seen.files.get("/w/key.p12")[0], 0x30);
  assert.equal(await runPasswordCheck(fake([], { throws: new RangeError("oom") }), { p12: new Uint8Array([0x30]), profile: PROFILE }), null);
  assert.equal(await runPasswordCheck(fake(["x"]), { p12: null, profile: PROFILE }), null);
});

test("zsign WebAssembly checks the test certificates: right, wrong, none needed, legacy (RC2)", { skip: !existsSync(WASM) && "no vendor/zsign" }, async (t) => {
  const { default: createZsign } = await import(WASM);
  const code = process.exitCode; // emscripten on node sets it when main() fails, as it does here every time
  t.after(() => { process.exitCode = code; });
  const check = (p12, password) => runPasswordCheck(createZsign, { p12: fx(p12), password, profile: PROFILE });
  assert.equal(await check("test.p12", "hunter2"), true);
  assert.equal(await check("test.p12", "nope"), false);
  assert.equal(await check("test-nopass.p12", ""), true);
  assert.equal(await check("test-nopass.p12", "x"), false);
  assert.equal(await check("test-legacy.p12", "hunter2"), true);
  assert.equal(await check("test-legacy.p12", ""), false);
});

test("checkPasswordInWorker sends the Worker a password check, never a sign", async () => {
  let job = null;
  const ok = await checkPasswordInWorker({ p12: new Uint8Array([0x30, 1]), password: "pw", profile: new Uint8Array([2]) },
    { worker: async (j) => { job = j; return { ok: true, passwordOk: true }; } });
  assert.equal(ok, true);
  assert.equal(job.check, "password");
  assert.equal(job.password, "pw");
  assert.ok(job.p12 instanceof ArrayBuffer && job.profile instanceof ArrayBuffer && !("ipa" in job));
  assert.equal(await checkPasswordInWorker({ p12: new Uint8Array([1]), profile: new Uint8Array([2]) }, { worker: async () => ({ ok: true, passwordOk: null }) }), null);
});

// An identity store as signing-client.js keeps it: identity() reads, save(patch) merges.
function store(id) {
  let cur = id;
  const saves = [];
  return {
    identity: async () => (cur ? { ...cur } : null),
    save: async (p) => { saves.push(p); cur = { ...cur, ...p }; return cur; },
    set: (p) => { cur = { ...cur, ...p }; },
    get: () => cur, saves,
  };
}
const appProfile = new TextEncoder().encode(`junk<?xml version="1.0"?><plist version="1.0"><dict><key>TeamIdentifier</key><array><string>T1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>T1.com.you.*</string></dict></dict></plist>junk`);
let n = 0; // fresh bytes per test: confirmPassword remembers the last answer for the same files
const ident = (over = {}) => ({ p12: new Uint8Array([0x30, 7, ++n]), profile: appProfile, password: "pw", passwordOk: null, ...over });

test("an unchecked password (synced, seeded, older) is confirmed and saved: the early link then opens", async () => {
  const s = store(ident({ passwordOk: undefined }));
  assert.equal(expectedBundleId(s.get(), { bundleId: "com.altstore.app", keep: true }), null, "unchecked: Ready to Install");
  let notified = 0, checks = 0;
  assert.equal(await confirmPassword({ ...s, check: async () => { checks++; return true; }, notify: () => notified++ }), true);
  assert.deepEqual(s.saves, [{ passwordOk: true }]);
  assert.equal(notified, 1);
  assert.equal(expectedBundleId(s.get(), { bundleId: "com.altstore.app", keep: true }), "com.altstore.app", "straight to iOS's prompt");
  // already known: nothing runs
  assert.equal(await confirmPassword({ ...s, check: async () => { checks++; return true; } }), null);
  assert.equal(checks, 1);
});

test("a wrong password is saved as wrong; the same files aren't checked twice", async () => {
  const id = ident();
  const s = store(id);
  let checks = 0;
  const check = async () => { checks++; return false; };
  assert.equal(await confirmPassword({ ...s, check, notify() {} }), false);
  assert.deepEqual(s.saves, [{ passwordOk: false }]);
  s.set({ passwordOk: null }); // Settings rechecked (its own check can't tell): the answer is remembered
  assert.equal(await confirmPassword({ ...s, check, notify() {} }), false);
  assert.equal(checks, 1);
});

test("no password saved: a .p12 that opens with none gets '', one that doesn't keeps asking (not 'wrong')", async () => {
  const s = store(ident({ password: null }));
  assert.equal(await confirmPassword({ ...s, check: async ({ password }) => password === "", notify() {} }), true);
  assert.deepEqual(s.saves, [{ password: "", passwordOk: true }]);
  const t = store(ident({ password: null }));
  assert.equal(await confirmPassword({ ...t, check: async () => false, notify() {} }), null);
  assert.deepEqual(t.saves, []);
});

test("typed over, picked again or checked while zsign ran: nothing is saved", async () => {
  const s = store(ident());
  assert.equal(await confirmPassword({ ...s, check: async () => { s.set({ password: "pw2" }); return true; }, notify() {} }), null);
  assert.deepEqual(s.saves, []);
  const t = store(ident());
  assert.equal(await confirmPassword({ ...t, check: async () => { t.set({ p12: new Uint8Array([0x30, 9, 9]) }); return true; }, notify() {} }), null);
  const u = store(ident());
  assert.equal(await confirmPassword({ ...u, check: async () => { u.set({ passwordOk: false }); return true; }, notify() {} }), null);
  assert.deepEqual([...t.saves, ...u.saves], []);
});

test("unknown or a Worker that fails: nothing saved; only a .p12 and profile with an unknown password need it", async () => {
  const s = store(ident());
  assert.equal(await confirmPassword({ ...s, check: async () => null, notify() {} }), null);
  assert.equal(await confirmPassword({ ...s, check: async () => { throw new Error("no Worker"); }, notify() {} }), null);
  assert.deepEqual(s.saves, []);
  assert.equal(needsConfirm(ident()), true);
  assert.equal(needsConfirm(ident({ passwordOk: undefined })), true);
  assert.equal(needsConfirm(ident({ passwordOk: true })), false);
  assert.equal(needsConfirm(ident({ passwordOk: false })), false);
  assert.equal(needsConfirm(ident({ profile: null })), false);
  assert.equal(needsConfirm(null), false);
});
