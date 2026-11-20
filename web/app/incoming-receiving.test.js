// B163: a file another app handed over is copied in with a live "Copying" HUD (the shell's "ifizbox:receiving").
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { onReceiving } from "./incoming.js";

function fakeHUD() {
  const log = [];
  const hud = (text) => {
    log.push(["show", text]);
    return { set: (t) => log.push(["set", t]), hide: () => log.push(["hide"]), done: () => log.push(["done"]) };
  };
  return { hud, log };
}

test("one HUD from the first progress to the end, its label following the percent", () => {
  const { hud, log } = fakeHUD();
  const r = onReceiving({ hud });
  r({ name: "Yingxia-1.8.26-ios.ipa", progress: 0 });
  r({ name: "Yingxia-1.8.26-ios.ipa", progress: 0.42 });
  r({ name: "Yingxia-1.8.26-ios.ipa", progress: 0.999 });
  r({ name: "Yingxia-1.8.26-ios.ipa", progress: null });
  assert.deepEqual(log, [
    ["show", "Copying Yingxia-1.8.26-ios.ipa… 0%"],
    ["set", "Copying Yingxia-1.8.26-ios.ipa… 42%"],
    ["set", "Copying Yingxia-1.8.26-ios.ipa… 100%"],
    ["hide"],
  ]);
});

test("an end without a start (a failure before copying) shows nothing; a second file gets a new HUD", () => {
  const { hud, log } = fakeHUD();
  const r = onReceiving({ hud });
  r({ name: "A.ipa", progress: null });
  r(undefined);
  assert.deepEqual(log, []);
  r({ name: "A.ipa", progress: 0.5 });
  r({ name: "A.ipa" });
  r({ name: "B.ipa", progress: 0 });
  assert.deepEqual(log, [["show", "Copying A.ipa… 50%"], ["hide"], ["show", "Copying B.ipa… 0%"]]);
});
