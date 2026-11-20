// B138: an update signed for another application-identifier than the installed copy's is refused by installd
// (MismatchedApplicationIdentifierEntitlement, which idevice reports as its UnknownErrorType, code 15). The row says
// so in plain words, never the raw text; the shell's own stop before signing (appid_mismatch) reads as it is sent.
// Which profile signs it (wildcard or explicit, picked from the installed App ID) is native: AppIDMatch.swift, tested
// in native/sign/tests/main.swift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, installdText, isAppIdMismatch, appIdMismatchText } from "./apprun.js";
import { phoneLanes } from "../screens/apprun.js";
import { prepareOnDevice, openPrepared } from "../signing-client.js";

const RAW15 = "install_failed: unknown error `MismatchedApplicationIdentifierEntitlement (Upgrade's application-identifier "
  + "entitlement string (S8NFX3A2LT.com.ryha.sideload) does not match installed application's application-identifier "
  + "string (S8NFX3A2LT.com.ryha.*); rejecting upgrade.)` returned from device (15)";

// The bridge's error: bridge.js splits "<code>: <message>" into e.code and the rest
const shellError = (text) => {
  const m = /^([a-z_]+): (.*)$/s.exec(text);
  return Object.assign(new Error(m ? m[2] : text), { code: m ? m[1] : null });
};

function fakeShell({ prepare = null, open = null } = {}) {
  return {
    call(method, params) {
      const id = String(params?.tag ?? "").split("#")[0];
      if (method === "signing.prepare") {
        return prepare?.[id] ? Promise.reject(shellError(prepare[id])) : Promise.resolve({ token: `t-${id}`, bundleId: `com.${id}` });
      }
      if (method === "signing.open") {
        return open?.[id] ? Promise.reject(shellError(open[id])) : Promise.resolve({ bundleId: `com.${id}` });
      }
      if (method === "signing.progress") return Promise.resolve({ installed: true });
      return Promise.resolve({});
    },
  };
}

const sc = { prepareOnDevice, openPrepared, discardPrepared: () => {} };
function runWith(native, ids) {
  const lanes = phoneLanes(sc, { native });
  const rows = appRows(ids.map((id) => ({ id, name: id === "youmod" ? "YouMod" : id, mode: "upgrade", url: `https://x/${id}.ipa` })));
  const run = createAppRun({ rows, sign: lanes.sign, install: lanes.install, discard: lanes.discard });
  return { rows, end: run.start() };
}

test("B138: installd's error 15 (another App ID) fails the row in plain words, and the next app goes on", async () => {
  const { rows, end } = runWith(fakeShell({ open: { youmod: RAW15 } }), ["youmod", "opentennis"]);
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "installed"]);
  const line = rowStatus(rows[0]);
  assert.equal(line, `Failed: ${appIdMismatchText("YouMod")}`);
  assert.doesNotMatch(line, /UnknownErrorType|unknown error|Mismatched|\(15\)/);
  assert.match(line, /delete YouMod/);
  assert.match(line, /data is lost/);
});

test("B138: the shell's stop before signing (no profile gives the installed App ID) reads as the shell words it", async () => {
  const words = "YouMod is installed under App ID S8NFX3A2LT.com.ryha.*, and your provisioning profile signs it as "
    + "S8NFX3A2LT.com.ryha.sideload. iOS only updates an app signed for the App ID it was installed with.";
  const { rows, end } = runWith(fakeShell({ prepare: { youmod: `appid_mismatch: ${words}` } }), ["youmod"]);
  await end;
  assert.equal(rows[0].state, "failed");
  assert.equal(rows[0].error, words);
});

test("B138: installdText never passes UnknownErrorType through", () => {
  assert.ok(isAppIdMismatch(RAW15));
  assert.ok(!isAppIdMismatch("install_failed: unknown error `ApplicationVerificationFailed` returned from device (15)"));
  assert.equal(installdText(RAW15), appIdMismatchText(""));
  assert.equal(installdText("unknown error `SomethingNew (The app can't be installed now.)` returned from device (15)"),
    "iOS refused to install it: The app can't be installed now.");
  assert.equal(installdText("UnknownErrorType(\"SomethingNew\") (15)"), "iOS refused to install it");
  assert.equal(installdText("iOS didn't install it"), "iOS didn't install it");
});

test("B138: another unnamed installd error through the run reads plainly too", async () => {
  const other = "install_failed: unknown error `ApplicationVerificationFailed (Failed to verify code signature.)` returned from device (15)";
  const { rows, end } = runWith(fakeShell({ open: { youmod: other } }), ["youmod"]);
  await end;
  assert.equal(rows[0].error, "iOS refused to install it: Failed to verify code signature.");
});
