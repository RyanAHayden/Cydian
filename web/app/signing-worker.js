// F93: the website's signer, a module Web Worker (signing-client.js signInBrowser starts one per Install): zsign as
// WebAssembly (vendor/zsign) signs the IPA in this worker's memory. In: { ipa, p12, password, profile, bring }
// (ArrayBuffers, transferred). Out: { progress } while it works, then { ok: true, ipa, bundleId, name, version, sha256 }
// or { ok: false, error, code } (F292: code "malware" for an IPA whose hash is in the job's refuseSha256).
// F260: { check: "password", p12, password, profile } asks only whether the password opens the .p12 (signing-client.js
// checkPasswordInWorker): { ok: true, passwordOk: true | false | null }.
// SPDX-License-Identifier: GPL-3.0-or-later
import { runSignJob, runPasswordCheck } from "./websign-job.js";

self.onmessage = async (e) => {
  try {
    const { default: createZsign } = await import("./vendor/zsign/zsign.js");
    if (e.data?.check === "password") {
      self.postMessage({ ok: true, passwordOk: await runPasswordCheck(createZsign, e.data) });
      return;
    }
    const r = await runSignJob(createZsign, e.data, { progress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ ok: true, ...r }, [r.ipa.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err), code: err?.code ?? "sign_failed" });
  }
};
