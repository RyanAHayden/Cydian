// B48: the app page's Install row (altstore.js installRows) runs on a tap only: a scroll that starts on it, or a drag
// across it, never installs (nav/tapguard.js guards the rows).
import { test } from "node:test";
import assert from "node:assert/strict";

const { installRows } = await import("./altstore.js");

// A document that only needs to take the guard's capture listeners; there before altstore.js builds any row (the
// guard starts with the first guarded row).
const on = {};
globalThis.document = { addEventListener(t, f) { (on[t] ??= []).push(f); }, removeEventListener() {} };
const fire = (t, e = {}) => { const ev = { type: t, detail: 1, pointerId: 1, isPrimary: true, clientX: 160, clientY: 400,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...e };
for (const f of on[t] ?? []) f(ev); return ev; };

const V = { version: "1.2", downloadURL: "https://example.com/Delta.ipa" };

function rows() {
  const installs = [];
  const { rows } = installRows(V, null, () => {}, () => {}, null, "Delta",
    { site: false, jailbreak: true, custom: false, ipaInstall: (o) => installs.push(o.url) });
  return { install: rows.find((r) => r.label === "Install"), installs };
}

test("a scroll that starts on Install never installs; a tap does", () => {
  const { install, installs } = rows();
  fire("pointerdown");
  fire("pointermove", { clientY: 396 });
  fire("scroll");                              // the page body moved under the finger
  fire("pointerup", { clientY: 398 });
  install.onClick(fire("click"));
  assert.deepEqual(installs, []);

  fire("pointerdown"); fire("touchmove", { touches: [{ clientX: 160, clientY: 370 }] }); fire("pointerup", { clientY: 400 });
  install.onClick(fire("click"));
  assert.deepEqual(installs, [], "a drag of 30 px");

  fire("pointerdown"); fire("pointerup");
  install.onClick(fire("click"));
  assert.deepEqual(installs, [V.downloadURL]);
});
