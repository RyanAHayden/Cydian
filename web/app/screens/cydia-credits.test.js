// C9: we keep Cydia's GPLv3 section icons, purpose badges and its UI wording (typos fixed), and say so in About,
// Credits and the README (About only says not affiliated).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("C9: Credits and the README name both Cydia's icons and its wording, GPLv3, not affiliated", () => {
  const js = read("./home.js");
  const about = js.slice(js.indexOf("async function showAbout"), js.indexOf("// ---- Reload"));
  assert.match(about, /Not affiliated with SaurikIT/);
  const credits = js.slice(js.indexOf("function renderCredits"), js.indexOf("function renderFeatured"));
  for (const re of [/Section Icons/, /Interface Wording/, /purpose badges/, /interface wording/, /GPLv3/,
    /not affiliated with SaurikIT/]) assert.match(credits, re);
  const readme = read("../../../README.md");
  const creditsMd = readme.slice(readme.indexOf("## Credits"), readme.indexOf("## License"));
  for (const re of [/section icons and purpose badges/, /interface wording/, /GPLv3/, /not affiliated/])
    assert.match(creditsMd, re);
  assert.doesNotMatch(readme, /one piece of Cydia's artwork/);
});

test("C9: Cydia's typos are fixed where we show them", () => {
  assert.doesNotMatch(read("../core/sources.js"), /Did not Find/);
  assert.doesNotMatch(read("../core/sources/detect.js"), /Did not Find/);
  assert.doesNotMatch(read("./sources.js"), /for below sources/);
});
