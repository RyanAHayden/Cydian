// F151: the install progress page's line classes, auto-scroll and finish button (core/progress.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, hudLine, createFollow, packageKind, chooseFinish } from "./progress.js";
import { parseStatusLine, finishOf } from "./queue.js";

test("classify: apt's status fd lines are steps, with the package and the percent", () => {
  assert.deepEqual(classify({ fd: "status", line: "pmstatus:com.ex.tweak:40.0:Installing com.ex.tweak" }),
    { kind: "step", text: "Installing com.ex.tweak", pkg: "com.ex.tweak", percent: 40 });
  assert.deepEqual(classify({ fd: "status", line: "dlstatus:1:12.5:Downloading com.ex.tweak" }),
    { kind: "step", text: "Downloading com.ex.tweak", pkg: "1", percent: 12.5, download: true });
  assert.deepEqual(classify({ fd: "status", line: "status: com.ex.tweak: unpacked" }),
    { kind: "step", text: "com.ex.tweak: unpacked", pkg: "com.ex.tweak" });
  assert.deepEqual(classify({ fd: "status", line: "processing: install: com.ex.tweak" }),
    { kind: "step", text: "install com.ex.tweak", pkg: "com.ex.tweak" });
});

test("classify: pmerror is an error, pmconffile a question, finish: a level, anything else on the fd raw", () => {
  assert.deepEqual(classify({ fd: "status", line: "pmerror:com.ex.bad:60:subprocess installed post-installation script returned error exit status 1" }),
    { kind: "error", text: "subprocess installed post-installation script returned error exit status 1", pkg: "com.ex.bad" });
  assert.deepEqual(classify({ fd: "status", line: "pmconffile:/var/jb/etc/x.conf:50:'old' 'new' 1 1" }),
    { kind: "conffile", file: "/var/jb/etc/x.conf", percent: 50 });
  assert.deepEqual(classify({ fd: "status", line: "finish:restart" }), { kind: "finish", finish: "restart" });
  assert.deepEqual(classify({ fd: "status", line: "finish:uicache" }), { kind: "finish", finish: "uicache" });
  assert.deepEqual(classify({ fd: "status", line: "finish:explode" }), { kind: "raw", text: "finish:explode" });
  assert.equal(classify({ fd: "status", line: "   " }), null);
});

test("classify: dpkg's and apt's own output is raw (monospace); E:, dpkg errors and the helper's complaints are red", () => {
  for (const line of ["Selecting previously unselected package com.ex.tweak.", "Preparing to unpack .../tweak.deb ...",
    "Unpacking com.ex.tweak (1.0) ...", "Setting up com.ex.tweak (1.0) ...", "Reading package lists...", "Get:1 https://repo ./ tweak 1.0 [12 kB]"]) {
    assert.deepEqual(classify({ fd: "out", line }), { kind: "raw", text: line });
  }
  assert.equal(classify({ fd: "err", line: "E: Unable to locate package nope" }).kind, "error");
  assert.equal(classify({ fd: "err", line: "dpkg: error processing package x (--configure):" }).kind, "error");
  assert.equal(classify({ fd: "err", line: "Errors were encountered while processing:" }).kind, "error");
  assert.equal(classify({ fd: "err", line: "ifizbox-helper: not a regular file" }).kind, "error");
  assert.equal(classify({ fd: "err", line: "ifizbox-helper: cancelled: stopping apt-get" }).kind, "raw");
  assert.equal(classify({ fd: "err", line: "W: Some index files failed to download." }).kind, "warning");
  assert.equal(classify({ fd: "out", line: "dpkg: warning: downgrading x from 2 to 1" }).kind, "warning");
});

test("classify: only the text after the last carriage return shows; blank lines show nothing", () => {
  assert.deepEqual(classify({ fd: "out", line: "10%\r50%\r100% done" }), { kind: "raw", text: "100% done" });
  assert.equal(classify({ fd: "out", line: "" }), null);
  assert.equal(classify({ fd: "out", line: "\r" }), null);
});

test("hudLine: a HUD's label without its percent, which moves the bar", () => {
  assert.deepEqual(hudLine("Downloading 45%"), { text: "Downloading", percent: 45 });
  assert.deepEqual(hudLine("Uploading 100%"), { text: "Uploading", percent: 100 });
  assert.deepEqual(hudLine("Installing (12%)"), { text: "Installing", percent: 12 });
  assert.deepEqual(hudLine("Signing"), { text: "Signing", percent: null });
  assert.deepEqual(hudLine("Installing 3 of 5"), { text: "Installing 3 of 5", percent: null });
  assert.deepEqual(hudLine("50%"), { text: "50%", percent: null });
});

