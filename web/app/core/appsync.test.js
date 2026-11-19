// F189: core/appsync.js, the words and checks for getting AppSync Unified before an IPA install.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPSYNC_ID, APPSYNC_SOURCE, APPSYNC_PAGE, appSyncInstalled, sameSource, appSyncFailure, FALLBACK_BUTTONS,
  TRY_AGAIN, OPEN_SOURCE, afterAppSyncNote } from "./appsync.js";

const stanza = (pkg, status = "install ok installed", extra = "") =>
  `Package: ${pkg}\nStatus: ${status}\nArchitecture: iphoneos-arm64\nVersion: 116.0\n${extra}`;

test("appSyncInstalled: by its id, or a package providing it, and only when dpkg says installed", () => {
  assert.equal(appSyncInstalled(""), false);
  assert.equal(appSyncInstalled(null), false);
  assert.equal(appSyncInstalled([stanza("com.example.a"), stanza(APPSYNC_ID)].join("\n\n")), true);
  assert.equal(appSyncInstalled(stanza(APPSYNC_ID, "deinstall ok config-files")), false);
  assert.equal(appSyncInstalled(stanza(APPSYNC_ID, "install ok half-configured")), false);
  // 116.0's own control: Provides: appsync, net.angelxwind.appsyncunified
  assert.equal(appSyncInstalled(stanza("com.example.fork", undefined, "Provides: appsync (= 1), other\n")), true);
  assert.equal(appSyncInstalled(stanza("com.example.fork", undefined, "Provides: net.angelxwind.appsyncunified\n")), true);
  assert.equal(appSyncInstalled(stanza("com.example.other", undefined, "Provides: appsyncish\n")), false);
  // a field further down mentioning the id isn't the package
  assert.equal(appSyncInstalled(stanza("com.example.x", undefined, `Depends: ${APPSYNC_ID}\n`)), false);
});

test("sameSource: akemi's repo however it was typed, nothing else", () => {
  for (const u of [APPSYNC_SOURCE, "http://cydia.akemi.ai", "cydia.akemi.ai/", "https://www.cydia.akemi.ai//"]) assert.equal(sameSource(u), true, u);
  for (const u of ["https://cydia.akemi.ai.evil.example/", "https://repo.example/akemi/", "https://cydia.akemi.ai/beta/", "", null]) {
    assert.equal(sameSource(u), false, String(u));
  }
});

test("appSyncFailure: one plain sentence per step, never apt's raw words, and the three buttons", () => {
  assert.deepEqual(FALLBACK_BUTTONS, ["Try Again", "Open Source", "OK"]);
  assert.equal(FALLBACK_BUTTONS[TRY_AGAIN], "Try Again");
  assert.equal(FALLBACK_BUTTONS[OPEN_SOURCE], "Open Source");
  assert.equal(appSyncFailure("refresh").message, "Couldn't refresh cydia.akemi.ai.");
  assert.equal(appSyncFailure("add").message, "Couldn't add cydia.akemi.ai.");
  assert.equal(appSyncFailure("install").message, "Couldn't install AppSync Unified.");
  assert.match(appSyncFailure("missing").message, /doesn't list AppSync Unified/);
  assert.equal(appSyncFailure("nonsense").message, "Couldn't install AppSync Unified.");
  for (const step of ["add", "refresh", "missing", "install", "refused", "absent"]) {
    const f = appSyncFailure(step);
    assert.deepEqual(f.buttons, FALLBACK_BUTTONS);
    assert.equal(f.message.split(/(?<=\.)\s/).length, 1, f.message); // one sentence
    assert.doesNotMatch(f.message, /ldid|apt-get|E:/);
  }
  assert.match(APPSYNC_PAGE, /^https:\/\/cydia\.akemi\.ai\/.*ai\.akemi\.appsyncunified$/);
});

test("afterAppSyncNote names the IPA that follows", () => {
  assert.match(afterAppSyncNote("opentennis-ios"), /opentennis-ios installs right after it\.$/);
  assert.match(afterAppSyncNote(""), /The IPA installs right after it\.$/);
});
