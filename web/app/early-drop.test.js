// B95: a sign that fails (or is cancelled, or comes out under another bundle ID) after iOS was sent to the early link
// tells the Worker (POST /sign/upload/<token>/fail), so iOS's held app.ipa is answered at once instead of leaving a
// blank icon waiting on the Home Screen; the failure text says to delete the icon if it stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInBrowser, dropEarly, iconLeftText } from "./signing-client.js";

const profile = (appId) => new TextEncoder().encode(`junk<?xml version="1.0"?><plist version="1.0"><dict>
<key>TeamIdentifier</key><array><string>TEAM1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM1.${appId}</string></dict></dict></plist>junk`);
const ID = { p12: new Uint8Array([0x30, 1]), profile: profile("com.you.*"), password: "pw", passwordOk: true };
const SELF = "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa";
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function setup({ worker, hudExtra = {} } = {}) {
  const calls = [], alerts = [], opened = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    calls.push(`${init.method ?? "GET"} ${u.pathname}`);
    if (u.pathname === "/api/fetch") return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    if (u.pathname === "/sign/upload") {
      const token = u.searchParams.get("token");
      if (!u.searchParams.has("size")) return json({ token, reserved: true });
      return json({ token: token ?? "t0k", partSize: 8, parts: 1 });
    }
    if (/\/fail$/.test(u.pathname)) return json({ ok: true });
    if (/\/done$/.test(u.pathname)) return json({ itms: "itms-services://?action=download-manifest&url=x" });
    if (/^\/sign\/upload\/\w+\/\d+$/.test(u.pathname)) return json({ ok: true });
    return json({ error: "no" }, 404);
  };
  const deps = {
    hud: () => Object.defineProperties({ set() {}, hide() {}, fail() {} }, Object.getOwnPropertyDescriptors(hudExtra)),
    alert: async (a) => { alerts.push(a); a.onTap?.(1); return { index: 1 }; },
    open: (u) => opened.push(u), go: () => {}, now: () => ID, identity: async () => ID, transfer: async () => null,
    origin: () => "https://ifizbox.example", fetcher, worker,
    watch: () => ({ first: Promise.resolve(), end: Promise.resolve("installed") }),
  };
  return { deps, calls, alerts, opened };
}
const token = (opened) => /%2Fsign%2Fup%2F([0-9a-f]{48})%2F/.exec(opened[0])[1];

test("a sign that fails after the early link opened drops it, and says what to do with the icon", async () => {
  const s = setup({ worker: async () => { throw new Error("zsign: bad password"); } });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, s.deps), false);
  assert.equal(s.opened.length, 1);
  assert.ok(s.calls.includes(`POST /sign/upload/${token(s.opened)}/fail`));
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0].message, /^zsign: bad password\n\n/);
  assert.ok(s.alerts[0].message.endsWith(iconLeftText("iFizBox")));
  assert.match(iconLeftText("iFizBox"), /blank iFizBox icon .* delete it/);
});

test("an app signed under another bundle ID drops the early link before its own alert", async () => {
  const s = setup({ worker: async () => ({ ipa: new Uint8Array([0x50, 0x4b]), bundleId: "com.other.app", name: "X", version: "1" }) });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, s.deps), true);
  const t = token(s.opened);
  assert.ok(s.calls.indexOf(`POST /sign/upload/${t}/fail`) < s.calls.findIndex((c) => /\/done$/.test(c)));
  assert.deepEqual(s.alerts.map((a) => a.title), ["Ready to Install"]);
});

test("the early link that gets the app isn't dropped", async () => {
  const s = setup({ worker: async () => ({ ipa: new Uint8Array([0x50, 0x4b]), bundleId: "com.ryha.ifizbox", name: "iFizBox", version: "1" }) });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, s.deps), true);
  assert.ok(!s.calls.some((c) => /\/fail$/.test(c)));
});

test("Cancel drops the early link, with no alert", async () => {
  let cancel = null;
  const s = setup({ worker: () => new Promise(() => {}), hudExtra: { onCancel: (fn) => { cancel = fn; }, get cancelled() { return Boolean(cancel?.done); } } });
  const p = signInBrowser({ url: SELF, name: "iFizBox" }, s.deps);
  for (let i = 0; i < 50 && !cancel; i++) await new Promise((r) => setTimeout(r, 1));
  await new Promise((r) => setTimeout(r, 5));
  cancel.done = true;
  cancel();
  assert.equal(await p, false);
  assert.ok(s.calls.includes(`POST /sign/upload/${token(s.opened)}/fail`));
  assert.equal(s.alerts.length, 0);
});

test("dropEarly never throws", async () => {
  assert.equal(await dropEarly("ab", { fetcher: async () => { throw new TypeError("Load failed"); } }), false);
  assert.equal(await dropEarly("ab", { fetcher: async () => json({ ok: true }) }), true);
});