test("createFollow: follows the newest line until the user scrolls up, and again once back at the bottom", () => {
  const f = createFollow({ slack: 32 });
  assert.equal(f.shouldScroll(), true);
  f.scrolled({ top: 900, height: 1500, client: 600 }); // at the bottom (the page's own scroll)
  assert.equal(f.shouldScroll(), true);
  f.touch(true);
  assert.equal(f.shouldScroll(), false, "never moves the page under a finger");
  f.scrolled({ top: 500, height: 1500, client: 600 });
  f.touch(false, { top: 500, height: 1500, client: 600 });
  assert.equal(f.following, false);
  assert.equal(f.shouldScroll(), false, "stays where the reader is while lines come in");
  f.scrolled({ top: 880, height: 1500, client: 600 }); // within the slack of the bottom
  assert.equal(f.shouldScroll(), true);
  f.scrolled({ top: 0, height: 2000, client: 600 });
  assert.equal(f.shouldScroll(), false);
  f.jump();
  assert.equal(f.shouldScroll(), true);
});

test("createFollow: a finger lifted at the bottom follows again; a momentum scroll up after it stops following", () => {
  const f = createFollow();
  f.touch(true);
  f.touch(false, { top: 1400, height: 2000, client: 600 });
  assert.equal(f.shouldScroll(), true);
  f.scrolled({ top: 1200, height: 2000, client: 600 });
  assert.equal(f.shouldScroll(), false);
});

test("packageKind: tweaks by their hooking library or section, apps by section or tag", () => {
  assert.equal(packageKind([{ package: "com.ex.t", depends: "mobilesubstrate (>= 0.9)" }]), "tweak");
  assert.equal(packageKind([{ package: "com.ex.t", depends: "ellekit | mobilesubstrate" }]), "tweak");
  assert.equal(packageKind([null, { package: "com.ex.theme", section: "Themes (SpringBoard)" }]), "tweak");
  assert.equal(packageKind([{ package: "com.ex.t", section: "Tweaks" }]), "tweak");
  assert.equal(packageKind([{ package: "com.ex.app", section: "Applications" }]), "app");
  assert.equal(packageKind([{ package: "com.ex.game", section: "Games" }]), "app");
  assert.equal(packageKind([{ package: "com.ex.app", section: "Utilities", tag: "purpose::uikit, role::app" }]), "app");
  assert.equal(packageKind([{ package: "com.ex.lib", section: "Development", depends: "firmware (>= 15.0)" }]), "package");
  assert.equal(packageKind([]), "package");
});

test("chooseFinish: Return by default; Restart SpringBoard for a tweak; Reload Data for an app; the highest wins", () => {
  assert.deepEqual(chooseFinish({}), { level: "return", label: "Return to iFizBox", uicache: false });
  assert.deepEqual(chooseFinish({ kinds: ["package"] }), { level: "return", label: "Return to iFizBox", uicache: false });
  assert.deepEqual(chooseFinish({ kinds: ["tweak"] }), { level: "restart", label: "Restart SpringBoard", uicache: false });
  assert.deepEqual(chooseFinish({ kinds: ["app"] }), { level: "uicache", label: "Reload Data", uicache: false });
  // an app and a tweak in one run: Restart SpringBoard, the icon cache rebuilt first
  assert.deepEqual(chooseFinish({ kinds: ["app", "tweak"] }), { level: "restart", label: "Restart SpringBoard", uicache: true });
});

test("chooseFinish: the maintainer scripts' finish: lines, as Cydia reads them", () => {
  const levels = (lines) => lines.map(parseStatusLine).filter((s) => s.type === "finish").map((s) => s.finish);
  assert.equal(chooseFinish({ levels: levels(["finish:restart"]) }).label, "Restart SpringBoard");
  assert.equal(chooseFinish({ levels: levels(["finish:uicache"]) }).label, "Reload Data");
  assert.equal(chooseFinish({ levels: levels(["finish:reboot", "finish:restart"]), kinds: ["tweak"] }).label, "Reboot Device");
  assert.equal(chooseFinish({ levels: levels(["finish:reload"]) }).label, "Reload SpringBoard");
  assert.equal(chooseFinish({ levels: levels(["finish:reopen"]) }).label, "Close iFizBox");
  assert.equal(chooseFinish({ levels: ["uicache", "restart"] }).uicache, true);
  assert.equal(chooseFinish({ levels: ["reboot"], kinds: ["app"] }).uicache, true);
  assert.equal(finishOf("uicache", "return"), "uicache");
  assert.equal(finishOf("uicache", "reopen"), "reopen");
});

test("chooseFinish: a failed run, the sideload IPA and the website only return", () => {
  assert.equal(chooseFinish({ ok: false, kinds: ["tweak"], levels: ["reboot"] }).level, "return");
  assert.equal(chooseFinish({ build: "sideload", kinds: ["tweak"] }).level, "return");
  assert.equal(chooseFinish({ build: "site", levels: ["restart"] }).level, "return");
});
