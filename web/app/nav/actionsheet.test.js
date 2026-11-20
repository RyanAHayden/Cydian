// B202: the action sheet answers and leaves the screen whatever its slide-out does. C26 left close() with an
// undefined easing: it threw before answering, so the sheet stayed drawn with dead buttons (View Repo froze the app).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, tick } from "./fakedom.test-helper.js";
import { showActionSheet } from "./actionsheet.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const buttonOf = (label) => document.body.querySelectorAll(".action-button").find((b) => b.textContent === label);

test("a tapped choice answers its index and the sheet goes", async () => {
  const answer = showActionSheet({ title: "T", buttons: ["One", "Two"] });
  assert.ok(document.body.querySelector(".action-scrim"));
  buttonOf("Two").click();
  assert.equal(await answer, 1);
  await tick();
  assert.equal(document.body.querySelector(".action-scrim"), null);
});

test("Cancel answers -1, and a second tap after the first changes nothing", async () => {
  const answer = showActionSheet({ buttons: ["One"] });
  const cancel = buttonOf("Cancel");
  cancel.click();
  buttonOf("One")?.click();
  assert.equal(await answer, -1);
});

test("a slide-out that throws still answers and takes the sheet away", async () => {
  const answer = showActionSheet({ buttons: ["View Repo"] });
  for (const part of [".action-dim", ".action-sheet"]) {
    document.body.querySelector(part).animate = () => { throw new TypeError("no animation"); };
  }
  buttonOf("View Repo").click();
  assert.equal(await answer, 0);
  assert.equal(document.body.querySelector(".action-scrim"), null);
});
