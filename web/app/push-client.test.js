import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeBody, keyBytes, support, pushState, when, saved, checkDetail } from "./push-client.js";

test("subscribeBody sends only what the check needs", () => {
  const b = subscribeBody({
    id: "abc",
    subscription: { toJSON: () => ({ endpoint: "https://web.push.apple.com/x", expirationTime: null, keys: { p256dh: "P", auth: "A" } }) },
    sources: [{ key: "deb:https://r/:./", uri: "https://r/", dist: "./", components: [], name: "R", count: 9, origin: "R" }],
    installed: [{ id: "foo", name: "Foo", short: "a tweak", version: "1", installed: "1", held: false, icon: "x" },
      { id: "bar", version: "2", installed: "2", held: true }],
    holds: ["foo"], arch: "iphoneos-arm64",
  });
  assert.deepEqual(b, {
    id: "abc", subscription: { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "P", auth: "A" } },
    arch: "iphoneos-arm64", sources: [{ uri: "https://r/", dist: "./", components: [] }],
    installed: [{ id: "foo", version: "1" }, { id: "bar", version: "2", held: true }], holds: ["foo"],
  });
  assert.equal(subscribeBody({ arch: "iphoneos-arm" }).subscription, null);
});

test("keyBytes decodes base64url", () => {
  assert.deepEqual([...keyBytes("_-8")], [255, 239]);
  assert.equal(keyBytes("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").length, 65);
});

test("pushState: iOS Safari tabs are told to add to the Home Screen", () => {
  const safariTab = support({ navigator: { userAgent: "iPhone OS 18", serviceWorker: {} }, matchMedia: () => ({ matches: false }) });
  assert.equal(pushState(safariTab, { id: "x" }), "Add to Home Screen");
  const homeScreen = support({ navigator: { userAgent: "iPhone", serviceWorker: {}, standalone: true },
    PushManager: {}, Notification: { permission: "granted" } });
  assert.equal(pushState(homeScreen, { id: "x", push: true }), "On");
  assert.equal(pushState(homeScreen, { id: "x", push: false }), "Off");
  assert.equal(pushState({ ...homeScreen, permission: "denied" }, { id: "x" }), "Blocked");
  assert.equal(pushState(support({ navigator: {} }), { id: "x" }), "Not Supported");
});

test("when and saved", () => {
  assert.equal(when(null), "Never");
  const t = Date.UTC(2026, 10, 17, 12) / 1000;
  assert.match(when(t, t * 1000, "en-US"), /^Today, /);
  assert.match(when(t, t * 1000 + 3 * 86400e3, "en-US"), /^Nov 17, /);
  assert.equal(saved({ getItem: () => "{bad" }), null);
  assert.deepEqual(saved({ getItem: () => '{"id":"a","feed":"f"}' }), { id: "a", feed: "f" });
});

test("F34: device mode sends the subscription and nothing of the lists", () => {
  const b = subscribeBody({
    id: "abc", mode: "device", arch: "iphoneos-arm64",
    subscription: { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "P", auth: "A" } },
    sources: [{ uri: "https://r/", dist: "./" }], installed: [{ id: "foo", installed: "1" }], holds: ["foo"],
  });
  assert.deepEqual(b, { id: "abc", mode: "device", arch: "iphoneos-arm64", sources: [], installed: [], holds: [],
    subscription: { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "P", auth: "A" } } });
});

test("F34: checkDetail", () => {
  const now = Date.UTC(2026, 10, 17, 12);
  assert.equal(checkDetail(null, now), "Never");
  assert.match(checkDetail({ t: now - 60000, ms: 3140, outcome: "ok" }, now), /^Today, .*, 3\.1 s$/);
  assert.match(checkDetail({ t: now, ms: 20000, outcome: "timeout" }, now), /Timed Out$/);
  assert.match(checkDetail({ t: now, ms: 10, outcome: "error" }, now), /Failed$/);
});
