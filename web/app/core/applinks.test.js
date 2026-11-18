import { test } from "node:test";
import assert from "node:assert/strict";
import { appSchemeFor } from "./applinks.js";

test("appSchemeFor: X profiles and posts, YouTube, GitHub (not Discord); anything else stays a web link", () => {
  assert.equal(appSchemeFor("https://x.com/saurik"), "twitter://user?screen_name=saurik");
  assert.equal(appSchemeFor("https://twitter.com/opa334dev/status/123"), "twitter://status?id=123");
  assert.equal(appSchemeFor("https://x.com/i/flow/login"), null);
  assert.equal(appSchemeFor("https://www.youtube.com/watch?v=abc"), "youtube://www.youtube.com/watch?v=abc");
  assert.equal(appSchemeFor("https://github.com/ProcursusTeam"), "github://github.com/ProcursusTeam");
  assert.equal(appSchemeFor("https://discord.gg/3XASvpjbgp"), null); // Unbound drops the invite on discord://
  assert.equal(appSchemeFor("https://github.com/"), null);
  assert.equal(appSchemeFor("http://x.com/saurik"), null);
  assert.equal(appSchemeFor("not a url"), null);
});
