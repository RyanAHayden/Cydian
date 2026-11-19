// F225: the big-screen layout (wide.css). It goes by window width alone, starts at 600px so the phone layout below is
// untouched, and is linked last so it wins over the per-screen sheets at the same specificity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const wide = read("./wide.css");
const html = read("./index.html");
const code = wide.replace(/\/\*[\s\S]*?\*\//g, "");

test("every wide.css rule sits inside one min-width: 600px media query", () => {
  const open = code.indexOf("@media (min-width: 600px) {");
  assert.ok(open >= 0, "no @media (min-width: 600px)");
  assert.equal(code.slice(0, open).trim(), "", "rules before the media query would change the phone layout");
  let depth = 0, end = -1;
  for (let i = code.indexOf("{", open); i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) { end = i; break; }
  }
  assert.ok(end > 0, "unbalanced braces");
  assert.equal(code.slice(end + 1).trim(), "", "rules after the media query would change the phone layout");
});

test("no device sniffing: width only", () => {
  assert.doesNotMatch(code, /device-width|orientation|hover|pointer|-webkit-device-pixel-ratio/);
});

test("index.html links wide.css after every other stylesheet", () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.at(-1), "wide.css");
});

test("content caps at 640px and tab items are 76px, 40px apart", () => {
  assert.match(code, /--wide-cap:\s*640px/);
  assert.match(code, /\.tab\s*\{[^}]*flex:\s*0 0 76px[^}]*margin-left:\s*20px[^}]*margin-right:\s*20px/);
  assert.match(code, /\.tabbar\s*\{[^}]*justify-content:\s*center/);
});
