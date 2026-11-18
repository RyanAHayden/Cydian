// B15: index.html's inline deep-path script sends /a/b to /#/a/b, so the page's relative files load from the root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = /<script id="deep-path">([\s\S]*?)<\/script>/.exec(html)[1];

// Where the page goes from url, or null when it stays.
function run(url) {
  const u = new URL(url);
  let to = null;
  const location = { protocol: u.protocol, pathname: u.pathname, search: u.search, hash: u.hash, replace: (x) => { to = x; } };
  vm.runInNewContext(code, { location });
  return to;
}

test("the deep-path script runs before any relative file", () => {
  assert.ok(html.indexOf('id="deep-path"') < html.indexOf('src="theme-boot.js"'));
  assert.ok(html.indexOf('id="deep-path"') < html.indexOf('href="style.css"'));
});

test("a deep path becomes the route at the root", () => {
  assert.equal(run("https://cydian.dev/settings/signing"), "/#/settings/signing");
  assert.equal(run("https://cydian.dev/settings/"), "/#/settings");
  assert.equal(run("https://cydian.dev/a/b/c?x=1"), "/?x=1#/a/b/c");
  assert.equal(run("http://localhost:8787/sources/x"), "/#/sources/x");
});

test("a deep path with a route keeps the route", () => {
  assert.equal(run("https://cydian.dev/settings/signing#/home"), "/#/home");
});

test("a deep /add link keeps its source", () => {
  assert.equal(run("https://cydian.dev/x/add?url=https%3A%2F%2Frepo.example"), "/add?url=https%3A%2F%2Frepo.example");
  assert.equal(run("https://cydian.dev/x/add/"), "/add");
});

test("root and one-level paths stay, as does the app's scheme", () => {
  for (const u of ["https://cydian.dev/", "https://cydian.dev/#/sources", "https://cydian.dev/index.html",
    "https://cydian.dev/add?url=x", "https://cydian.dev/settings", "ifizbox://app/index.html#/home"]) {
    assert.equal(run(u), null, u);
  }
});
