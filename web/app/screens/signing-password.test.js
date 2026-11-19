// F248: Settings > Signing's Password group (settings.js passwordState, takePasswordFocus): the state on the row's
// glyph and in a short footer, and the field focused after a pick leaves the .p12 locked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordState, wantPasswordFocus, takePasswordFocus } from "./settings.js";

const p12 = new Uint8Array([0x30]);
const pick = (extra) => ({ p12, p12Name: "me.p12", ...extra });

test("each state: glyph, placeholder and footer", () => {
  const waiting = passwordState(pick({ passwordOk: false }));
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.glyph, "lock");
  assert.equal(waiting.placeholder, "Password for me.p12");
  assert.equal(waiting.footer, "me.p12 is locked. Type the password it was exported with.");
  assert.equal(passwordState(pick({ password: null, passwordOk: null })).state, "waiting");

  const wrong = passwordState(pick({ password: "nope", passwordOk: false }));
  assert.deepEqual([wrong.state, wrong.glyph, wrong.warn, wrong.footer], ["wrong", "wrong", "Wrong password.", "It doesn't open me.p12."]);

  const right = passwordState(pick({ password: "hunter2", passwordOk: true }));
  assert.deepEqual([right.state, right.glyph, right.footer], ["right", "right", "Opens me.p12."]);

  const none = passwordState(pick({ password: "", passwordOk: true }));
  assert.deepEqual([none.state, none.glyph, none.placeholder, none.footer], ["notNeeded", "right", "Not Needed", "me.p12 has no password."]);

  const kept = passwordState(null, { profile: {} });
  assert.deepEqual([kept.state, kept.glyph, kept.placeholder], ["kept", "kept", "Not Kept"]);

  const empty = passwordState(null, null);
  assert.deepEqual([empty.state, empty.placeholder, empty.footer], ["none", "Required", ""]);

  // typed, and the .p12 can't be checked here: no verdict
  assert.equal(passwordState(pick({ password: "typed", passwordOk: null })).state, "unchecked");
  // no name: the .p12
  assert.equal(passwordState({ p12, passwordOk: null }).placeholder, "Password for the .p12");
});

test("a locked pick focuses the next Password field drawn on that page, once", async () => {
  const el = {}, other = {};
  let focused = 0, scrolled = 0;
  const input = { isConnected: true, focus: (o) => { focused++; assert.deepEqual(o, { preventScroll: true }); }, scrollIntoView: () => { scrolled++; } };
  assert.equal(takePasswordFocus(el, input), false); // nothing asked
  wantPasswordFocus(el);
  assert.equal(takePasswordFocus(other, input), false); // another page's redraw leaves it
  assert.equal(takePasswordFocus(el, input), true);
  assert.equal(takePasswordFocus(el, input), false); // once
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(focused, 1);
  assert.equal(scrolled, 1);
});
