import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToken, token, pageOf, nav, withBase, escapeHtml, installedAppSection } from "./browse.js";
import { sizeText as formatSize } from "../core/appqueue.js";
import { withLetterHeaders } from "../nav/vlist.js";
import { parse, format } from "../router.js";

const KEY = "deb:https://repo.example/:./";

test("routes below Sources and Search name their page", () => {
  assert.deepEqual(parseToken("section:Tweaks"), { kind: "section", value: "Tweaks" });
  assert.deepEqual(parseToken("author:Jay Freeman (saurik)"), { kind: "author", value: "Jay Freeman (saurik)" });
  assert.deepEqual(parseToken("package:com.a:b"), { kind: "package", value: "com.a:b" });
  assert.equal(parseToken("nonsense").kind, "unknown");
  assert.deepEqual(pageOf({ tab: "sources", path: [KEY] }), { key: KEY, page: "sections" });
  assert.deepEqual(pageOf({ tab: "sources", path: ["*", token("section", "*")] }), { key: "*", page: "section", value: "*" });
  assert.deepEqual(pageOf({ tab: "search", path: [token("package", "x")] }), { key: "*", page: "package", value: "x" });
  // a source key full of ':' and '/' survives the hash round trip
  const hash = format({ tab: "sources", path: [KEY, token("section", "Themes (SpringBoard)"), token("package", "com.x")] });
  assert.deepEqual(pageOf(parse(hash)), { key: KEY, page: "package", value: "com.x" });
  assert.equal(parse(hash).path[0], KEY);
});

test("titles: source name, All Packages, section, author", () => {
  assert.equal(nav({ tab: "sources", path: [KEY] }, () => "Example").title, "Example");
  assert.equal(nav({ tab: "sources", path: ["*"] }).title, "Sections");
  assert.equal(nav({ tab: "sources", path: ["*"] }).right.label, "Edit"); // Section Visibility (F24)
  assert.equal(nav({ tab: "sources", path: ["*", "section:*"] }).right, undefined);
  assert.equal(nav({ tab: "sources", path: ["*", "section:*"] }).title, "All Packages");
  assert.equal(nav({ tab: "sources", path: ["*", "section:Tweaks"] }).title, "Tweaks");
  assert.equal(nav({ tab: "search", path: ["author:Jane"] }).title, "Jane");
  assert.equal(nav({ tab: "search", path: ["package:com.unseen"] }).title, "com.unseen", "id until the name is known");
});

test("sizes, letter headers and proxied depiction HTML", () => {
  assert.equal(formatSize(109 * 1024), "109 kB");
  assert.equal(formatSize(4938586), "4.7 MB");
  assert.equal(formatSize(10), "1 kB");
  assert.equal(formatSize("x"), null);
  const rows = [{ n: "Alpha" }, { n: "apple" }, { n: "Bravo" }, { n: "3D" }];
  assert.deepEqual(withLetterHeaders(rows, (r) => r.n[0].toUpperCase()).map((r) => r.header ?? r.n),
    ["A", "Alpha", "apple", "B", "Bravo", "3", "3D"]);
  assert.equal(withBase("<html><head><title>t</title></head></html>", "http://x/a?b=1&c=\"2\""),
    '<html><head><base href="http://x/a?b=1&amp;c=&quot;2&quot;" target="_blank"><title>t</title></head></html>');
  assert.equal(withBase("<p>hi</p>", "http://x/"), '<base href="http://x/" target="_blank"><p>hi</p>');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("F87: the jailbreak app page's Installed App group: the phone's version, and I4's note where it differs", () => {
  assert.deepEqual(installedAppSection({ id: "d", version: "1.6", actual: "1.6", note: "Installed: 1.6 (Cydian remembered 1.5)" }),
    { header: "Installed App", rows: [{ label: "Version", detail: "1.6" }], footer: "Installed: 1.6 (Cydian remembered 1.5)" });
  assert.deepEqual(installedAppSection({ id: "g", version: "2.0", actual: null, note: "Not installed (Cydian remembered 2.0)" }).rows,
    [{ label: "Version", detail: "Not Installed" }]);
  assert.equal(installedAppSection({ id: "u", version: "4.5.2", actual: "4.5.2", note: null }).footer, null);
  assert.equal(installedAppSection({ id: "o", version: "1.0" }).rows[0].detail, "1.0"); // real versions unreadable: the remembered one
});
