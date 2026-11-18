// F196: the IPA install page's Cancel asks the jailbreak shell to stop ipa.install (Apt.swift ipa.cancel); a
// refusal or a missing call is ignored, and share.js's stand-in (a staged file, every call is share.ipaInstall) is
// never sent it.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { stopIpaInstall } from "./screens/ipa-install.js";

test("stopIpaInstall asks the app's bridge for ipa.cancel and ignores its answer", async () => {
  const calls = [];
  const bridge = { call: (m, p) => { calls.push([m, p]); return Promise.reject(new Error("helper: ifizbox-helper is already installing")); } };
  assert.equal(stopIpaInstall(undefined, { bridge }), true);
  assert.deepEqual(calls, [["ipa.cancel", {}]]);
  await new Promise((r) => setTimeout(r, 0)); // the rejection is caught, not unhandled
});

test("stopIpaInstall: a throwing or missing bridge is fine, and share.js's stand-in gets nothing", () => {
  assert.equal(stopIpaInstall(undefined, { bridge: { call: () => { throw new Error("unknown method"); } } }), false);
  assert.equal(stopIpaInstall(undefined, { bridge: undefined }), false);
  const calls = [];
  const bridge = { call: (m) => { calls.push(m); return new Promise(() => {}); } };
  const standIn = { call: (m) => { calls.push(`stand-in ${m}`); return new Promise(() => {}); } };
  assert.equal(stopIpaInstall(standIn, { bridge }), false);
  assert.deepEqual(calls, []);
});
