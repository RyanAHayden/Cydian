// F40: native/bridge.js passes the shell's jailbreak type on as ifizboxNative.jailbreak, and bridgeArch reads it.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { bridgeArch } from "./core/settings.js";

const src = readFileSync(join(import.meta.dirname, "../../native/bridge.js"), "utf8");

// What Apt.swift's installScript does: replace @JAILBREAK@ with Jailbreak.kind.
function load(kind) {
  const ctx = vm.createContext({ webkit: { messageHandlers: { ifizbox: { postMessage: () => Promise.resolve(null) } } } });
  const text = kind === undefined ? src : src.replaceAll("@JAILBREAK@", kind);
  vm.runInContext(text.replace("})(globalThis);", "})(this);"), ctx);
  return ctx.ifizboxNative;
}

test("bridge.js: ifizboxNative.jailbreak from the shell's prefix", () => {
  assert.equal(load("rootless").jailbreak, "rootless");
  assert.equal(load("rootful").jailbreak, "rootful");
  assert.equal(bridgeArch(load("rootless")), "iphoneos-arm64");
  assert.equal(bridgeArch(load("rootful")), "iphoneos-arm");
});

test("bridge.js: no jailbreak type when the token isn't filled in (or holds junk)", () => {
  assert.equal(load().jailbreak, undefined);
  assert.equal(load("weird").jailbreak, undefined);
  assert.equal(bridgeArch(load()), null);
});

test("Apt.swift fills in the token bridge.js carries", () => {
  assert.ok(src.includes('"@JAILBREAK@"'));
  const swift = readFileSync(join(import.meta.dirname, "../../native/Sources/Apt.swift"), "utf8");
  assert.match(swift, /replacingOccurrences\(of: "@JAILBREAK@", with: Jailbreak\.kind\)/);
});
