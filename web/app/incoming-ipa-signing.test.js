// B39: an IPA opened with iFizBox (Open In / the share sheet: ifizbox://shared?route=sign-ipa or ifizbox://myipas,
// incoming.js) lands on its page in My IPAs, and that page's Install (signing-client.js installFromLibrary) checks the
// certificate with signing.status, the rule Settings > Signing shows. With one saved: no prompt, it installs. Without:
// Signing opens; once it's ready (the page's draw calls signing.js offerInstall) the app goes back to the IPA's page,
// with the same file, and offers that install there: never Home.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming } from "./incoming.js";
import { installFromLibrary } from "./signing-client.js";
import { offerInstall, pendingReturn, pendingInstall, forgetInstall } from "./screens/signing.js";
import { format, parse, mounted } from "./router.js";

const IDENT = { name: "Apple Development: Test (ABCDE12345)", team: "ABCDE12345" };
const IPA_PAGE = format({ tab: "installed", path: ["myipas", "ipa:Demo.ipa"] });

// A fake sideload shell: signing.status answers from `state.cert`, the library signs and installs any file it has.
function fakeNative(state) {
  const calls = [];
  return {
    mode: "sideload", calls,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "signing.status") return { mode: "sideload", identity: state.cert ? IDENT : null };
      if (method === "library.sign") return { file: params.file, signed: { at: "now" } };
      if (method === "library.install") return { bundleId: "com.example.demo", name: "Demo", version: "1.0", file: params.file };
      throw Object.assign(new Error(`unknown method ${method}`), { code: "internal" });
    },
  };
}

function fakeUI() {
  const ui = { alerts: [], hud: 0, followed: [] };
  ui.deps = {
    hud: () => { ui.hud++; return { set() {}, hide() {} }; },
    alert: async (a) => { ui.alerts.push(a); return { index: 0 }; },
    reachable: async () => true,
    follow: (n, id) => ui.followed.push(id),
    later: () => {},
  };
  return ui;
}

let savedLocation, savedNative;
beforeEach(() => {
  savedLocation = globalThis.location;
  savedNative = globalThis.ifizboxNative;
  globalThis.location = { hash: "#/home" };
  forgetInstall();
});
afterEach(() => {
  if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
  if (savedNative === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = savedNative;
  forgetInstall();
});

const hash = () => (globalThis.location.hash.startsWith("#") ? globalThis.location.hash : `#${globalThis.location.hash}`);
const onSigning = () => mounted(parse(hash())).tab === "settings" && mounted(parse(hash())).path[0] === "signing";
const signedFiles = (native) => native.calls.filter((c) => c.method === "library.sign").map((c) => c.params.file);

for (const link of ["ifizbox://shared?route=sign-ipa&file=Demo.ipa&name=Demo.ipa", "ifizbox://myipas?file=Demo.ipa"]) {
  test(`saved certificate: ${link} opens the IPA's page and Install installs it, no Signing prompt`, async () => {
    const native = fakeNative({ cert: true });
    globalThis.ifizboxNative = native;
    await handleIncoming(link, { native, alert: async () => ({ index: 0 }), hud: () => () => {} });
    assert.equal(hash(), IPA_PAGE);
    const ui = fakeUI();
    const r = await installFromLibrary({ file: "Demo.ipa", name: "Demo" }, { ...ui.deps, native });
    assert.equal(r, "installed");
    assert.equal(hash(), IPA_PAGE, "still on the IPA's page");
    assert.equal(onSigning(), false);
    assert.deepEqual(ui.alerts, [], "no certificate alert");
    assert.deepEqual(signedFiles(native), ["Demo.ipa"]);
    assert.deepEqual(ui.followed, ["com.example.demo"]);
    assert.equal(pendingReturn(), null);
  });

  test(`no certificate: ${link}'s Install opens Signing, then back on the IPA's page with the file once imported`, async () => {
    const state = { cert: false };
    const native = fakeNative(state);
    globalThis.ifizboxNative = native;
    await handleIncoming(link, { native, alert: async () => ({ index: 0 }), hud: () => () => {} });
    assert.equal(hash(), IPA_PAGE);
    const ui = fakeUI();
    const r = await installFromLibrary({ file: "Demo.ipa", name: "Demo" }, { ...ui.deps, native });
    assert.equal(r, null, "the walkthrough opened");
    assert.ok(onSigning(), `Signing opened: ${hash()}`);
    assert.deepEqual(signedFiles(native), [], "nothing signed without a certificate");
    assert.equal(pendingReturn(), IPA_PAGE);
    assert.equal(pendingInstall()?.name, "Demo");

    // Signing draws before the import: not ready, it stays.
    const asked = [];
    const tap = async (a) => { asked.push(a); return { index: 1 }; };
    assert.equal(await offerInstall(false, { alert: tap }), null);
    assert.ok(onSigning());

    // The user imports the certificate; Signing redraws ready: back to the IPA's page (never Home), Install Now there.
    state.cert = true;
    assert.equal(await offerInstall(true, { alert: tap }), "install");
    assert.equal(hash(), IPA_PAGE, "back on the incoming IPA's page");
    assert.equal(asked.length, 1);
    assert.equal(asked[0].title, "Install Demo?");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(signedFiles(native), ["Demo.ipa"], "the same file, still in My IPAs, is installed");
    assert.deepEqual(ui.followed, ["com.example.demo"]);
    assert.equal(pendingReturn(), null, "one trip");
  });
}

test("Later on the Install Now alert still leaves the user on the IPA's page", async () => {
  const native = fakeNative({ cert: false });
  globalThis.location.hash = IPA_PAGE;
  const ui = fakeUI();
  assert.equal(await installFromLibrary({ file: "Demo.ipa", name: "Demo" }, { ...ui.deps, native }), null);
  assert.ok(onSigning());
  assert.equal(await offerInstall(true, { alert: async () => ({ index: 0 }) }), "later");
  assert.equal(hash(), IPA_PAGE);
  assert.deepEqual(signedFiles(native), []);
});

test("Signing opened by the user (no page sent them): nothing to return to, no alert", async () => {
  globalThis.location.hash = "#/home/settings/signing";
  const asked = [];
  assert.equal(await offerInstall(true, { alert: async (a) => { asked.push(a); return { index: 1 }; } }), null);
  assert.equal(hash(), "#/home/settings/signing");
  assert.equal(asked.length, 0);
});
