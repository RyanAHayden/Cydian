// One segmented control per style (user 2026-11-19): the blue scope bar is nav/ui.js segments(), the grey
// UISegmentedControl is nav/ui.js segmented(); no screen builds either by hand, and the old .segmented is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fakeDocument } from "./fakedom.test-helper.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.document = fakeDocument();
const { segments, segmented } = await import("./ui.js");
const selected = (bs) => bs.filter((b) => b._cls.has("selected")).map((b) => b.textContent);

test("segments(): picks, select() without onPick, show() hides segments, none selected for an unknown value", () => {
  const picked = [];
  const seg = segments(["all", "installed", "x"], { all: "All", installed: "Installed" }, "all", (v) => picked.push(v));
  assert.ok(seg._cls.has("scope-segments"));
  assert.deepEqual(seg.buttons.map((b) => b.textContent), ["All", "Installed", "x"]);
  assert.deepEqual(selected(seg.buttons), ["All"]);
  seg.buttons[1].click();
  assert.deepEqual(picked, ["installed"]);
  assert.deepEqual(selected(seg.buttons), ["Installed"]);
  seg.buttons[1].click();
  assert.deepEqual(picked, ["installed"], "the selected segment again does nothing");
  seg.select(null);
  assert.deepEqual(selected(seg.buttons), []);
  assert.equal(seg.buttons[0].getAttribute("aria-selected"), "false");
  seg.select("x");
  assert.deepEqual(selected(seg.buttons), ["x"]);
  assert.deepEqual(picked, ["installed"], "select() calls no onPick");
  seg.show(["all", "x"]);
  assert.deepEqual(seg.buttons.map((b) => b.hidden), [false, true, false]);
});

test("segmented(): the grey store control; onSelect on a tap, mark() moves the selection", () => {
  const taps = [];
  const c = segmented(["A", "B"], { selected: 1, onSelect: (i) => taps.push(i) });
  assert.ok(c.bar._cls.has("store-segmented"));
  assert.ok(c.buttons.every((b) => b._cls.has("store-segment")));
  assert.deepEqual(selected(c.buttons), ["B"]);
  c.buttons[0].click();
  assert.deepEqual(taps, [0]);
  c.mark(0);
  assert.deepEqual(selected(c.buttons), ["A"]);
});

function files(dir, ext, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === "vendor" || d.name === "node_modules") continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) files(p, ext, out);
    else if (d.name.endsWith(ext) && !d.name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

test("no screen builds a segment button by hand; the old grey .segmented/.segment CSS is gone", () => {
  for (const f of files(APP, ".js")) {
    const src = readFileSync(f, "utf8");
    const rel = f.slice(APP.length + 1);
    if (rel === "nav/ui.js") continue;
    const cls = String.raw`["'\x60][^"'\x60]*\b(?:scope-segments?|store-segment(?:ed)?|segment(?:ed)?)(?![-\w])`;
    for (const re of [new RegExp(String.raw`\b(?:el|make)\(\s*["'][^"']+["']\s*,\s*` + cls), new RegExp(String.raw`className\s*[:=]\s*` + cls)]) {
      assert.doesNotMatch(src, re, `${rel} builds a segmented control by hand: use nav/ui.js segments() or segmented()`);
    }
  }
  for (const f of files(APP, ".css")) {
    const css = readFileSync(f, "utf8");
    assert.doesNotMatch(css, /\.segment(?:ed)?(?![-\w])/, `${f.slice(APP.length + 1)} still styles .segmented/.segment`);
  }
});
