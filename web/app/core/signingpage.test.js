// C15: the certificate page's name in texts: Installation & Signing in the sideload build (F271's merged page),
// Settings > Signing on the website and in the jailbreak app; deviceError's alerts (sideload calls) follow it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signingPage, pageName, SIGNING_PAGE, MERGED_PAGE } from "./signingpage.js";
import { deviceError } from "./signing.js";
import { MERGED_TITLE } from "../screens/settings.js";

const inSideload = (fn) => {
  const was = globalThis.ifizboxNative;
  globalThis.ifizboxNative = { mode: "sideload" };
  try { return fn(); } finally { globalThis.ifizboxNative = was; }
};

test("the merged page's name matches Settings' own title", () => {
  assert.equal(MERGED_PAGE, `Settings > ${MERGED_TITLE}`);
});

test("signingPage and pageName by mode", () => {
  assert.equal(signingPage("sideload"), MERGED_PAGE);
  assert.equal(signingPage("site"), SIGNING_PAGE);
  assert.equal(signingPage("jailbreak"), SIGNING_PAGE);
  assert.equal(signingPage(), SIGNING_PAGE, "no bridge: the website");
  assert.equal(inSideload(() => signingPage()), MERGED_PAGE);
  assert.equal(pageName("Settings > Signing's Keep Bundle IDs", "sideload"), "Settings > Installation & Signing's Keep Bundle IDs");
  assert.equal(pageName("Settings > Signing: add it.", "site"), "Settings > Signing: add it.");
  assert.equal(pageName(undefined, "sideload"), undefined);
});

test("deviceError: No Certificate and No Signing Server name the build's page", () => {
  assert.match(deviceError({ code: "no_identity" }).message, /in Settings > Signing\.$/);
  assert.match(inSideload(() => deviceError({ code: "no_identity" }).message), /in Settings > Installation & Signing\.$/);
  assert.match(inSideload(() => deviceError({ code: "no_server" }).message), /Settings > Installation & Signing\.$/);
  assert.match(inSideload(() => deviceError({ code: "no_manifest", message: "x" }).message), /Settings > Installation & Signing\.$/);
});
