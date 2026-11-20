// ElleKit (web/app/vendor/ellekit) is bundled for tweak injection: Credits and the README name it and its licence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("Credits and the README name ElleKit, BSD-3-Clause, and its author", () => {
  const js = read("./home.js");
  const credits = js.slice(js.indexOf("function renderCredits"), js.indexOf("function renderFeatured"));
  for (const re of [/"ElleKit"/, /BSD-3-Clause/, /Évelyne Bélanger/, /tweak/i]) assert.match(credits, re);
  const readme = read("../../../README.md");
  const creditsMd = readme.slice(readme.indexOf("## Credits"), readme.indexOf("## License"));
  for (const re of [/ElleKit/, /BSD-3-Clause/, /web\/app\/vendor\/ellekit\//]) assert.match(creditsMd, re);
  assert.match(read("../vendor/ellekit/LICENSE"), /Évelyne Bélanger/);
});
