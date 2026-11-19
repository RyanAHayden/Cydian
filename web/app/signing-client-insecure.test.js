// B104: an http IPA link in the sideload app. The shell tries the https twin; with none it answers "insecure", and
// This Download Is Not Secure asks: Install Anyway sends the call again with insecure: true, Cancel ends it quietly.
// Every way in: Install (signing.install), the IPA queue (signing.prepare), Custom Install (signing.inspect) and
// My IPAs' Add (library.add).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askInsecure, installOnDevice, prepareOnDevice, libraryCall } from "./signing-client.js";
import { inspectAndInstall } from "./signing-sheet.js";
import { INSECURE_IPA_ALERT } from "./core/insecureipa.js";

const coded = (code, message) => Object.assign(new Error(message), { code });
const noTwin = () => coded("insecure", "e.example offers this IPA only over plain http, without encryption");

// A bridge whose `method` answers "insecure" unless the call says insecure: true; then `answer`.
function fakeNative(method, answer, { twin = false } = {}) {
  const calls = [];
  return {
    mode: "sideload",
    calls,
    async call(m, params) {
      calls.push({ method: m, params });
      if (m === "signing.route" || m === "idevice.status") return null;
      if (m !== method) return null;
      if (!twin && params?.insecure !== true) throw noTwin();
      return answer;
    },
  };
}
const alerts = (index) => {
  const shown = [];
  return { shown, alert: async (a) => { shown.push(a); return { index }; } };
};

test("askInsecure: the https twin worked: no alert, one call without insecure", async () => {
  const a = alerts(1);
  const sent = [];
  assert.equal(await askInsecure(async (x) => { sent.push(x); return "ok"; }, a), "ok");
  assert.deepEqual(sent, [{}]);
  assert.equal(a.shown.length, 0);
});

test("askInsecure: no twin + Install Anyway: the alert, then the call again with insecure: true", async () => {
  const a = alerts(1);
  const sent = [];
  const r = await askInsecure(async (x) => { sent.push(x); if (!x.insecure) throw noTwin(); return "ok"; }, a);
  assert.equal(r, "ok");
  assert.deepEqual(sent, [{}, { insecure: true }]);
  assert.deepEqual(a.shown, [INSECURE_IPA_ALERT]);
});

test("askInsecure: no twin + Cancel: rejects with code cancelled, no second call", async () => {
  const a = alerts(0);
  const sent = [];
  await assert.rejects(askInsecure(async (x) => { sent.push(x); throw noTwin(); }, a), (e) => e.code === "cancelled");
  assert.deepEqual(sent, [{}]);
});

test("askInsecure: other errors pass through without the alert", async () => {
  const a = alerts(1);
  await assert.rejects(askInsecure(async () => { throw coded("too_large", "big"); }, a), (e) => e.code === "too_large");
  assert.equal(a.shown.length, 0);
});

test("askInsecure: a link let through once in this session goes straight to http (look, then queue)", async () => {
  const url = "http://once.example/a.ipa";
  const a = alerts(1);
  await askInsecure(async (x) => { if (!x.insecure) throw noTwin(); return 1; }, { ...a, url });
  const sent = [];
  await askInsecure(async (x) => { sent.push(x); return 2; }, { ...a, url });
  assert.deepEqual(sent, [{ insecure: true }]);
  assert.equal(a.shown.length, 1);
});

function hud() {
  const h = { labels: [], hidden: 0 };
  h.make = (t) => { h.labels.push(t); return { set: (x) => h.labels.push(x), hide: () => { h.hidden++; } }; };
  return h;
}

test("Install: http without a twin, Install Anyway: signing.install again with insecure: true, and it installs", async () => {
  const url = "http://install.example/x.ipa";
  const n = fakeNative("signing.install", { name: "X" });
  const a = alerts(1);
  const h = hud();
  const later = [];
  assert.equal(await installOnDevice({ url, name: "X" }, { native: n, hud: h.make, alert: a.alert, later: (f, ms) => later.push(ms), follow: () => {} }), true);
  const installs = n.calls.filter((c) => c.method === "signing.install");
  assert.equal(installs.length, 2);
  assert.equal(installs[0].params.insecure, undefined);
  assert.equal(installs[0].params.url, url);
  assert.equal(installs[1].params.insecure, true);
  assert.deepEqual(a.shown, [INSECURE_IPA_ALERT]);
});

test("Install: http without a twin, Cancel: nothing more is sent, no error alert, the page goes", async () => {
  const n = fakeNative("signing.install", { name: "X" });
  const a = alerts(0);
  const h = hud();
  assert.equal(await installOnDevice({ url: "http://cancel.example/x.ipa", name: "X" }, { native: n, hud: h.make, alert: a.alert, later: () => {} }), false);
  assert.equal(n.calls.filter((c) => c.method === "signing.install").length, 1);
  assert.deepEqual(a.shown, [INSECURE_IPA_ALERT], "only the question, no Couldn't Install after it");
  assert.equal(h.hidden, 1);
});

test("Install: an https link redirected to http (code ats) gets our words, never iOS's", async () => {
  const n = { mode: "sideload", calls: [], async call(m) { if (m === "signing.install") throw coded("ats", "the link leads to a plain http address (x.example), which iOS blocks here"); return null; } };
  const a = alerts(0);
  assert.equal(await installOnDevice({ url: "https://ats.example/x.ipa", name: "X" }, { native: n, hud: hud().make, alert: a.alert, later: () => {} }), false);
  assert.equal(a.shown[0].title, "Download Not Secure");
  assert.doesNotMatch(a.shown[0].message, /App Transport Security/);
});

test("the IPA queue's signing.prepare asks too, and Cancel ends the row as cancelled", async () => {
  const job = { id: "com.x", name: "X", url: "http://queue.example/x.ipa", options: {} };
  const n = fakeNative("signing.prepare", { token: "t" });
  assert.deepEqual(await prepareOnDevice(job, { tag: "a", native: n, alert: alerts(1).alert }), { token: "t" });
  const sent = n.calls.filter((c) => c.method === "signing.prepare").map((c) => c.params.insecure);
  assert.deepEqual(sent, [undefined, true]);
  const n2 = fakeNative("signing.prepare", { token: "t" });
  await assert.rejects(prepareOnDevice({ ...job, url: "http://queue2.example/x.ipa" }, { tag: "b", native: n2, alert: alerts(0).alert }), (e) => e.code === "cancelled");
});

test("My IPAs' Add (library.add) asks; other library calls are sent as before", async () => {
  const n = fakeNative("library.add", { file: "x.ipa" });
  assert.deepEqual(await libraryCall("add", { url: "http://lib.example/x.ipa" }, null, n, { alert: alerts(1).alert }), { file: "x.ipa" });
  assert.deepEqual(n.calls.map((c) => c.params.insecure), [undefined, true]);
  const n2 = fakeNative("library.list", { ipas: [] }, { twin: true });
  await libraryCall("list", {}, null, n2);
  assert.equal(n2.calls.length, 1);
  assert.equal("insecure" in n2.calls[0].params, false);
});

test("Custom Install's look (signing.inspect): Cancel on the alert closes quietly", async () => {
  const n = fakeNative("signing.inspect", { token: "t", app: {} });
  const a = alerts(0);
  const h = hud();
  assert.equal(await inspectAndInstall({ url: "http://look.example/x.ipa", name: "X" }, { native: n, hud: h.make, alert: a.alert, sheet: () => () => {} }), false);
  assert.deepEqual(a.shown, [INSECURE_IPA_ALERT]);
  assert.equal(h.hidden, 1);
});
