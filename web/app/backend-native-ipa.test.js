// F59: the jailbreak build's ipa.install bridge call (native/Sources/Apt.swift IPAInstall) against the fake bridge and
// fake helper (native/fake/): download into the helper's one IPA directory, ifizbox-helper install-ipa, the download
// removed afterwards, and the error codes the helper's exits turn into (no_adhoc when the jailbreak can't install ad
// hoc apps). The real helper's side is native/helper/test_helper.py's InstallIpa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";

// A stored (uncompressed) zip of { name: string }.
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const ipa = (id) => zip({
  "Payload/Demo.app/Info.plist": `<?xml version="1.0"?><plist version="1.0"><dict>\n<key>CFBundleIdentifier</key>\n<string>${id}</string>\n</dict></plist>\n`,
  "Payload/Demo.app/Demo": "\xcf\xfa\xed\xfe",
});

function setup(t, { env = {}, net = {}, mode } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const ipaDir = join(fx.dir, "ipa-cache");
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net, env, mode, ipaDir });
  const installed = () => {
    const f = join(fx.prefix, "var/fake-installed-ipas");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n") : [];
  };
  return { fx, native, ipaDir, installed };
}

const URL = "https://apps.example/Demo.ipa";

test("ipa.install downloads, runs install-ipa on the download and removes it (ldid, no AppSync)", async (t) => {
  const { native, ipaDir, installed } = setup(t, { env: { FAKE_LDID: "1" }, net: { [URL]: { body: ipa("com.example.demo") } } });
  const events = [];
  const r = await native.call("ipa.install", { url: URL, stream: true }, (e) => events.push(e));
  assert.equal(r.code, 0);
  assert.equal(r.bundleId, "com.example.demo");
  assert.match(r.stdout, /install app com\.example\.demo \(PackageType Developer\)/);
  assert.deepEqual(installed(), ["com.example.demo"]);
  assert.deepEqual(readdirSync(ipaDir), []); // the download is gone
  const status = events.filter((e) => e.fd === "status").map((e) => e.line);
  assert.equal(status[0], "dlstatus:ipa:0:Downloading");
  assert.equal(status.at(-1), "pmstatus:com.example.demo:100:Installed");
  assert.ok(events.some((e) => e.fd === "out" && e.line === "Installed com.example.demo"));
  const words = native.calls.find((c) => c.method === "helper.run").params.words;
  assert.equal(words[0], "install-ipa");
  assert.match(words[1], new RegExp(`^${ipaDir}/[0-9A-F-]{36}\\.ipa$`));
});

test("ipa.install with AppSync Unified hands installd the IPA as it is", async (t) => {
  const { native } = setup(t, { env: { FAKE_APPSYNC: "1", FAKE_LDID: "1" }, net: { [URL]: { body: ipa("com.example.demo") } } });
  const r = await native.call("ipa.install", { url: URL });
  assert.match(r.stdout, /^install ipa com\.example\.demo$/m);
  assert.doesNotMatch(r.stdout, /ldid/);
});

test("ipa.install says when the jailbreak can't install ad hoc apps (no_adhoc)", async (t) => {
  const none = setup(t, { net: { [URL]: { body: ipa("com.example.demo") } } });
  await assert.rejects(none.native.call("ipa.install", { url: URL }),
    /^Error: no_adhoc: AppSync Unified isn't installed and there's no ldid/);
  assert.deepEqual(none.installed(), []);
  assert.deepEqual(readdirSync(none.ipaDir), []);
  const refused = setup(t, { env: { FAKE_LDID: "1" }, net: { [URL]: { body: ipa("com.example.refused") } } });
  await assert.rejects(refused.native.call("ipa.install", { url: URL }),
    /^Error: no_adhoc: installd refused the ad hoc signed app: this jailbreak can't install ad hoc apps without AppSync/);
});

test("ipa.install's other errors: bad URL, HTTP errors, offline, not an IPA, installd, the sideload build", async (t) => {
  const { native, ipaDir } = setup(t, { env: { FAKE_APPSYNC: "1" }, net: {
    [URL]: { body: "<html>not here</html>" },
    "https://apps.example/empty.ipa": { body: zip({ "README": "x" }) },
    "https://apps.example/refused.ipa": { body: ipa("com.example.refused") },
  } });
  await assert.rejects(native.call("ipa.install", { url: "file:///etc/passwd" }), /^Error: bad_url: /);
  await assert.rejects(native.call("ipa.install", { url: "https://apps.example/missing.ipa" }), /^Error: not_found: HTTP 404/);
  await assert.rejects(native.call("ipa.install", { url: URL }), /^Error: bad_ipa: unzip couldn't unpack the IPA$/);
  await assert.rejects(native.call("ipa.install", { url: "https://apps.example/empty.ipa" }), /^Error: bad_ipa: not an IPA/);
  await assert.rejects(native.call("ipa.install", { url: "https://apps.example/refused.ipa" }), /^Error: install: installd refused the app: fake installd refused it$/);
  assert.deepEqual(readdirSync(ipaDir), []);
  const offline = setup(t, { net: null });
  await assert.rejects(offline.native.call("ipa.install", { url: URL }), /^Error: network: /);
  const side = setup(t, { mode: "sideload" });
  await assert.rejects(side.native.call("ipa.install", { url: URL }), /^Error: sideload: /);
});

test("the fake helper keeps the real one's path allowlist for install-ipa", async (t) => {
  const { native, ipaDir, fx } = setup(t, { env: { FAKE_APPSYNC: "1" } });
  for (const [words, msg] of [
    [["install-ipa"], "install-ipa takes one path"],
    [["install-ipa", join(fx.prefix, "x.ipa")], "bad IPA path"],
    [["install-ipa", `${ipaDir}/../x.ipa`], "bad IPA path"],
    [["install-ipa", `${ipaDir}/.x.ipa`], "bad IPA path"],
    [["install-ipa", `${ipaDir}/x.zip`], "bad IPA path"],
    [["install-ipa", `${ipaDir}/missing.ipa`], "can't open the IPA"],
  ]) {
    const r = await native.helper(words);
    assert.equal(r.code, 64, words.join(" "));
    assert.match(r.stderr, new RegExp(`ifizbox-helper: ${msg}`));
  }
});
