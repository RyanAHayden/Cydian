// F144: Add Source asks for an APT URL only where APT repos are kept; the sideload app and the Not Jailbroken site
// ask for an app source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aptKept, addSourceText } from "./manage.js";

test("APT is kept in the jailbreak app and the jailbroken site only", () => {
  assert.equal(aptKept("jailbreak"), true);
  assert.equal(aptKept("sideload"), false);
  assert.equal(aptKept("site", () => true), true);
  assert.equal(aptKept("site", () => false), false);
});

test("the alert names what Add takes", () => {
  assert.equal(addSourceText(true).title, "Enter APT URL");
  assert.equal(addSourceText(false).title, "Enter Source URL");
  assert.doesNotMatch(addSourceText(false).message, /APT|Or /);
});
