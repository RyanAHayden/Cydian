// B177: on the site the Worker reads Packages.gz and plain Packages only; BigBoss has Packages.bz2 alone and its plain
// Packages redirects to an HTML page. backend-http's packages() then reads .bz2 raw through the proxy and unpacks it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpBackend } from "./backend-http.js";

const TEXT = "Package: com.x.yt\nArchitecture: iphoneos-arm\nSection: Tweaks\nDepends: mobilesubstrate\n\n" +
  "Package: com.x.theme\nArchitecture: iphoneos-arm\nSection: Themes\n";
const BZ2 = "QlpoOTFBWSZTWWdw0TkAABBfgAAQQAMAECQATAA+797gIAB0EqmTGkGgAGaQSkI09RpkAD1AoM0Hbiojz2A7ksCqKIpM4K5HbePNRSISwp4ILyPPhYndyyE9mRJuNDAeIuZubCNGsJIQIj7Gl1DgwOoXi5W1heVkUYMkbus/F3JFOFCQZ3DROQ==";
const DIR = "http://apt.thebigboss.org/repofiles/cydia/dists/stable/main/binary-iphoneos-arm/";
const PAGE = "\r\n\r\n\r\n <!-- Start header.php -->\n\n<!DOCTYPE html><html>hosting</html>";

const err = (code, status) => new Response(JSON.stringify({ code, error: `${code} here` }), { status });
function proxy({ index = PAGE, bz2 = BZ2 } = {}) {
  return async (raw) => {
    const u = new URL(raw, "http://site.test");
    const url = u.searchParams.get("url").split("?")[0];
    if (u.searchParams.get("kind") === "packages") return index == null ? err("not_found", 404) : new Response(index);
    if (url.endsWith("/Packages.bz2") && bz2) return new Response(Buffer.from(bz2, "base64"));
    return err("upstream", 502);
  };
}

test("BigBoss on the site: the HTML page is no index, Packages.bz2 is read instead", async () => {
  const r = await createHttpBackend({ fetchFn: proxy() }).packages(DIR);
  assert.equal(r.text, TEXT);
  assert.equal(r.source, DIR + "Packages.bz2");
});

test("no .gz or plain index at all: .bz2 too", async () => {
  assert.equal((await createHttpBackend({ fetchFn: proxy({ index: null }) }).packages(DIR)).text, TEXT);
});

test("nothing readable: not_found, the proxy's own error when it had one", async () => {
  await assert.rejects(createHttpBackend({ fetchFn: proxy({ bz2: null }) }).packages(DIR), (e) => e.code === "not_found" && /web page/.test(e.message));
  await assert.rejects(createHttpBackend({ fetchFn: proxy({ index: null, bz2: null }) }).packages(DIR), (e) => e.code === "not_found");
});
