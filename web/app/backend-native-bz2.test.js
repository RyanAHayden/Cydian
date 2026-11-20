// B177: BigBoss serves its Packages index as Packages.bz2 only (plain Packages redirects to an HTML page), and the
// shell's net.packages reads .xz, .gz and plain only, so the sideload app's BigBoss refresh failed with not_found.
// backend-native's packages() then fetches .bz2 (then .zst) through net.fetch and unpacks it in JS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeBackend } from "./backend-native.js";

const TEXT = "Package: com.x.yt\nArchitecture: iphoneos-arm\nSection: Tweaks\nDepends: mobilesubstrate\n\n" +
  "Package: com.x.theme\nArchitecture: iphoneos-arm\nSection: Themes\n";
// TEXT through `bzip2 -9` and `zstd -19`
const BZ2 = "QlpoOTFBWSZTWWdw0TkAABBfgAAQQAMAECQATAA+797gIAB0EqmTGkGgAGaQSkI09RpkAD1AoM0Hbiojz2A7ksCqKIpM4K5HbePNRSISwp4ILyPPhYndyyE9mRJuNDAeIuZubCNGsJIQIj7Gl1DgwOoXi5W1heVkUYMkbus/F3JFOFCQZ3DROQ==";
const ZST = "KLUv/QRo1QIAIoYTEZB90HDoiVZoZTKsXaW5xXQBAP/89/NfBuCzuhkvjV/CVWcguNG3bwCO6ncKhFaY2SMwrxK4Pq3PwkD+6sw+w8duAbkPPmZlgbxTkakTAgC7ePTSunAGvDgOig==";
const DIR = "http://apt.thebigboss.org/repofiles/cydia/dists/stable/main/binary-iphoneos-arm/";

// `files`: name -> base64 body the repo serves; anything else is a 404 page (HTML, as Apache sends).
function fakeNative(files, { packages = "not_found" } = {}) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "apt.list") return null;
      if (method === "app.info") return {};
      if (method === "net.packages") {
        if (packages === "not_found") throw Object.assign(new Error(`no Packages index in ${params.dir}`), { code: "not_found" });
        if (packages === "network") throw Object.assign(new Error("The Internet connection appears to be offline."), { code: "network" });
        return { text: packages, source: params.dir + "Packages.xz" };
      }
      if (method === "net.fetch") {
        const name = params.url.split("?")[0].split("/").pop();
        if (files[name]) return { status: 200, headers: {}, body: files[name] };
        return { status: 404, headers: {}, body: btoa("<html>Not Found</html>") };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

const backendFor = (native) => createNativeBackend({ native, sourceOptions: { mode: "sideload", altDefaults: [], injectDefaults: [] } });

test("a repo with only Packages.bz2 (BigBoss) is read: fetched by the shell, unpacked in JS", async () => {
  const native = fakeNative({ "Packages.bz2": BZ2 });
  const got = await backendFor(native).packages(DIR);
  assert.equal(got.text, TEXT);
  assert.equal(got.source, DIR + "Packages.bz2");
  assert.ok(native.calls.some((c) => c.method === "net.packages"), "the shell's own reader goes first");
});

test("an HTML page the shell took for the index (BigBoss's redirect starts with blank lines) is no index: .bz2 is read", async () => {
  const page = "\r\n\r\n\r\n <!-- Start header.php -->\n\n<!DOCTYPE html><html>hosting</html>";
  const got = await backendFor(fakeNative({ "Packages.bz2": BZ2 }, { packages: page })).packages(DIR);
  assert.equal(got.text, TEXT);
  await assert.rejects(backendFor(fakeNative({}, { packages: page })).packages(DIR), (e) => e.code === "not_found" && /web page/.test(e.message));
});

test("Packages.zst is the next try when there is no .bz2", async () => {
  const got = await backendFor(fakeNative({ "Packages.zst": ZST })).packages(DIR);
  assert.equal(got.text, TEXT);
  assert.equal(got.source, DIR + "Packages.zst");
});

test("no index at all keeps net.packages' not_found error", async () => {
  await assert.rejects(backendFor(fakeNative({})).packages(DIR), (e) => e.code === "not_found" && /no Packages index/.test(e.message));
});

test("a damaged .bz2 is skipped, not thrown as a decoder error", async () => {
  await assert.rejects(backendFor(fakeNative({ "Packages.bz2": btoa("BZh9 not really") })).packages(DIR), (e) => e.code === "not_found");
});

test("a network failure is not retried as .bz2, and what the shell read is used as it is", async () => {
  const off = fakeNative({ "Packages.bz2": BZ2 }, { packages: "network" });
  await assert.rejects(backendFor(off).packages(DIR), (e) => e.code === "network");
  assert.ok(!off.calls.some((c) => c.method === "net.fetch"));
  const xz = fakeNative({}, { packages: TEXT });
  assert.equal((await backendFor(xz).packages(DIR)).text, TEXT);
  assert.ok(!xz.calls.some((c) => c.method === "net.fetch"));
});
