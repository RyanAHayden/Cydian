import { test } from "node:test";
import assert from "node:assert/strict";
import { appSchemeFor, openOutside } from "./applinks.js";

test("appSchemeFor: X profiles and posts, YouTube, GitHub (not Discord); anything else stays a web link", () => {
  assert.equal(appSchemeFor("https://x.com/saurik"), "twitter://user?screen_name=saurik");
  assert.equal(appSchemeFor("https://twitter.com/opa334dev/status/123"), "twitter://status?id=123");
  assert.equal(appSchemeFor("https://x.com/i/flow/login"), null);
  assert.equal(appSchemeFor("https://www.youtube.com/watch?v=abc"), "youtube://www.youtube.com/watch?v=abc");
  assert.equal(appSchemeFor("https://github.com/ProcursusTeam"), "github://github.com/ProcursusTeam");
  assert.equal(appSchemeFor("https://discord.gg/3XASvpjbgp"), null); // Unbound drops the invite on discord://
  assert.equal(appSchemeFor("https://github.com/"), null);
  // files on GitHub stay https (Safari downloads them; the GitHub app can't)
  assert.equal(appSchemeFor("https://github.com/FIZL0/opentennis/releases/download/v1.8.0/opentennis-ios.ipa"), null);
  assert.equal(appSchemeFor("https://github.com/FIZL0/opentennis/releases/latest/download/altstore-source.json"), null);
  assert.equal(appSchemeFor("https://github.com/a/b/archive/refs/heads/main.zip"), null);
  assert.equal(appSchemeFor("https://github.com/a/b/raw/main/app.deb"), null);
  assert.equal(appSchemeFor("https://github.com/FIZL0/opentennis/releases"), "github://github.com/FIZL0/opentennis/releases");
  assert.equal(appSchemeFor("https://github.com/FIZL0/opentennis"), "github://github.com/FIZL0/opentennis");
  assert.equal(appSchemeFor("http://x.com/saurik"), null);
  assert.equal(appSchemeFor("not a url"), null);
});

test("openOutside: Safari when the app didn't come up; never again after a trip away (frozen timer)", () => {
  const run = ({ hide = false, late = 0 } = {}) => {
    const went = [];
    let t = 0, fire, onVis;
    const doc = { visibilityState: "visible", addEventListener: (_, f) => { onVis = f; }, removeEventListener: () => {} };
    openOutside("https://github.com/a/b", { go: (u) => went.push(u), doc, wait: (f) => { fire = f; }, now: () => t });
    if (hide) { doc.visibilityState = "hidden"; onVis(); doc.visibilityState = "visible"; onVis(); }
    t = 1500 + late;
    fire();
    return went;
  };
  assert.deepEqual(run(), ["github://github.com/a/b", "x-safari-https://github.com/a/b"]);
  assert.deepEqual(run({ hide: true }), ["github://github.com/a/b"]);
  assert.deepEqual(run({ late: 60000 }), ["github://github.com/a/b"]);
  const went = [];
  openOutside("https://example.com/", { go: (u) => went.push(u) });
  assert.deepEqual(went, ["x-safari-https://example.com/"]);
});
